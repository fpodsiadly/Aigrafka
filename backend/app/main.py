from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.generate import router as generate_router
from app.core.config import get_settings

app = FastAPI(title="Aigrafka Demo Backend", version="0.1.0")

settings = get_settings()
raw_origins = settings.cors_origins or "*"
origins = [o.strip() for o in raw_origins.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generate_router, prefix="")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
