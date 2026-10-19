from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    # Primary model (Nano Banana 2.1); GEMINI_FALLBACK_MODELS are tried after it.
    gemini_model: str = Field(default="gemini-nano-banana-2.1")
    # Valid values for gemini-3.x image models: "512", "1K", "2K", "4K"
    gemini_image_size: str = Field(default="1K", alias="GEMINI_IMAGE_SIZE")
    gemini_fallback_models: str = Field(
        default="gemini-3.1-flash-image",
        alias="GEMINI_FALLBACK_MODELS",
    )
    http_timeout: float = Field(default=90.0, ge=1.0, alias="HTTP_TIMEOUT")
    max_selfie_mb: int = Field(default=8, ge=1, le=32)
    max_product_image_mb: int = Field(default=10, ge=1, le=64)
    product_image_timeout: float = Field(default=15.0, ge=1.0)
    # Longest side of selfie / product images sent to the model. Garment
    # patterns, prints and text need detail; 768 px blurred them noticeably.
    max_side_px: int = Field(default=1536, ge=256, le=4096)
    product_image_max_redirects: int = Field(default=3, ge=0, le=10, alias="PRODUCT_IMAGE_MAX_REDIRECTS")
    image_output_format: str = Field(default="webp", alias="IMAGE_OUTPUT_FORMAT")
    image_output_quality: int = Field(default=85, ge=1, le=100, alias="IMAGE_OUTPUT_QUALITY")
    product_image_cdn_enabled: bool = Field(default=False, alias="PRODUCT_IMAGE_CDN_ENABLED")
    product_image_cdn_base_url: str | None = Field(default=None, alias="PRODUCT_IMAGE_CDN_BASE_URL")
    s3_endpoint_url: str | None = Field(default=None, alias="S3_ENDPOINT_URL")
    s3_bucket: str | None = Field(default=None, alias="S3_BUCKET")
    s3_access_key: str | None = Field(default=None, alias="S3_ACCESS_KEY")
    s3_secret_key: str | None = Field(default=None, alias="S3_SECRET_KEY")
    variants: int = Field(default=1, ge=1, le=3)
    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173", alias="CORS_ORIGINS")
    cors_allow_any_web_origin: bool = Field(default=False, alias="CORS_ALLOW_ANY_WEB_ORIGIN")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")
    redis_token: str | None = Field(default=None, alias="REDIS_TOKEN")
    upstash_redis_rest_url: str | None = Field(default=None, alias="UPSTASH_REDIS_REST_URL")
    upstash_redis_rest_token: str | None = Field(default=None, alias="UPSTASH_REDIS_REST_TOKEN")
    generate_rate_limit_per_minute: int = Field(default=10, ge=1, alias="GENERATE_RATE_LIMIT_PER_MINUTE")
    generate_rate_limit_per_hour: int = Field(default=30, ge=1, alias="GENERATE_RATE_LIMIT_PER_HOUR")
    generate_rate_limit_burst: int = Field(default=3, ge=1, alias="GENERATE_RATE_LIMIT_BURST")
    job_result_ttl_seconds: int = Field(default=3600, ge=60, alias="JOB_RESULT_TTL_SECONDS")
    result_image_ttl_seconds: int = Field(default=3600, ge=60, le=86400, alias="RESULT_IMAGE_TTL_SECONDS")
    job_visibility_timeout_seconds: int = Field(default=900, ge=60, alias="JOB_VISIBILITY_TIMEOUT_SECONDS")
    generation_cache_ttl_seconds: int = Field(default=86400, ge=60, alias="GENERATION_CACHE_TTL_SECONDS")
    product_image_cache_ttl_seconds: int = Field(default=300, ge=30, alias="PRODUCT_IMAGE_CACHE_TTL_SECONDS")
    trust_proxy_headers: bool = Field(default=False, alias="TRUST_PROXY_HEADERS")
    db_pool_size: int = Field(default=10, ge=1, le=100, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=5, ge=0, le=100, alias="DB_MAX_OVERFLOW")
    db_pool_recycle: int = Field(default=1800, ge=60, alias="DB_POOL_RECYCLE")
    db_pool_timeout: int = Field(default=30, ge=1, le=300, alias="DB_POOL_TIMEOUT")
    google_login_rate_limit_per_minute: int = Field(default=15, ge=1, alias="GOOGLE_LOGIN_RATE_LIMIT_PER_MINUTE")
    database_url: str = Field(..., alias="DATABASE_URL", min_length=1)
    jwt_secret: str = Field(..., alias="JWT_SECRET", min_length=32)
    jwt_exp_minutes: int = Field(default=60, alias="JWT_EXP_MINUTES", ge=5, le=60 * 24 * 30)
    dev_mode: bool = Field(default=False, alias="DEV_MODE")
    demo_access_enabled: bool = Field(default=False, alias="DEMO_ACCESS_ENABLED")
    # Optional Fernet key. When set, job payloads (which carry base64 selfie /
    # product images) are encrypted before being written to Redis at rest.
    payload_encryption_key: str | None = Field(default=None, alias="PAYLOAD_ENCRYPTION_KEY")
    # Bearer token required to scrape /metrics in production. When unset, the
    # endpoint is only reachable in DEV_MODE.
    metrics_token: str | None = Field(default=None, alias="METRICS_TOKEN")
    initial_user_tokens: int = Field(default=5, alias="INITIAL_USER_TOKENS", ge=0, le=100000)
    token_cost_per_stylization: int = Field(default=1, alias="TOKEN_COST_PER_STYLIZATION", ge=1, le=1000)
    google_client_id: str | None = Field(default=None, alias="GOOGLE_CLIENT_ID")
    p24_env: str = Field(default="sandbox", alias="P24_ENV")
    p24_merchant_id: int | None = Field(default=None, alias="P24_MERCHANT_ID")
    p24_pos_id: int | None = Field(default=None, alias="P24_POS_ID")
    p24_crc: str | None = Field(default=None, alias="P24_CRC")
    p24_api_user: str | None = Field(default=None, alias="P24_API_USER")
    p24_api_secret: str | None = Field(default=None, alias="P24_API_SECRET")
    p24_api_base: str | None = Field(default=None, alias="P24_API_BASE")
    p24_panel_base: str | None = Field(default=None, alias="P24_PANEL_BASE")
    p24_currency: str = Field(default="PLN", alias="P24_CURRENCY")
    p24_price_starter_grosze: int = Field(default=1000, alias="P24_PRICE_STARTER_GROSZE", ge=1, le=10000000)
    p24_price_pro_grosze: int = Field(default=2000, alias="P24_PRICE_PRO_GROSZE", ge=1, le=10000000)
    p24_demo_mode: bool = Field(default=False, alias="P24_DEMO_MODE")
    p24_default_customer_email: str | None = Field(default=None, alias="P24_DEFAULT_CUSTOMER_EMAIL")
    checkout_success_url: str | None = Field(default=None, alias="CHECKOUT_SUCCESS_URL")
    checkout_status_url: str | None = Field(default=None, alias="CHECKOUT_STATUS_URL")

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
