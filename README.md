# Aigrafka

Przeglądarkowa wtyczka (Chrome/Firefox/Safari) do wirtualnej przymiarki ubrań z AI (virtual try-on) i zakupów tokenów. Składa się z rozszerzenia (content script + React w Shadow DOM), backendu (NestJS), modułu AI (Banana.dev + SD) oraz typów współdzielonych.

## Struktura repo

- extension/ – WebExtension (Vite, React, TS, MV3), content script wstrzykuje panel „Przymierzator” w Shadow DOM, background service worker obsługuje komunikację/płatności.
- backend/ – FastAPI (demo try-on proxy do Gemini/OpenVTO); **stary NestJS backend jest zdeprecjonowany i nieużywany w demie**.
- api/ – Vercel Functions: Stripe webhook (raw body) i cron worker Redis/Blob.
- ai/ – worker dev (pętla BRPOP; w prod używamy cron function w api/cron/worker).
- shared/ – wspólne typy (BodyMetrics, GenerateRequest).

## Stack

- Frontend: WebExtensions API, React, TypeScript, Vite, Shadow DOM, CSS (bez Tailwind).
- Backend (demo): FastAPI, httpx, Pillow; proxy do Gemini (Nano Banana Pro) z promptem OpenVTO, image-to-image (selfie + produkt reserved.com).
- (Deprecated) NestJS: poprzedni backend z JWT/Stripe/Prisma – nieużywany w demie.
- AI: Gemini (Nano Banana Pro) jako generator; prompt oparty o OpenVTO; pobieranie produktu z reserved.com (`og:image`).

## Szybki start (dev)

1. Extension: `cd extension && npm install && npm run dev` (panel preview http://localhost:5173).
2. Backend (FastAPI): `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.
   - Skopiuj `.env.example` → `.env`, ustaw `GEMINI_API_KEY`.
   - `uvicorn app.main:app --reload --port 8000` lub `make dev`.
3. Połącz front-back: ustaw `VITE_API_BASE=http://localhost:8000` w extension.
4. (Vercel) `vercel.json` zawiera cron i route webhooka; cron worker w `api/cron/worker.ts`.

## Build

- Extension: `cd extension && npm run build` → pliki w `extension/dist`; załaduj jako unpacked (MV3).
- Backend FastAPI: brak kompilacji; uruchom `uvicorn app.main:app --reload --port 8000`.
- Vercel Functions: korzystają z kodu w `api/` (Node runtime), webhook w `api/payments/webhook.ts`.

## Deployment (Vercel)

### Cron Job (wyłączony na Hobby planie)

**Status:** Cron jest obecnie skomentowany w `vercel.json`, ponieważ Hobby plan Vercela nie obsługuje Cron Jobs.

**Co robi cron?** Każde 2 minuty sprawdza Redis, pobiera zlecenia AI z kolejki i przetwarza je na Banana.dev. Bez niego AI styling nie będzie działać.

**Plan aktywacji (Opcja 3 - External Cron Service):**

1. Upgrade do Vercel Pro ($20/mc) lub
2. Skonfiguruj zewnętrzny serwis (cron-job.org, EasyCron):
   - URL: `https://your-aigrafka.vercel.app/api/cron/worker`
   - Method: `POST`
   - Schedule: `*/2 * * * *` (co 2 minuty)
   - Header: `x-cron-secret: <wartość z .env>`
3. Odkomentuj `"crons"` w `vercel.json` gdy przejdziesz na Pro

**Pełna konfiguracja do wdrożenia:**

- Root Directory: `.` (root monorepo)
- Build Command: `cd backend && npm install && npm run build`
- Output Directory: `backend/dist`
- Environment: Node.js 18+
- Zmienne `.env`: skopiuj z `.env.example`

## Konfiguracja backendu FastAPI (env)

- GEMINI_API_KEY (wymagane)
- GEMINI_MODEL (opcjonalne, domyślnie `nanobanana-pro`)
- HTTP_TIMEOUT (domyślnie 30s)
- MAX_SELFIE_MB (domyślnie 8)
- MAX_PRODUCT_IMAGE_MB (domyślnie 10)
- PRODUCT_IMAGE_TIMEOUT (domyślnie 15s)

## API (demo)

- POST `/generate` (multipart): `product_url` (reserved.com) + `selfie` (image). Zwraca `{ status, image_base64, mime_type }`.

## TODO (skrót głównych prac)

- Zaimplementować realny Banana.dev w cron workerze, upload do Blob zamiast placeholdera.
- Dodać upload/selfie flow w API + panelu (z Blob) i politykę retencji.
- Ustawić realne ceny/priceId Stripe i wyłączyć DEMO_MODE.
- Audyt bezpieczeństwa: rate limiting, walidacja plików, refresh tokeny.

## Uwagi dot. compliance

- Wymagana zgoda na przetwarzanie wizerunku; retencja obrazów ograniczona i kasowalna na żądanie.
- Przechowywanie danych w regionie UE; logi dostępu z rotacją; usuwanie danych zgodnie z RODO.
