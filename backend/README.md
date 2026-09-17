# Backend (FastAPI)

Pelna dokumentacja projektu jest w glownym pliku: `../README.md`.

Ten katalog zawiera aktywny backend (auth, profile, generate, payments).

## Szybki start

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Database migrations
alembic upgrade head

# API
uvicorn app.main:app --reload --port 8000
```

## Najwazniejsze komendy

- `make install`
- `make dev` — API server
- `make migrate` — database migrations
- `make fmt`
- `make lint`

## Redis / wyniki generacji

`/generate` wykonuje generację synchronicznie w procesie API. Redis przechowuje cache oraz obrazy wynikowe dostępne przez podpisane URL-e przez 1 godzinę; osobny worker nie jest wymagany. Wymaga `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` albo `REDIS_URL` + `REDIS_TOKEN`. Rate limit per user/IP też działa w Redis.

## Logowanie Google

Logowanie i tworzenie kont działa wyłącznie przez Google. Ustaw `GOOGLE_CLIENT_ID` na OAuth 2.0 Web Client ID. W Google Cloud Console dodaj redirect URI `https://<CHROME_EXTENSION_ID>.chromiumapp.org/google`.