# AIgrafka

AIgrafka to rozszerzenie przeglądarki do wirtualnej przymiarki ubrań z AI (virtual try-on) oraz zakupu tokenów stylizacji. Projekt składa się z frontendu extension (React + MV3), aktywnego backendu FastAPI i współdzielonych typów.

## Co jest w repo

- `extension/` - WebExtension (Vite, React, TypeScript, MV3), panel osadzany przez content script w Shadow DOM.
- `backend/` - aktywny backend FastAPI (auth, profile, generate, payments Przelewy24).
- `shared/` - wspólne typy TypeScript.

## Architektura w praktyce

- Uzytkownik uruchamia panel extension na stronie sklepu.
- Extension wysyla dane (selfie + produkt URL/zdjecie + opcje) do FastAPI `POST /generate`.
- Backend pobiera obraz produktu, buduje prompt OpenVTO i wywoluje Gemini image generation.
- Wynik wraca jako 1-3 warianty obrazow base64.
- Platnosci tokenow obsluguje Przelewy24 (`/payments/checkout`, `/payments/webhook`).

## Szybki start lokalnie

1. Uruchom backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

2. Ustaw minimalne env w `backend/.env`:

- `DATABASE_URL`
- `JWT_SECRET` (min. 32 znaki)
- `GEMINI_API_KEY`

3. Start backendu:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

4. Uruchom extension:

```bash
cd extension
npm install
npm run dev
```

5. Ustaw `VITE_API_BASE` na backend lokalny lub produkcyjny:

- lokalnie: `http://localhost:8000`
- produkcyjnie: `https://api.aigrafka.pl`

6. Build extension do instalacji unpacked:

```bash
cd extension
npm run build
```

Build updates `extension/dist/` for Chrome **Load unpacked** testing and creates:

```text
releases/aigrafka-extension-latest.zip
```

For temporary direct Render testing:

```bash
VITE_API_BASE=https://aigrafka.onrender.com npm run build
```

## Najwazniejsze endpointy (FastAPI)

- `POST /generate` - generowanie stylizacji (multipart: selfie + produkt + opcje).
- `POST /auth/register` - rejestracja.
- `POST /auth/login` - logowanie.
- `GET /auth/me` - dane i saldo tokenow.
- `POST /profile` - zapis profilu sylwetki.
- `GET /profile` - odczyt profilu sylwetki.
- `POST /payments/checkout` - rozpoczecie checkout Przelewy24 (Bearer required).
- `POST /payments/webhook` - callback i weryfikacja platnosci P24.
- `GET /health` - health check pod deploy/cron.

## Bezpieczenstwo (aktualny stan)

- Wymuszony `JWT_SECRET` (min. 32 znaki), brak slabych defaultow.
- Krotki domyslny TTL access tokenu: `JWT_EXP_MINUTES=60`.
- Ograniczony CORS: jawna lista originow, wildcard `*` zablokowany.
- Rate limiting na `POST /auth/login` i `POST /auth/register` (per IP i per IP+email).
- Odpowiedz `429` zawiera naglowek `Retry-After`.
- `/auth/topup` dziala tylko w `DEV_MODE=true`.

## Zmienne srodowiskowe (backend)

Wymagane:

- `DATABASE_URL`
- `JWT_SECRET`
- `GEMINI_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Wazne opcjonalne:

- `JWT_EXP_MINUTES`
- `DEV_MODE`
- `CORS_ORIGINS`
- `GEMINI_MODEL`
- `GEMINI_IMAGE_SIZE`
- `MAX_SELFIE_MB`
- `MAX_PRODUCT_IMAGE_MB`
- `MAX_SIDE_PX`
- `HTTP_TIMEOUT`
- `PRODUCT_IMAGE_TIMEOUT`
- `PAYLOAD_ENCRYPTION_KEY` — opcjonalny klucz Fernet do szyfrowania payloadow jobow w Redis.
- `METRICS_TOKEN` — token wymagany do `/metrics` poza `DEV_MODE`.

Platnosci Przelewy24:

- `P24_MERCHANT_ID`
- `P24_POS_ID`
- `P24_CRC`
- `P24_API_USER`
- `P24_API_SECRET`
- `P24_ENV`
- `CHECKOUT_SUCCESS_URL`
- `CHECKOUT_STATUS_URL`

## Deploy (Render)

- Service root: `backend/`
- Build command: `pip install -r requirements.txt`
- Start command: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Generation: `/generate` runs synchronously in the API service; no separate worker service required
- Required env: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- API uses Redis for persisted job results and caching. Keep `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` configured.
- Nie ustawiaj jednocześnie `REDIS_URL`/`REDIS_TOKEN`, jeśli używasz `UPSTASH_*`; `REDIS_URL` ma pierwszeństwo w konfiguracji.
- Health check: `GET /health`
- Keep-warm: `.github/workflows/keep-api-warm.yml` odpytuje `GET /health` co 5 min przez darmowy GitHub Actions.
- Workflow można uruchomić ręcznie z zakładki **Actions** (`Run workflow`).
- GitHub może opóźniać harmonogram; workflow służy tylko do podtrzymywania API, nie do generowania.

## Status modulow

- Produkcyjnie aktywne: `extension/` + `backend/`.

## Dokumentacja modulowa

- Backend: `backend/README.md`
- Shared typy: `shared/README.md`

## Compliance i dane

- Wymagana zgoda uzytkownika na przetwarzanie wizerunku.
- Zalecane: retencja obrazow, procedura usuwania danych, log audit trail i polityka RODO.
