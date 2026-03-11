import logging
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.generate import router as generate_router
from app.api.payments import router as payments_router
from app.api.profile import router as profile_router
from app.core.config import get_settings
from app.core.db import init_auth_tables, init_payment_tables, init_profile_tables

app = FastAPI(title="AIgrafka Demo Backend", version="0.1.0")

settings = get_settings()
raw_origins = settings.cors_origins or ""
origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
allow_any_web_origin = settings.cors_allow_any_web_origin

if not allow_any_web_origin and not origins:
    raise RuntimeError("CORS_ORIGINS must contain at least one allowed origin")
if "*" in origins:
    raise RuntimeError("Wildcard '*' in CORS_ORIGINS is not allowed")

# Extension panel runs in content-script context on many e-commerce domains.
# For this mode we allow any http/https origin while still disallowing credentials.
origin_regex = r"^https?://.*$" if allow_any_web_origin else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(generate_router, prefix="")
app.include_router(auth_router, prefix="")
app.include_router(profile_router, prefix="")
app.include_router(payments_router, prefix="")


@app.on_event("startup")
def startup() -> None:
    # Render free-tier PostgreSQL can be sleeping at deploy time.
    # Retry with exponential backoff before giving up.
    last_exc: Exception | None = None
    for attempt in range(6):
        try:
            init_auth_tables()
            init_profile_tables()
            init_payment_tables()
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            wait = 2 ** attempt  # 1 s, 2 s, 4 s, 8 s, 16 s, 32 s
            logging.warning("DB init attempt %d/6 failed (%s) — retrying in %ds", attempt + 1, exc, wait)
            time.sleep(wait)
    raise RuntimeError("Database initialisation failed after 6 attempts") from last_exc


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
