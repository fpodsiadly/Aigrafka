import json
import logging
from hashlib import sha384
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.db import credit_tokens_for_payment, get_user_by_id
from app.core.security import get_current_user_id

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger(__name__)


class CheckoutRequest(BaseModel):
    pack: Literal["starter", "pro"] = "starter"


class CheckoutResponse(BaseModel):
    checkoutUrl: str
    provider: str = "przelewy24"
    sessionId: str


class P24WebhookPayload(BaseModel):
    merchantId: int
    posId: int
    sessionId: str
    amount: int
    originAmount: int
    currency: str
    orderId: int
    methodId: int
    statement: str = ""
    sign: str


class DevAddTokensResponse(BaseModel):
    ok: bool
    tokens: int | None = None


class WebhookResponse(BaseModel):
    received: bool
    credited: bool | None = None
    provider: str | None = None
    tokens: int | None = None
    reason: str | None = None
    demo: bool | None = None


class P24Config(BaseModel):
    merchant_id: int
    pos_id: int
    crc: str
    api_user: str
    api_secret: str
    api_base: str
    panel_base: str
    currency: str


def _json_for_sign(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _sha384(input_text: str) -> str:
    return sha384(input_text.encode("utf-8")).hexdigest()


def _build_session_id(user_id: str, pack: str) -> str:
    raw = f"aigrafka:{user_id}:{pack}:{uuid4().hex}"
    return raw[:100]


def _extract_user_id_from_session(session_id: str) -> str | None:
    parts = session_id.split(":")
    if len(parts) < 3:
        return None
    user_id = parts[1].strip()
    if not user_id or user_id == "guest":
        return None
    return user_id


def _map_amount_to_tokens(amount_grosze: int) -> int:
    settings = get_settings()
    starter_price = settings.p24_price_starter_grosze
    if starter_price <= 0:
        return 0
    return max(0, round(5 * (amount_grosze / starter_price)))


def _get_p24_config() -> P24Config:
    settings = get_settings()
    env = (settings.p24_env or "sandbox").lower()

    merchant_id = settings.p24_merchant_id
    pos_id = settings.p24_pos_id or merchant_id
    crc = (settings.p24_crc or "").strip()
    api_user = (settings.p24_api_user or "").strip()
    api_secret = (settings.p24_api_secret or "").strip()

    api_base = (settings.p24_api_base or "").strip() or (
        "https://secure.przelewy24.pl/api/v1" if env == "prod" else "https://sandbox.przelewy24.pl/api/v1"
    )
    panel_base = (settings.p24_panel_base or "").strip() or (
        "https://secure.przelewy24.pl" if env == "prod" else "https://sandbox.przelewy24.pl"
    )

    if not merchant_id or not pos_id or not crc or not api_user or not api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Brak konfiguracji Przelewy24 (P24_MERCHANT_ID, P24_POS_ID, P24_CRC, P24_API_USER, P24_API_SECRET).",
        )

    return P24Config(
        merchant_id=int(merchant_id),
        pos_id=int(pos_id),
        crc=crc,
        api_user=api_user,
        api_secret=api_secret,
        api_base=api_base,
        panel_base=panel_base,
        currency=settings.p24_currency,
    )


def _build_register_sign(session_id: str, amount: int, currency: str, config: P24Config) -> str:
    payload = {
        "sessionId": session_id,
        "merchantId": config.merchant_id,
        "amount": amount,
        "currency": currency,
        "crc": config.crc,
    }
    return _sha384(_json_for_sign(payload))


def _build_verify_sign(session_id: str, order_id: int, amount: int, currency: str, config: P24Config) -> str:
    payload = {
        "sessionId": session_id,
        "orderId": order_id,
        "amount": amount,
        "currency": currency,
        "crc": config.crc,
    }
    return _sha384(_json_for_sign(payload))


def _is_notification_sign_valid(payload: P24WebhookPayload, config: P24Config) -> bool:
    expected_payload = {
        "merchantId": payload.merchantId,
        "posId": payload.posId,
        "sessionId": payload.sessionId,
        "amount": payload.amount,
        "originAmount": payload.originAmount,
        "currency": payload.currency,
        "orderId": payload.orderId,
        "methodId": payload.methodId,
        "statement": payload.statement,
        "crc": config.crc,
    }
    expected = _sha384(_json_for_sign(expected_payload))
    return expected == payload.sign


@router.post("/dev-add-tokens", response_model=DevAddTokensResponse)
async def dev_add_tokens(user_id: str = Depends(get_current_user_id)) -> DevAddTokensResponse:
    """Dev-only endpoint: credit 5 tokens directly. Only works when DEV_MODE=true."""
    settings = get_settings()
    if not settings.dev_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only available in dev mode")

    event_id = f"dev:{user_id}:{uuid4().hex}"
    await credit_tokens_for_payment(event_id, user_id, 5)
    user = await get_user_by_id(user_id)
    return DevAddTokensResponse(ok=True, tokens=user["tokens"] if user else None)


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(body: CheckoutRequest, user_id: str = Depends(get_current_user_id)) -> CheckoutResponse:
    settings = get_settings()
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if settings.p24_demo_mode:
        return CheckoutResponse(checkoutUrl="https://example.com/checkout-demo", sessionId="demo")

    config = _get_p24_config()

    amount = settings.p24_price_pro_grosze if body.pack == "pro" else settings.p24_price_starter_grosze
    session_id = _build_session_id(user_id, body.pack)
    sign = _build_register_sign(session_id, amount, config.currency, config)

    url_return = settings.checkout_success_url or "https://aigrafka.pl"
    url_status = settings.checkout_status_url or f"{url_return.rstrip('/')}/payments/webhook"

    payload = {
        "merchantId": config.merchant_id,
        "posId": config.pos_id,
        "sessionId": session_id,
        "amount": amount,
        "currency": config.currency,
        "description": f"AIgrafka token pack: {body.pack}",
        "email": str(user["email"]),
        "country": "PL",
        "language": "pl",
        "urlReturn": url_return,
        "urlStatus": url_status,
        "waitForResult": False,
        "sign": sign,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{config.api_base}/transaction/register",
                json=payload,
                auth=(config.api_user, config.api_secret),
            )
    except Exception as exc:
        logger.exception("P24 register request failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="P24 register request failed") from exc

    if response.status_code >= 400:
        detail = response.text[:800]
        logger.error("P24 register error status=%s body=%s", response.status_code, detail)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="P24 register rejected")

    data = response.json()
    token = data.get("data", {}).get("token") if isinstance(data, dict) else None
    if not token:
        logger.error("P24 register missing token, body=%s", data)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="P24 register missing token")

    return CheckoutResponse(
        checkoutUrl=f"{config.panel_base}/trnRequest/{token}",
        sessionId=session_id,
    )


@router.post("/webhook", response_model=WebhookResponse)
async def p24_webhook(request: Request) -> WebhookResponse:
    settings = get_settings()
    if settings.p24_demo_mode:
        return WebhookResponse(received=True, demo=True, provider="przelewy24")

    config = _get_p24_config()

    try:
        body = await request.json()
        payload = P24WebhookPayload(**body)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook payload") from exc

    if not _is_notification_sign_valid(payload, config):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid P24 webhook sign")

    verify_sign = _build_verify_sign(payload.sessionId, payload.orderId, payload.amount, payload.currency, config)
    verify_payload = {
        "merchantId": config.merchant_id,
        "posId": config.pos_id,
        "sessionId": payload.sessionId,
        "amount": payload.amount,
        "currency": payload.currency,
        "orderId": payload.orderId,
        "sign": verify_sign,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            verify_response = await client.put(
                f"{config.api_base}/transaction/verify",
                json=verify_payload,
                auth=(config.api_user, config.api_secret),
            )
    except Exception as exc:
        logger.exception("P24 verify request failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="P24 verify request failed") from exc

    if verify_response.status_code >= 400:
        logger.error("P24 verify HTTP error status=%s body=%s", verify_response.status_code, verify_response.text[:800])
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="P24 verification failed")

    verify_data = verify_response.json()
    if (verify_data.get("data") or {}).get("status") != "success":
        logger.error("P24 verify payload error=%s", verify_data)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="P24 verification not successful")

    user_id = _extract_user_id_from_session(payload.sessionId)
    if not user_id:
        logger.warning("No user mapping in sessionId=%s", payload.sessionId)
        return WebhookResponse(received=True, credited=False, reason="no-user")

    tokens = _map_amount_to_tokens(payload.amount)
    if tokens <= 0:
        return WebhookResponse(received=True, credited=False, reason="zero-tokens")

    event_id = f"p24:{payload.orderId}"
    try:
        inserted = await credit_tokens_for_payment(event_id, user_id, tokens)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found for payment") from exc

    return WebhookResponse(received=True, credited=inserted, provider="przelewy24", tokens=tokens)
