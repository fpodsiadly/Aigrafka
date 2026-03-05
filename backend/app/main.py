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

if not origins:
    raise RuntimeError("CORS_ORIGINS must contain at least one allowed origin")
if "*" in origins:
    raise RuntimeError("Wildcard '*' in CORS_ORIGINS is not allowed")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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
    init_auth_tables()
    init_profile_tables()
    init_payment_tables()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
