import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.generate import router as generate_router
from app.api.jobs import router as jobs_router
from app.api.payments import router as payments_router
from app.api.profile import router as profile_router
from app.core.config import get_settings
from app.core.db import close_engine, get_engine
from app.core.metrics import render_prometheus, setup_structured_logging
from app.core.redis_client import get_redis_client

settings = get_settings()
logger = logging.getLogger(__name__)

ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
ALLOWED_HEADERS = ["Authorization", "Content-Type"]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_structured_logging()
    if not get_redis_client():
        logging.warning("Redis not configured; generation queue and caching are disabled")
    yield
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

app.include_router(generate_router, prefix="")
app.include_router(auth_router, prefix="")
app.include_router(profile_router, prefix="")
app.include_router(payments_router, prefix="")
app.include_router(jobs_router, prefix="")


@app.get("/metrics")
async def metrics() -> Response:
    """Prometheus-compatible metrics endpoint."""
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
