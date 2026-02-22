# AIgrafka Demo Backend (FastAPI)

Demo backend acting as a secure proxy/orchestrator for virtual try-on powered by Gemini (Nano Banana Pro) and OpenVTO-style prompting.

## Features

- POST `/generate`: accepts user selfie upload + reserved.com product URL; returns generated image (base64) and status.
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
4. Skopiuj `.env.example` do `.env` i uzupełnij `GEMINI_API_KEY`
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
- No auth, payments, or tokens per demo scope.
- Pillow validates uploads only minimally; extend if needed.
- Product image fetch is cached in-memory for 5 minutes; only reserved.com is allowed.

## Deprecation note

Stary backend (NestJS) nie jest używany w demie. Zalecane korzystanie wyłącznie z FastAPI.
