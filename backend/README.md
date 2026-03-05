# AIgrafka Demo Backend (FastAPI)

Demo backend acting as a secure proxy/orchestrator for virtual try-on powered by Gemini (Nano Banana Pro) and OpenVTO-style prompting.

## Features

- POST `/generate`: accepts user selfie upload + reserved.com product URL; returns generated image (base64) and status.
- POST `/payments/checkout`: rejestruje transakcję Przelewy24 i zwraca URL przekierowania.
- POST `/payments/webhook`: odbiera notyfikację Przelewy24, robi `transaction/verify` i nalicza tokeny.
- Prompt built from OpenVTO principles: preserve identity, realistic fit, photorealistic output; uses selfie + product image (og:image) from reserved.com.
- Gemini client stub ready to swap for real API call.
- Async FastAPI structure, modular to extract AI layer later.

## Structure

```
backend/
 ├─ app/
 │  ├─ main.py
 │  ├─ api/
 │  │  └─ generate.py
 │  ├─ ai/
 │  │  ├─ gemini_client.py
 │  │  └─ prompts/
 │  │     └─ openvto_prompt.py
 │  └─ core/
 │     └─ config.py
 ├─ requirements.txt
 └─ README.md
```

## Quickstart

1. Python 3.11+
2. `cd backend && python3 -m venv .venv && source .venv/bin/activate`
3. `pip install -r requirements.txt`
4. Skopiuj `.env.example` do `.env` i uzupełnij `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`
5. Run dev: `uvicorn app.main:app --reload --port 8000`

### Makefile skróty

- `make install` – venv + zależności (pip upgrade w zestawie)
- `make dev` – start uvicorn na porcie 8000
- `make fmt` – black + isort
- `make lint` – ruff
- `make test` – pytest (placeholder)

## API

`POST /generate`

- Form-data fields:
  - `product_url` (string, must be from reserved.com)
  - `selfie` (file, image)
- Response: `{ status: string, image_base64: string | object, mime_type: string }`

### Limits & Validation

- Selfie upload: max 8 MB, basic Pillow validation.
- Product image: only reserved.com; fetches page and uses `og:image` when needed; max 10 MB.

### Example (curl)

```
curl -X POST \
  -F "product_url=https://www.reserved.com/pl/pl/bluza-ze-stojka-2-520ef-90x" \
  -F "selfie=@/path/to/selfie.jpg" \
  http://localhost:8000/generate
```

## Notes

- `GeminiClient` is a demo stub; replace payload/endpoint per actual Gemini spec.
- Auth i tokeny są aktywne; checkout tokenów działa przez Przelewy24.
- `/auth/topup` działa tylko w trybie developerskim (`DEV_MODE=true`) lub lokalnie (`localhost/127.0.0.1`).
- Pillow validates uploads only minimally; extend if needed.
- Product image fetch is cached in-memory for 5 minutes; only reserved.com is allowed.

## Security defaults

- `JWT_SECRET` jest wymagany i musi mieć co najmniej 32 znaki.
- Domyślny TTL access tokenu to `JWT_EXP_MINUTES=60`.
- `CORS_ORIGINS` musi zawierać jawnie dozwolone originy (wildcard `*` jest blokowany).
- `POST /auth/login` i `POST /auth/register` mają wbudowany rate limiting (per IP oraz IP+email) i zwracają `Retry-After` przy `429`.

## Płatności Przelewy24 (FastAPI)

Endpointy:

- `POST /payments/checkout` (wymaga Bearer token) — body: `{ "pack": "starter" | "pro" }`
- `POST /payments/webhook` — callback z Przelewy24 (`urlStatus`)

Wymagane env:

- `P24_MERCHANT_ID`
- `P24_POS_ID`
- `P24_CRC`
- `P24_API_USER`
- `P24_API_SECRET`

Zalecane env:

- `P24_ENV=sandbox|prod`
- `CHECKOUT_SUCCESS_URL`
- `CHECKOUT_STATUS_URL` (np. `https://api.twojadomena.pl/payments/webhook`)
- `P24_PRICE_STARTER_GROSZE`, `P24_PRICE_PRO_GROSZE`

## Benchmark A/B (latency)

Gotowy skrypt do porównania "przed/po" (mediana i p95 dla 20 requestów):

`python scripts/benchmark_generate_ab.py --url-a https://api-old.onrender.com --url-b https://api-new.onrender.com --selfie /ABS/PATH/selfie.jpg --product /ABS/PATH/product.jpg --iterations 20 --warmup 2 --model-choice banana-pro-2 --variants 1 --json-out benchmark_ab.json`

Skrypt raportuje:

- `median_client_ms` i `p95_client_ms` (czas end-to-end z perspektywy klienta),
- `median_backend_ms` i `p95_backend_ms` (z pola `variants[0].latency_ms`),
- `success_rate` i model zwracany przez backend.

Wskazówki:

- Używaj tych samych plików `selfie` i `product` dla A i B.
- Dla uczciwego porównania trzymaj identyczne parametry (`model_choice`, `variants`, `fit_style`).
- Jeśli mierzysz wpływ cold startu, uruchom benchmark raz "na zimno" i raz po keep-warm.

## Deprecation note

Stary backend (NestJS) nie jest używany w demie. Zalecane korzystanie wyłącznie z FastAPI.
