# AIgrafka

AIgrafka to rozszerzenie przeglądarki do wirtualnej przymiarki ubrań z AI (virtual try-on) oraz zakupu tokenów stylizacji. Projekt składa się z frontendu extension (React + MV3), aktywnego backendu FastAPI i współdzielonych typów.

## Co jest w repo

- `extension/` - WebExtension (Vite, React, TypeScript, MV3), panel osadzany przez content script w Shadow DOM.
- `backend/` - aktywny backend FastAPI (auth, profile, generate, payments Przelewy24).
- `shared/` - wspólne typy TypeScript.

## Architektura w praktyce

- Uzytkownik uruchamia panel extension na stronie sklepu.
- Extension wysyla dane (selfie, zdjecie produktu lub URL, kategoria, wymiary, rozmiar, opis produktu ze strony) do FastAPI `POST /generate` w trybie `mode=async`.
- Backend tworzy zadanie i generuje w tle: buduje narracyjny prompt (`backend/app/ai/prompts/openvto_prompt.py`) i wywoluje Gemini (domyslnie Nano Banana 2.1, zapasowo Gemini 3.1 Flash Image).
- Wariant 1 jest generowany pierwszy; warianty 2-3 sa kolejnymi turami tej samej rozmowy z modelem, wiec pokazuja te sama osobe i ubranie.
- Logo AIgrafka jest nakladane na gotowy obraz (`backend/app/ai/branding.py`), nie generowane przez model.
- Panel odpytuje `GET /jobs/{id}` i pokazuje kazdy wariant, gdy tylko jest gotowy; obrazy sa dostepne przez podpisane URL-e przez 1 godzine.
- Tokeny sa pobierane tylko za warianty faktycznie wygenerowane (nieudane i wziete z cache wracaja).
- Platnosci tokenow obsluguje Przelewy24 (`/payments/checkout`, `/payments/webhook`).

## Rozszerzenie: najwazniejsze funkcje

- Wybor zdjecia produktu kliknieciem na stronie sklepu: pobierany jest oryginalny plik w pelnej rozdzielczosci (najwiekszy wariant `srcset`), a zrzut ekranu jest tylko rezerwa.
- Rozpoznany produkt: nazwa, marka, kolor, material i opis ze strony (JSON-LD `Product` albo Open Graph) trafiaja do promptu; mozna je usunac.
- Kategoria wpisywana recznie z podpowiedziami; dla kroju meskiego blokowane sa kategorie intymne i damskie (PL/EN slowa kluczowe, `garment_policy`).
- Rozmiar: pole z podpowiedziami z tabeli rozmiarow na stronie i rekomendacja na podstawie wymiarow uzytkownika; prompt opisuje dopasowanie (np. ciasno w klatce).
- Selfie i wymiary zostaja zapamietane (selfie do 30 dni w pamieci rozszerzenia); "Zacznij od nowa" czysci tylko produkt.
- "Usun moje dane" w stopce panelu kasuje selfie i wymiary w przegladarce oraz profil i zapisane stylizacje na serwerze.

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
- `GOOGLE_CLIENT_ID` (OAuth 2.0 Web Client ID)
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

- `POST /generate` - generowanie stylizacji (multipart: selfie + produkt + opcje). Z `mode=async` zwraca `202` z `job_id`, a wynik (także częściowy, wariant po wariancie) jest dostępny pod `GET /jobs/{job_id}`; bez `mode` działa synchronicznie.
  Dodatkowe pola: `fresh=true` (nowe obrazy zamiast cache), `product_name` / `product_details` (opis produktu ze strony sklepu), `garment_size` oraz `size_chest_range` / `size_waist_range` / `size_hips_range` (zakresy wybranego rozmiaru z tabeli sklepu). Tokeny są pobierane tylko za warianty faktycznie wygenerowane — nieudane i wzięte z cache są zwracane (`refunded_tokens`). Błędy dostawcy wracają jako kody (`service_unavailable`, `generation_failed`, `content_policy`); pełna treść zostaje w logach.
- `GET /jobs/{job_id}` - status i (częściowe) wyniki generowania asynchronicznego. Zadanie bez znaku życia dłużej niż `JOB_ORPHAN_TIMEOUT_SECONDS` (np. po restarcie serwera) jest oznaczane jako `failed` (`interrupted`) z jednorazowym zwrotem tokenów.
- `POST /profile/delete-data` - usunięcie profilu sylwetki i wszystkich zapisanych stylizacji użytkownika (Bearer required).
- `POST /auth/google` - logowanie i automatyczne utworzenie konta przez Google.
- `GET /auth/google/client-id` - konfiguracja OAuth dla rozszerzenia.

Google Cloud Console musi zawierać dokładny redirect URI rozszerzenia:
`https://<CHROME_EXTENSION_ID>.chromiumapp.org/google`.
To wartość zwracana przez `chrome.identity.getRedirectURL('google')`.
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
- Rate limiting na `POST /auth/google` (per IP).
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
- `GEMINI_MODEL` — model główny (domyślnie `gemini-nano-banana-2.1`)
- `GEMINI_FALLBACK_MODELS` — modele zapasowe po przecinku, próbowane po głównym (domyślnie `gemini-3.1-flash-image`)
- `GEMINI_IMAGE_SIZE`
- `MAX_SELFIE_MB`
- `MAX_PRODUCT_IMAGE_MB`
- `MAX_SIDE_PX` — dłuższy bok selfie/zdjęcia produktu wysyłanego do modelu (domyślnie 1536)
- `HTTP_TIMEOUT`
- `PRODUCT_IMAGE_TIMEOUT`
- `JOB_ORPHAN_TIMEOUT_SECONDS` — po ilu sekundach bez znaku życia zadanie generowania uznać za przerwane (domyślnie 120)
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
- Generation runs in the API service (async jobs as in-process background tasks); no separate worker service required
- Required env: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- API uses Redis for generation caching, rate limiting, and one-hour signed result-image URLs. Keep `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` configured.
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
- Retencja: przeslane selfie i zdjecia produktu nie sa zapisywane; obrazy wynikowe do 1 h, cache generacji do 24 h; selfie w przegladarce do 30 dni.
- Usuwanie danych: przycisk "Usun moje dane" w panelu (`POST /profile/delete-data`). Szczegoly w `PRIVACY_POLICY.md` i `public/privacy-policy/`.
- Zalecane: log audit trail i przeglad prawny polityki prywatnosci.

## Testy

```bash
cd backend && make test        # pytest
cd extension && npm test       # Vitest
```

Z katalogu glownego `npm test` uruchamia testy rozszerzenia.

## Porównanie promptów (A/B)

`backend/scripts/compare_prompts.py` generuje te same przypadki starym (`scripts/legacy_openvto_prompt.py`) i obecnym promptem i zapisuje raport HTML obok siebie. Wymaga tylko `GEMINI_API_KEY`:

```bash
cd backend
GEMINI_API_KEY=... .venv/bin/python scripts/compare_prompts.py scripts/ab_cases.example.json --out ab-report
```

Format przypadków: `scripts/ab_cases.example.json` (ścieżki do zdjęć względem pliku JSON).
