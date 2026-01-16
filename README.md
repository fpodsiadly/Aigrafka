# Aigrafka

Przeglądarkowa wtyczka (Chrome/Firefox/Safari) do wirtualnej przymiarki ubrań z AI (virtual try-on) i zakupów tokenów. Składa się z rozszerzenia (content script + React w Shadow DOM), backendu (NestJS), modułu AI (Banana.dev + SD) oraz typów współdzielonych.

## Struktura repo

- extension/ – WebExtension (Vite, React, TS, MV3), content script wstrzykuje panel „Przymierzator” w Shadow DOM, background service worker obsługuje komunikację/płatności.
- backend/ – NestJS API (auth JWT placeholder, ai/generate -> kolejka, payments/Stripe).
- api/ – Vercel Functions: Stripe webhook (raw body) i cron worker Redis/Blob.
- ai/ – worker dev (pętla BRPOP; w prod używamy cron function w api/cron/worker).
- shared/ – wspólne typy (BodyMetrics, GenerateRequest).

## Stack

- Frontend: WebExtensions API, React, TypeScript, Vite, Shadow DOM, CSS (bez Tailwind).
- Backend: NestJS, JWT, Stripe Checkout/Webhooks, plan: Prisma + PostgreSQL, Redis (kolejka AI), S3/R2 storage.
- AI: Banana.dev GPU, Stable Diffusion try-on pipeline (selfie + produkt + metryki + kategoria), wynik: obraz + analiza fit.

## Szybki start (dev)

1. Zainstaluj zależności: `cd extension && npm install`, `cd backend && npm install`, w root `npm install`.
2. Prisma: `cd backend && npx prisma generate` (klient v6 w backend). Root funkcje Vercel korzystają z kopiowanego klienta.
3. Dev backend: `cd backend && npm run start:dev` (http://localhost:4000/api).
4. Dev extension: `cd extension && npm run dev`; dla produkcji `npm run build` i załaduj `extension/dist` jako „Load unpacked”.
5. W extension ustaw `VITE_API_BASE` (np. `http://localhost:4000` lub prod Vercel URL); domyślny fallback to localhost.
6. (Vercel) `vercel.json` zawiera cron i route webhooka; cron worker w `api/cron/worker.ts`.

## Build

- Extension: `cd extension && npm run build` → pliki w `extension/dist`; załaduj jako unpacked (MV3).
- Backend: `cd backend && npm run build`.
- Vercel Functions: korzystają z kodu w `api/` (Node runtime), cron w `api/cron/worker.ts`, webhook w `api/payments/webhook.ts`.

## Konfiguracja backendu (env)

- PORT (domyślnie 4000)
- JWT_SECRET
- STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO
- STRIPE_WEBHOOK_SECRET, PRICE_STARTER_CENTS (map kwoty na tokeny)
- STRIPE_DEMO_MODE (true/false) – demo bez realnego Checkout, zwraca placeholder URL i akceptuje webhook
- CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL
- DATABASE_URL (PostgreSQL/Neon), REDIS_URL (Vercel Redis), BLOB_READ_WRITE_TOKEN (Vercel Blob)
- VITE_API_BASE (dla extension build)

## API (wstępne)

- POST /api/auth/login – mock login, zwraca JWT.
- POST /api/ai/generate – przyjmuje { productUrl, category, metrics, selfieUrl? }, zwraca podgląd (mock) i notę o dopasowaniu.
- POST /api/payments/checkout – przyjmuje { pack: 'starter' | 'pro' }, zwraca checkoutUrl Stripe.
- POST /api/payments/webhook – Stripe webhook (raw body) dla księgowania tokenów.
- POST /api/ai/generate – w prod enqueue job (Redis/DB), a wynik trafia przez cron worker.

## TODO (skrót głównych prac)

- Zaimplementować realny Banana.dev w cron workerze, upload do Blob zamiast placeholdera.
- Dodać upload/selfie flow w API + panelu (z Blob) i politykę retencji.
- Ustawić realne ceny/priceId Stripe i wyłączyć DEMO_MODE.
- Audyt bezpieczeństwa: rate limiting, walidacja plików, refresh tokeny.

## Uwagi dot. compliance

- Wymagana zgoda na przetwarzanie wizerunku; retencja obrazów ograniczona i kasowalna na żądanie.
- Przechowywanie danych w regionie UE; logi dostępu z rotacją; usuwanie danych zgodnie z RODO.
