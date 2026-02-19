from functools import lru_cache
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: Optional[str] = Field(default=None, alias="GEMINI_API_KEY")
    # Default to the faster image model; can be overridden via GEMINI_MODEL
    gemini_model: str = Field(default="gemini-2.5-flash-image")
    http_timeout: float = Field(default=30.0, ge=1.0)
    max_selfie_mb: int = Field(default=8, ge=1, le=32)
    max_product_image_mb: int = Field(default=10, ge=1, le=64)
    product_image_timeout: float = Field(default=15.0, ge=1.0)
    max_side_px: int = Field(default=960, ge=256, le=4096)
    variants: int = Field(default=1, ge=1, le=3)
    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")
    database_url: str = Field(..., alias="DATABASE_URL", min_length=1)
    jwt_secret: str = Field(default="dev-insecure-change-me", alias="JWT_SECRET", min_length=8)
    jwt_exp_minutes: int = Field(default=60 * 24 * 7, alias="JWT_EXP_MINUTES", ge=5, le=60 * 24 * 30)
    initial_user_tokens: int = Field(default=5, alias="INITIAL_USER_TOKENS", ge=0, le=100000)
    token_cost_per_stylization: int = Field(default=1, alias="TOKEN_COST_PER_STYLIZATION", ge=1, le=1000)

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
