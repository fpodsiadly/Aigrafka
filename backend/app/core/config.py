from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str = Field(..., alias="GEMINI_API_KEY", min_length=1)
    # Default to the faster image model; can be overridden via GEMINI_MODEL
    gemini_model: str = Field(default="gemini-2.5-flash-image")
    http_timeout: float = Field(default=30.0, ge=1.0)
    max_selfie_mb: int = Field(default=8, ge=1, le=32)
    max_product_image_mb: int = Field(default=10, ge=1, le=64)
    product_image_timeout: float = Field(default=15.0, ge=1.0)
    max_side_px: int = Field(default=960, ge=256, le=4096)
    variants: int = Field(default=1, ge=1, le=4)
    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
