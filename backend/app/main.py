from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.generate import router as generate_router
from app.core.config import get_settings
from app.core.db import init_auth_tables

app = FastAPI(title="Aigrafka Demo Backend", version="0.1.0")

settings = get_settings()
raw_origins = settings.cors_origins or "*"
origins = [o.strip() for o in raw_origins.split(",") if o.strip()] or ["*"]

# Be generous: allow all origins including extension/file schemes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(generate_router, prefix="")
app.include_router(auth_router, prefix="")


@app.on_event("startup")
def startup() -> None:
    init_auth_tables()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
