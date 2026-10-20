import asyncio
import hmac
import logging
import re
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.product_image import close_product_image_client
from app.api.auth import router as auth_router
from app.api.generate import router as generate_router
from app.api.images import router as images_router
from app.api.jobs import router as jobs_router
from app.api.payments import router as payments_router
from app.api.profile import router as profile_router
from app.core.config import get_settings
from app.core.db import close_engine, get_engine
from app.core.metrics import render_prometheus, setup_structured_logging
from app.core.redis_client import connect_redis_at_startup, get_redis_client, is_redis_configured

settings = get_settings()
logger = logging.getLogger(__name__)

ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
ALLOWED_HEADERS = ["Authorization", "Content-Type"]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_structured_logging()
    if not is_redis_configured():
        logging.warning("Redis not configured (set UPSTASH_REDIS_REST_URL/TOKEN); caching and async generation are disabled")
    elif not await connect_redis_at_startup():
        logging.warning(
            "Redis unreachable at startup; retrying on demand every 15 s, until then caching and async "
            "generation are disabled"
        )
    yield
    await close_product_image_client()
    await close_engine()


app = FastAPI(title="AIgrafka Backend", version="0.2.0", lifespan=lifespan)

raw_origins = settings.cors_origins or ""
origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
allow_any_web_origin = settings.cors_allow_any_web_origin

if not allow_any_web_origin and not origins:
    raise RuntimeError("CORS_ORIGINS must contain at least one allowed origin")
if "*" in origins:
    raise RuntimeError("Wildcard '*' in CORS_ORIGINS is not allowed")

cors_kwargs = {
    "allow_credentials": False,
    "allow_methods": ALLOWED_METHODS,
    "allow_headers": ALLOWED_HEADERS,
}
if allow_any_web_origin:
    # Credentials are disabled, so a permissive origin regex is safe here.
    cors_kwargs["allow_origin_regex"] = ".*"
else:
    cors_kwargs["allow_origins"] = origins

app.add_middleware(CORSMiddleware, **cors_kwargs)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request.state.request_started_perf = perf_counter()
    supplied_request_id = request.headers.get("x-request-id", "")
    request_id = supplied_request_id if re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", supplied_request_id) else uuid4().hex
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request error request_id=%s path=%s", request_id, request.url.path)
        raise
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    request_id = getattr(request.state, "request_id", uuid4().hex)
    detail = exc.detail if isinstance(exc.detail, str) else "Request rejected"
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": f"http_{exc.status_code}", "detail": detail, "request_id": request_id},
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, _exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", uuid4().hex)
    logger.exception("Unhandled API error request_id=%s path=%s", request_id, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"code": "internal_error", "detail": "Internal server error", "request_id": request_id},
    )


app.include_router(generate_router, prefix="")
app.include_router(images_router, prefix="")
app.include_router(auth_router, prefix="")
app.include_router(profile_router, prefix="")
app.include_router(payments_router, prefix="")
app.include_router(jobs_router, prefix="")


@app.get("/metrics")
async def metrics(request: Request) -> Response:
    """Prometheus-compatible metrics endpoint.

    Requires a bearer token in production (METRICS_TOKEN). Open only in DEV_MODE
    so operational internals are not exposed to anonymous callers. Returns 404
    (not 403) when unauthorized to avoid confirming the endpoint exists.
    """
    if not settings.dev_mode:
        token = settings.metrics_token
        provided = request.headers.get("authorization", "")
        expected = f"Bearer {token}" if token else None
        if not expected or not hmac.compare_digest(provided, expected):
            raise HTTPException(status_code=404, detail="Not Found")
    content = await asyncio.to_thread(render_prometheus)
    return Response(content=content, media_type="text/plain; version=0.0.4; charset=utf-8")


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe: process is up. Cheap, no external calls."""
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness probe: verify DB and Redis connectivity."""
    checks: dict[str, str] = {}
    healthy = True

    try:
        from sqlalchemy import text

        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        logger.exception("Readiness DB check failed")
        checks["database"] = "error"
        healthy = False

    client = get_redis_client()
    if client:
        try:
            await asyncio.to_thread(client.ping)
            checks["redis"] = "ok"
        except Exception:
            logger.exception("Readiness Redis check failed")
            checks["redis"] = "error"
            healthy = False
    else:
        checks["redis"] = "not_configured"

    status_code = 200 if healthy else 503
    return JSONResponse(status_code=status_code, content={"status": "ok" if healthy else "degraded", "checks": checks})
