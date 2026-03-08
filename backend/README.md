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
uvicorn app.main:app --reload --port 8000
```

## Najwazniejsze komendy

- `make install`
- `make dev`
- `make fmt`
- `make lint`

## Uwaga

`backend/src/` (NestJS) jest legacy i nie jest uzywany w aktualnym deployu.
