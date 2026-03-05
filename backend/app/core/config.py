from functools import lru_cache
from typing import Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: Optional[str] = Field(default=None, alias="GEMINI_API_KEY")
    # Default to the faster image model; can be overridden via GEMINI_MODEL
    gemini_model: str = Field(default="gemini-2.5-flash-image")
    # Lower output image size improves latency on image generation models.
    gemini_image_size: str = Field(default="768", alias="GEMINI_IMAGE_SIZE")
    http_timeout: float = Field(default=30.0, ge=1.0)
    max_selfie_mb: int = Field(default=8, ge=1, le=32)
    max_product_image_mb: int = Field(default=10, ge=1, le=64)
    product_image_timeout: float = Field(default=15.0, ge=1.0)
    max_side_px: int = Field(default=768, ge=256, le=4096)
    variants: int = Field(default=1, ge=1, le=3)
    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173", alias="CORS_ORIGINS")
    database_url: str = Field(..., alias="DATABASE_URL", min_length=1)
    jwt_secret: str = Field(..., alias="JWT_SECRET", min_length=32)
    jwt_exp_minutes: int = Field(default=60, alias="JWT_EXP_MINUTES", ge=5, le=60 * 24)
    dev_mode: bool = Field(default=False, alias="DEV_MODE")
    initial_user_tokens: int = Field(default=5, alias="INITIAL_USER_TOKENS", ge=0, le=100000)
    token_cost_per_stylization: int = Field(default=1, alias="TOKEN_COST_PER_STYLIZATION", ge=1, le=1000)
    google_client_id: Optional[str] = Field(default=None, alias="GOOGLE_CLIENT_ID")
    p24_env: str = Field(default="sandbox", alias="P24_ENV")
    p24_merchant_id: Optional[int] = Field(default=None, alias="P24_MERCHANT_ID")
    p24_pos_id: Optional[int] = Field(default=None, alias="P24_POS_ID")
    p24_crc: Optional[str] = Field(default=None, alias="P24_CRC")
    p24_api_user: Optional[str] = Field(default=None, alias="P24_API_USER")
    p24_api_secret: Optional[str] = Field(default=None, alias="P24_API_SECRET")
    p24_api_base: Optional[str] = Field(default=None, alias="P24_API_BASE")
    p24_panel_base: Optional[str] = Field(default=None, alias="P24_PANEL_BASE")
    p24_currency: str = Field(default="PLN", alias="P24_CURRENCY")
    p24_price_starter_grosze: int = Field(default=1000, alias="P24_PRICE_STARTER_GROSZE", ge=1, le=10000000)
    p24_price_pro_grosze: int = Field(default=2000, alias="P24_PRICE_PRO_GROSZE", ge=1, le=10000000)
    p24_demo_mode: bool = Field(default=False, alias="P24_DEMO_MODE")
    p24_default_customer_email: Optional[str] = Field(default=None, alias="P24_DEFAULT_CUSTOMER_EMAIL")
    checkout_success_url: Optional[str] = Field(default=None, alias="CHECKOUT_SUCCESS_URL")
    checkout_status_url: Optional[str] = Field(default=None, alias="CHECKOUT_STATUS_URL")

    class Config:
        env_file = ".env"
        extra = "ignore"

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        secret = value.strip()
        if len(secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters long")
        if secret.lower() in {"dev-insecure-change-me", "changeme", "secret", "password"}:
            raise ValueError("JWT_SECRET is too weak")
        return secret


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
