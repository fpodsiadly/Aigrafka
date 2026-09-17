import asyncio
import base64
import contextlib
import logging
import signal
from time import perf_counter

from app.ai.gemini_client import GeminiClient
from app.ai.product_image import close_product_image_client, fetch_product_image
from app.ai.prompts.openvto_prompt import build_openvto_prompt
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


def _generation_models() -> list[str]:
    settings = get_settings()
    fallback_models = [model.strip() for model in settings.gemini_fallback_models.split(",") if model.strip()]
    return list(dict.fromkeys([settings.gemini_model, *fallback_models]))


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
) -> dict:
    settings = get_settings()
    last_error: str | None = None
    generation_models = _generation_models()

    for attempt, model in enumerate(generation_models):
        # Cache is keyed per model so fallback results are reused correctly.
        cache_started = perf_counter()
        cached = await get_cached_generation(
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
            model,
            settings.gemini_image_size,
        )
        if telemetry is not None:
            telemetry["redis_ms"] = telemetry.get("redis_ms", 0.0) + (perf_counter() - cache_started) * 1000.0
        if cached:
            if telemetry is not None:
                telemetry["cache_hit"] = True
            return cached

        try:
            client = GeminiClient(model=model)
            started = perf_counter()
            result = await asyncio.wait_for(
                client.generate_image(prompt, selfie_bytes, product_image_bytes),
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
                    model,
                    settings.gemini_image_size,
                    result,
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
) -> dict:
    user_id = payload.get("user_id")
    charged_tokens = payload.get("charged_tokens", 0)
    refunded = False

    async def _refund_tokens() -> None:
        nonlocal refunded
        if refunded or not user_id or charged_tokens <= 0:
            return
        await add_tokens(user_id, charged_tokens)
        track_token_refund()
        refunded = True

    try:
        product_url = payload.get("product_url")
        category = payload.get("category")
        fit_style = payload.get("fit_style")
        height_cm = payload.get("height_cm")
        chest_cm = payload.get("chest_cm")
        waist_cm = payload.get("waist_cm")
        hips_cm = payload.get("hips_cm")
        variant_count = payload.get("variant_count", 1)
        used_upload = payload.get("used_upload", False)
        product_ref = payload.get("product_ref", "product")
        back_reference_available = payload.get("back_reference_available", False)

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

        # Build per-variant tasks for concurrent generation (batch)
        async def _generate_one_variant(index: int) -> dict:
            variant_number = index + 1
            prompt = build_openvto_prompt(
                product_ref,
                is_upload=used_upload,
                category=category,
                fit_style=fit_style,
                height_cm=height_cm,
                chest_cm=chest_cm,
                waist_cm=waist_cm,
                hips_cm=hips_cm,
                variants=variant_count,
                variant_index=variant_number,
                back_reference_available=back_reference_available,
            )
            current_product_image_bytes = (
                secondary_product_image_bytes
                if variant_count == 3 and variant_number == 3 and secondary_product_image_bytes is not None
                else primary_product_image_bytes
            )
            return await _run_variant_with_retry(
                prompt,
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
            )

        variant_tasks = [_generate_one_variant(i) for i in range(variant_count)]
        # return_exceptions=True: one failing variant must not abort the whole
        # batch; normalize any raised exception into a failed-variant dict.
        raw_variants = await asyncio.gather(*variant_tasks, return_exceptions=True)
        variants: list[dict] = []
        for i, v in enumerate(raw_variants):
            if isinstance(v, BaseException):
                logger.warning("Variant %d raised: %s", i + 1, v)
                variants.append({"status": "failed", "error": str(v) or "variant_error"})
            else:
                variants.append(v)

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

        # No usable image produced (fallback/refused/failed): refund the charge
        # so users are not billed for results they cannot use.
        if overall_status != "generated" and user_id and charged_tokens > 0:
            try:
                await _refund_tokens()
            except Exception:
                logger.exception("Failed to refund tokens for non-generated generation %s", operation_id)

        result = {
            "status": overall_status,
            "variants": variants,
            "model": successful[0].get("model") if successful else variants[0].get("model") if variants else None,
            "detail": fallback_detail,
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
