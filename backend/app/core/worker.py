import asyncio
import base64
import contextlib
import logging
import signal
from collections.abc import Awaitable, Callable
from time import perf_counter

from app.ai.branding import apply_brand_mark
from app.ai.gemini_client import MODEL_CONTENT_KEY, GeminiClient, VariantFollowUp
from app.ai.product_image import close_product_image_client, fetch_product_image
from app.ai.prompts.openvto_prompt import build_openvto_prompt, build_variant_follow_up_prompt
from app.ai.size_fit import describe_size_fit
from app.core.cache import get_cached_generation, set_cached_generation
from app.core.config import get_settings
from app.core.db import add_tokens, close_engine
from app.core.metrics import track_gemini_call, track_generation_latency, track_job_status, track_token_refund
from app.core.queue import (
    acknowledge_job,
    dequeue_job,
    get_job,
    recover_stale_jobs,
    renew_job_lease,
    update_job_status,
)

logger = logging.getLogger(__name__)
# Called with (variant_index, variant) as soon as each variant finishes, so
# async jobs can expose partial results before the whole batch completes.
VariantCallback = Callable[[int, dict], Awaitable[None]]


def _generation_models() -> list[str]:
    settings = get_settings()
    fallback_models = [model.strip() for model in settings.gemini_fallback_models.split(",") if model.strip()]
    return list(dict.fromkeys([settings.gemini_model, *fallback_models]))


def _without_model_content(result: dict) -> dict:
    return {key: value for key, value in result.items() if key != MODEL_CONTENT_KEY}


# Provider errors meaning "out of quota / credits / capacity", not a bad request.
_SERVICE_UNAVAILABLE_MARKERS = ("resource_exhausted", "quota", "credits", "rate limit", "429", "402", "503")


def _public_error(error: str | None) -> str | None:
    """Map a raw provider error to a stable code; raw text stays in the logs only."""
    if not error:
        return None
    if error == "content_policy":
        return error
    lowered = error.lower()
    if any(marker in lowered for marker in _SERVICE_UNAVAILABLE_MARKERS):
        return "service_unavailable"
    return "generation_failed"


def _to_public_variant(variant: dict) -> dict:
    """Client-facing variant: no model turn, and no placeholder image when it failed."""
    public = _without_model_content(variant)
    if public.get("status") != "generated":
        if public.get("error"):
            logger.warning("Variant not generated: status=%s error=%s", public.get("status"), public["error"])
        public.pop("image_base64", None)
        public.pop("mime_type", None)
        public["error"] = _public_error(public.get("error"))
    return public


async def _apply_branding(result: dict) -> None:
    try:
        image_bytes = base64.b64decode(result["image_base64"])
        branded, mime_type = await asyncio.to_thread(apply_brand_mark, image_bytes)
    except Exception:
        logger.exception("Brand mark overlay failed; returning the unbranded image")
        return
    result["image_base64"] = base64.b64encode(branded).decode()
    result["mime_type"] = mime_type


async def _run_variant_with_retry(
    prompt: str,
    selfie_bytes: bytes,
    product_image_bytes: bytes,
    category: str | None,
    fit_style: str | None,
    height_cm: str | None,
    chest_cm: str | None,
    waist_cm: str | None,
    hips_cm: str | None,
    variant_index: int,
    variant_count: int,
    telemetry: dict | None = None,
    follow_up: VariantFollowUp | None = None,
    follow_up_model: str | None = None,
    owner_id: str | None = None,
    use_cache: bool = True,
) -> dict:
    settings = get_settings()
    last_error: str | None = None
    # A follow-up turn must stay on the model that produced the first variant:
    # the conversation history (incl. thought signatures) is model-specific.
    generation_models = [follow_up_model] if follow_up is not None and follow_up_model else _generation_models()

    for attempt, model in enumerate(generation_models):
        # Cache is keyed per model so fallback results are reused correctly;
        # follow-up turns get their own key as their output depends on variant 1.
        cache_model_key = f"{model}:follow-up" if follow_up is not None else model
        cache_prompt = prompt if follow_up is None else f"{prompt}\n{follow_up.prompt}"
        cache_started = perf_counter()
        # use_cache=False ("generate more") always renders a new image; the
        # result is still written to the cache below.
        cached = use_cache and await get_cached_generation(
            selfie_bytes,
            product_image_bytes,
            category,
            fit_style,
            height_cm,
            chest_cm,
            waist_cm,
            hips_cm,
            variant_index,
            variant_count,
            cache_model_key,
            settings.gemini_image_size,
            cache_prompt,
        )
        if telemetry is not None:
            telemetry["redis_ms"] = telemetry.get("redis_ms", 0.0) + (perf_counter() - cache_started) * 1000.0
        if cached:
            if telemetry is not None:
                telemetry["cache_hit"] = True
            # Marked so the caller does not bill a variant that cost nothing.
            return {**cached, "cached": True}

        try:
            client = GeminiClient(model=model)
            started = perf_counter()
            result = await asyncio.wait_for(
                client.generate_image(prompt, selfie_bytes, product_image_bytes, follow_up),
                timeout=settings.http_timeout,
            )
            latency_s = perf_counter() - started
            if telemetry is not None:
                telemetry["gemini_ms"] = max(telemetry.get("gemini_ms", 0.0), latency_s * 1000.0)
            result["latency_ms"] = latency_s * 1000.0
            result["model"] = model
            track_gemini_call(model, result.get("status", "unknown"))
            track_generation_latency(model, latency_s)
            if result.get("status") == "generated" and result.get("image_base64"):
                await _apply_branding(result)
                cache_started = perf_counter()
                await set_cached_generation(
                    selfie_bytes,
                    product_image_bytes,
                    category,
                    fit_style,
                    height_cm,
                    chest_cm,
                    waist_cm,
                    hips_cm,
                    variant_index,
                    variant_count,
                    cache_model_key,
                    settings.gemini_image_size,
                    _without_model_content(result),
                    owner_id=owner_id,
                    prompt=cache_prompt,
                )
                if telemetry is not None:
                    telemetry["redis_ms"] = telemetry.get("redis_ms", 0.0) + (
                        perf_counter() - cache_started
                    ) * 1000.0
                return result
            last_error = result.get("error") or "fallback"
        except Exception as exc:
            last_error = str(exc)
            logger.warning("Variant generation attempt %d failed with model %s: %s", attempt + 1, model, last_error)
            await asyncio.sleep(min(2 ** attempt, 10))

    return {
        "image_base64": GeminiClient.FALLBACK_IMAGE_BASE64,
        "mime_type": "image/png",
        "status": "fallback",
        "model": generation_models[-1],
        "error": last_error or "All generation attempts failed",
    }


async def generate_from_payload(
    payload: dict,
    *,
    operation_id: str = "synchronous",
    telemetry: dict | None = None,
    on_variant: VariantCallback | None = None,
) -> dict:
    user_id = payload.get("user_id")
    charged_tokens = payload.get("charged_tokens", 0)
    refunded_tokens = 0

    async def _refund_tokens(amount: int | None = None) -> None:
        """Return `amount` tokens (default: everything not refunded yet), never more than charged."""
        nonlocal refunded_tokens
        remaining = charged_tokens - refunded_tokens
        amount = remaining if amount is None else min(amount, remaining)
        if not user_id or amount <= 0:
            return
        await add_tokens(user_id, amount)
        track_token_refund()
        refunded_tokens += amount

    try:
        product_url = payload.get("product_url")
        category = payload.get("category")
        fit_style = payload.get("fit_style")
        height_cm = payload.get("height_cm")
        chest_cm = payload.get("chest_cm")
        waist_cm = payload.get("waist_cm")
        hips_cm = payload.get("hips_cm")
        variant_count = payload.get("variant_count", 1)
        product_name = payload.get("product_name")
        product_details = payload.get("product_details")
        size_fit = describe_size_fit(
            payload.get("garment_size"),
            {name: payload.get(f"size_{name}_range") for name in ("chest", "waist", "hips")},
            {"chest": chest_cm, "waist": waist_cm, "hips": hips_cm},
        )
        back_reference_available = payload.get("back_reference_available", False)
        use_cache = not payload.get("fresh", False)

        selfie_bytes = payload.get("selfie_bytes")
        if selfie_bytes is None:
            selfie_bytes = base64.b64decode(payload.get("selfie_b64") or "")
        primary_product_image_bytes = payload.get("product_image_1_bytes")
        if primary_product_image_bytes is None and payload.get("product_image_1_b64"):
            primary_product_image_bytes = base64.b64decode(payload["product_image_1_b64"])
        secondary_product_image_bytes = payload.get("product_image_2_bytes")
        if secondary_product_image_bytes is None and payload.get("product_image_2_b64"):
            secondary_product_image_bytes = base64.b64decode(payload["product_image_2_b64"])

        if primary_product_image_bytes is None and product_url:
            fetch_started = perf_counter()
            primary_product_image_bytes = await fetch_product_image(product_url)
            if telemetry is not None:
                telemetry["product_fetch_ms"] = (perf_counter() - fetch_started) * 1000.0

        if primary_product_image_bytes is None:
            raise ValueError("Product image not available")

        def _standalone_prompt(variant_number: int) -> str:
            return build_openvto_prompt(
                category=category,
                fit_style=fit_style,
                height_cm=height_cm,
                chest_cm=chest_cm,
                waist_cm=waist_cm,
                hips_cm=hips_cm,
                variants=variant_count,
                variant_index=variant_number,
                back_reference_available=back_reference_available,
                product_name=product_name,
                product_details=product_details,
                size_fit=size_fit,
            )

        def _uses_back_reference(variant_number: int) -> bool:
            return variant_count == 3 and variant_number == 3 and secondary_product_image_bytes is not None

        async def _run_standalone(variant_number: int) -> dict:
            current_product_image_bytes = (
                secondary_product_image_bytes if _uses_back_reference(variant_number) else primary_product_image_bytes
            )
            return await _run_variant_with_retry(
                _standalone_prompt(variant_number),
                selfie_bytes,
                current_product_image_bytes,
                category,
                fit_style,
                height_cm,
                chest_cm,
                waist_cm,
                hips_cm,
                variant_number,
                variant_count,
                telemetry,
                owner_id=user_id,
                use_cache=use_cache,
            )

        async def _run_follow_up(variant_number: int, first_variant: dict) -> dict:
            follow_up = VariantFollowUp(
                previous_content=first_variant[MODEL_CONTENT_KEY],
                prompt=build_variant_follow_up_prompt(
                    variant_number, variant_count, back_reference_available, category
                ),
                extra_image_bytes=secondary_product_image_bytes if _uses_back_reference(variant_number) else None,
            )
            result = await _run_variant_with_retry(
                _standalone_prompt(1),
                selfie_bytes,
                primary_product_image_bytes,
                category,
                fit_style,
                height_cm,
                chest_cm,
                waist_cm,
                hips_cm,
                variant_number,
                variant_count,
                telemetry,
                follow_up=follow_up,
                follow_up_model=first_variant.get("model"),
                owner_id=user_id,
                use_cache=use_cache,
            )
            if result.get("status") == "generated":
                return result
            logger.warning("Follow-up variant %d failed; generating it standalone", variant_number)
            return await _run_standalone(variant_number)

        async def _settle(index: int, generation: Awaitable[dict]) -> dict:
            # One failing variant must not abort the whole batch; normalise any
            # raised exception into a failed-variant dict.
            try:
                variant = await generation
            except Exception as exc:
                logger.warning("Variant %d raised: %s", index + 1, exc)
                variant = {"status": "failed", "error": str(exc) or "variant_error"}
            if on_variant is not None:
                try:
                    await on_variant(index, _to_public_variant(variant))
                except Exception:
                    logger.exception("Variant callback failed for variant %d", index + 1)
            return variant

        # Variant 1 is rendered first; the remaining variants continue its
        # conversation in parallel so all of them show the same person and
        # garment. Without a usable first turn they fall back to standalone calls.
        first_variant = await _settle(0, _run_standalone(1))
        can_follow_up = first_variant.get("status") == "generated" and first_variant.get(MODEL_CONTENT_KEY) is not None
        remaining = await asyncio.gather(
            *[
                _settle(
                    index,
                    _run_follow_up(index + 1, first_variant) if can_follow_up else _run_standalone(index + 1),
                )
                for index in range(1, variant_count)
            ]
        )
        variants = [_to_public_variant(variant) for variant in (first_variant, *remaining)]

        successful = [v for v in variants if v.get("status") == "generated" and v.get("image_base64")]
        if successful:
            overall_status = "generated"
        elif any(v.get("error") == "content_policy" for v in variants):
            overall_status = "refused"
        elif variants:
            overall_status = "fallback"
        else:
            overall_status = "failed"

        fallback_detail = None
        if overall_status != "generated":
            for v in variants:
                if v.get("error"):
                    fallback_detail = v["error"]
                    break

        # Bill only variants that were actually rendered for this request: a
        # failed variant or one served from the cache is refunded.
        unbilled_variants = sum(1 for v in variants if v.get("status") != "generated" or v.get("cached"))
        if unbilled_variants and user_id and charged_tokens > 0:
            try:
                await _refund_tokens(unbilled_variants * charged_tokens // max(1, variant_count))
            except Exception:
                logger.exception("Failed to refund tokens for unbilled variants of %s", operation_id)

        result = {
            "status": overall_status,
            "variants": variants,
            "model": successful[0].get("model") if successful else variants[0].get("model") if variants else None,
            "detail": fallback_detail,
            "refunded_tokens": refunded_tokens,
        }
        track_job_status(overall_status)
        logger.info("Generation %s completed: %s", operation_id, overall_status)
        return result
    except asyncio.CancelledError:
        try:
            await asyncio.shield(_refund_tokens())
        except Exception:
            logger.exception("Failed to refund tokens for cancelled generation %s", operation_id)
        raise
    except Exception:
        logger.exception("Generation %s failed", operation_id)
        if user_id and charged_tokens > 0:
            try:
                await _refund_tokens()
            except Exception:
                logger.exception("Failed to refund tokens for generation %s", operation_id)
        raise


async def process_job(job_id: str) -> None:
    job = await get_job(job_id, include_payload=True)
    if not job:
        logger.error("Job %s not found", job_id)
        return

    payload = job.get("payload") or {}
    await update_job_status(job_id, "running")
    settings = get_settings()

    async def _heartbeat() -> None:
        # Refresh the lease well within the visibility timeout so a slow job is
        # not requeued and processed twice.
        interval = max(30, settings.job_visibility_timeout_seconds // 3)
        while True:
            await asyncio.sleep(interval)
            await asyncio.to_thread(renew_job_lease, job_id)

    heartbeat_task = asyncio.create_task(_heartbeat())
    try:
        result = await generate_from_payload(payload, operation_id=job_id)
        await update_job_status(job_id, "completed", result=result)
    except Exception as exc:
        await update_job_status(job_id, "failed", error=str(exc))
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task


async def run_worker() -> None:
    logger.info("Worker started")
    recovered = await asyncio.to_thread(recover_stale_jobs)
    if recovered:
        logger.warning("Recovered %d stale jobs on startup", recovered)
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        logger.info("Shutdown signal received; finishing in-flight job then exiting")
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, _request_stop)

    while not stop_event.is_set():
        # dequeue_job blocks up to `timeout`s; run it off-loop so signals
        # (and the stop event) are handled promptly.
        job_id = await asyncio.to_thread(dequeue_job, 5)
        if stop_event.is_set():
            break
        if job_id:
            try:
                await process_job(job_id)
            except Exception:
                logger.exception("Unhandled error processing job %s", job_id)
            finally:
                await asyncio.to_thread(acknowledge_job, job_id)

    await close_product_image_client()
    await close_engine()
    logger.info("Worker stopped cleanly")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
