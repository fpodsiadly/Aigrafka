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

# Terminal 1: API
uvicorn app.main:app --reload --port 8000

# Terminal 2: worker (required for /generate)
python run_worker.py

# Database migrations
alembic upgrade head
```

## Najwazniejsze komendy

- `make install`
- `make dev` — API server
- `make worker` — generation worker
- `make fmt`
- `make lint`

## Redis / kolejka generacji

`/generate` enqueue-uje job do Redis. Wymaga `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` albo `REDIS_URL` + `REDIS_TOKEN`. API i worker muszą używać tej samej instancji Redis. Worker (`run_worker.py`) pobiera job i wywołuje Gemini. Wyniki cache-owane w Redis. Rate limit per user/IP też w Redis.