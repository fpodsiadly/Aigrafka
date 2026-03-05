# AIgrafka

Przeglądarkowa wtyczka (Chrome/Firefox/Safari) do wirtualnej przymiarki ubrań z AI (virtual try-on) i zakupów tokenów. Składa się z rozszerzenia (content script + React w Shadow DOM), backendu FastAPI oraz typów współdzielonych.

## Struktura repo

- extension/ – WebExtension (Vite, React, TS, MV3), content script wstrzykuje panel „Przymierzator” w Shadow DOM, background service worker obsługuje komunikację/płatności.
- backend/ – FastAPI (demo try-on proxy do Gemini/OpenVTO); **stary NestJS backend jest zdeprecjonowany i nieużywany w demie**.
- api/ – (opcjonalnie) serverless funkcje webhook/cron; w demie nieużywane przy deployu na Render.
- ai/ – worker dev (pętla BRPOP; w prod używamy cron function w api/cron/worker).
- shared/ – wspólne typy (BodyMetrics, GenerateRequest).

## Stack

- Frontend: WebExtensions API, React, TypeScript, Vite, Shadow DOM, CSS (bez Tailwind).
- Backend (demo): FastAPI, httpx, Pillow; proxy do Gemini (`imagegeneration` domyślnie) z promptem OpenVTO, image-to-image (selfie + produkt reserved.com).
- (Deprecated) NestJS: poprzedni backend z JWT/Prisma – nieużywany w demie.
- AI: Gemini (Nano Banana Pro) jako generator; prompt oparty o OpenVTO; pobieranie produktu z reserved.com (`og:image`).

## Szybki start (dev)

1. Extension: `cd extension && npm install && npm run dev` (panel preview http://localhost:5173).
2. Backend (FastAPI): `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.
  - Skopiuj `.env.example` → `.env`, ustaw `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`.
   - `uvicorn app.main:app --reload --port 8000` lub `make dev`.
3. Połącz front-back: ustaw `VITE_API_BASE=https://api.aigrafka.pl` w extension (lub `http://localhost:8000` przy dev backendzie).
4. Deployment: patrz sekcja „Render”.

## Build

- Extension: `cd extension && npm run build` → pliki w `extension/dist`; załaduj jako unpacked (MV3).
- Backend FastAPI: brak kompilacji; uruchom `uvicorn app.main:app --reload --port 8000`.
- (opcjonalne) `api/` może służyć jako serverless na innej platformie; w demie główny backend to FastAPI.

## Deployment (Render)

- Root: `backend/`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Env (przykład): `PYTHON_VERSION=3.11`, `DATABASE_URL=...`, `JWT_SECRET=<silny sekret min. 32 znaki>`, `CORS_ORIGINS=https://aigrafka.pl,https://api.aigrafka.pl`, opcjonalnie limity `MAX_SELFIE_MB`, `MAX_PRODUCT_IMAGE_MB`, `MAX_SIDE_PX`, `VARIANTS`, `HTTP_TIMEOUT`, `PRODUCT_IMAGE_TIMEOUT`.
- Health check: GET `/health`.

## Konfiguracja backendu FastAPI (env)

- GEMINI_API_KEY (wymagane)
- DATABASE_URL (wymagane)
- JWT_SECRET (wymagane, min. 32 znaki)
- JWT_EXP_MINUTES (domyślnie 60)
- DEV_MODE (domyślnie `false`; włącza dev endpoint `/auth/topup`)
- GEMINI_MODEL (opcjonalne)
- HTTP_TIMEOUT (domyślnie 30s)
- MAX_SELFIE_MB (domyślnie 8)
- MAX_PRODUCT_IMAGE_MB (domyślnie 10)
- PRODUCT_IMAGE_TIMEOUT (domyślnie 15s)

## API (demo)

- POST `/generate` (multipart): `product_url` (reserved.com) + `selfie` (image) + opcjonalne `variants` (1–4).
  - Zwraca: `{ status, image_base64, mime_type, model, variants: [{ image_base64, mime_type, width, height, latency_ms }] }`.
  - Selfie normalizowane do JPEG, resize do max ~1280 px; obraz produktu pobierany z `og:image`, normalizowany do JPEG, resize do max ~1280 px; limity: selfie `MAX_SELFIE_MB`, produkt `MAX_PRODUCT_IMAGE_MB`.

## Płatności Przelewy24 (FastAPI)

Aktywne endpointy znajdują się w `backend/app/api/payments.py`:

- `POST /payments/checkout` (wymaga Bearer token)
- `POST /payments/webhook` (callback P24 + verify + naliczenie tokenów)

Wymagane zmienne środowiskowe:

- `P24_MERCHANT_ID`
- `P24_POS_ID`
- `P24_CRC`
- `P24_API_USER`
- `P24_API_SECRET`
- `P24_ENV` (`sandbox` lub `prod`)

Opcjonalne:

- `P24_API_BASE`, `P24_PANEL_BASE`
- `P24_DEMO_MODE`
- `P24_PRICE_STARTER_GROSZE`, `P24_PRICE_PRO_GROSZE`
- `P24_DEFAULT_CUSTOMER_EMAIL`
- `CHECKOUT_SUCCESS_URL`, `CHECKOUT_STATUS_URL`

## Uwagi dot. compliance

- Wymagana zgoda na przetwarzanie wizerunku; retencja obrazów ograniczona i kasowalna na żądanie.
- Przechowywanie danych w regionie UE; logi dostępu z rotacją; usuwanie danych zgodnie z RODO.
