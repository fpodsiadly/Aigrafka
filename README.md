# Aigrafka

Przeglądarkowa wtyczka (Chrome/Firefox/Safari) do wirtualnej przymiarki ubrań z AI (virtual try-on) i zakupów tokenów. Składa się z rozszerzenia (content script + React w Shadow DOM), backendu (NestJS), modułu AI (Banana.dev + SD) oraz typów współdzielonych.

## Struktura repo

- extension/ – WebExtension (Vite, React, TS, MV3), content script wstrzykuje panel „Przymierzator” w Shadow DOM, background service worker obsługuje komunikację/płatności.
- backend/ – FastAPI (demo try-on proxy do Gemini/OpenVTO); **stary NestJS backend jest zdeprecjonowany i nieużywany w demie**.
- api/ – (opcjonalnie) serverless funkcje Stripe/cron (jeśli wrócą); w demie nieużywane przy deployu na Render.
- ai/ – worker dev (pętla BRPOP; w prod używamy cron function w api/cron/worker).
- shared/ – wspólne typy (BodyMetrics, GenerateRequest).

## Stack

- Frontend: WebExtensions API, React, TypeScript, Vite, Shadow DOM, CSS (bez Tailwind).
- Backend (demo): FastAPI, httpx, Pillow; proxy do Gemini (`imagegeneration` domyślnie) z promptem OpenVTO, image-to-image (selfie + produkt reserved.com).
- (Deprecated) NestJS: poprzedni backend z JWT/Stripe/Prisma – nieużywany w demie.
- AI: Gemini (Nano Banana Pro) jako generator; prompt oparty o OpenVTO; pobieranie produktu z reserved.com (`og:image`).

## Szybki start (dev)

1. Extension: `cd extension && npm install && npm run dev` (panel preview http://localhost:5173).
2. Backend (FastAPI): `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.
   - Skopiuj `.env.example` → `.env`, ustaw `GEMINI_API_KEY`.
   - `uvicorn app.main:app --reload --port 8000` lub `make dev`.
3. Połącz front-back: ustaw `VITE_API_BASE=https://aigrafka.onrender.com` w extension (lub `http://localhost:8000` przy dev backendzie).
4. Deployment: patrz sekcja „Render”.

## Build

- Extension: `cd extension && npm run build` → pliki w `extension/dist`; załaduj jako unpacked (MV3).
- Backend FastAPI: brak kompilacji; uruchom `uvicorn app.main:app --reload --port 8000`.
- (opcjonalne) `api/` może służyć jako serverless na innej platformie; w demie główny backend to FastAPI.

## Deployment (Render)

- Root: `backend/`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Env (przykład): `PYTHON_VERSION=3.11`, `GEMINI_API_KEY=...`, `CORS_ORIGINS=https://aigrafka.onrender.com,https://aigrafka.pl,https://api.aigrafka.pl,http://localhost:5173`, opcjonalnie limity `MAX_SELFIE_MB`, `MAX_PRODUCT_IMAGE_MB`, `MAX_SIDE_PX`, `VARIANTS`, `HTTP_TIMEOUT`, `PRODUCT_IMAGE_TIMEOUT`.
- Health check: GET `/health`.

## Konfiguracja backendu FastAPI (env)

- GEMINI_API_KEY (wymagane)
- GEMINI_MODEL (opcjonalne, domyślnie `nanobanana-pro`)
- HTTP_TIMEOUT (domyślnie 30s)
- MAX_SELFIE_MB (domyślnie 8)
- MAX_PRODUCT_IMAGE_MB (domyślnie 10)
- PRODUCT_IMAGE_TIMEOUT (domyślnie 15s)

## API (demo)

- POST `/generate` (multipart): `product_url` (reserved.com) + `selfie` (image) + opcjonalne `variants` (1–4).
  - Zwraca: `{ status, image_base64, mime_type, model, variants: [{ image_base64, mime_type, width, height, latency_ms }] }`.
  - Selfie normalizowane do JPEG, resize do max ~1280 px; obraz produktu pobierany z `og:image`, normalizowany do JPEG, resize do max ~1280 px; limity: selfie `MAX_SELFIE_MB`, produkt `MAX_PRODUCT_IMAGE_MB`.

## TODO (skrót głównych prac)

- Zaimplementować realny Banana.dev w cron workerze, upload do Blob zamiast placeholdera.
- Dodać upload/selfie flow w API + panelu (z Blob) i politykę retencji.
- Ustawić realne ceny/priceId Stripe i wyłączyć DEMO_MODE.
- Audyt bezpieczeństwa: rate limiting, walidacja plików, refresh tokeny.

## Uwagi dot. compliance

- Wymagana zgoda na przetwarzanie wizerunku; retencja obrazów ograniczona i kasowalna na żądanie.
- Przechowywanie danych w regionie UE; logi dostępu z rotacją; usuwanie danych zgodnie z RODO.
