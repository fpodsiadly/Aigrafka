# Aigrafka

Przeglądarkowa wtyczka (Chrome/Firefox/Safari) do wirtualnej przymiarki ubrań z AI (virtual try-on) i zakupów tokenów. Składa się z rozszerzenia (content script + React w Shadow DOM), backendu (NestJS), modułu AI (Banana.dev + SD) oraz typów współdzielonych.

## Struktura repo

- extension/ – WebExtension (Vite, React, TS, MV3), content script wstrzykuje panel „Przymierzator” w Shadow DOM, background service worker obsługuje komunikację/płatności.
- backend/ – NestJS API (auth JWT placeholder, ai/generate mock, payments/Stripe Checkout stub).
- ai/ – miejsce na worker Banana.dev/SD (kolejka Redis, upload do S3/R2).
- shared/ – wspólne typy (BodyMetrics, GenerateRequest).

## Stack

- Frontend: WebExtensions API, React, TypeScript, Vite, Shadow DOM, CSS (bez Tailwind).
- Backend: NestJS, JWT, Stripe Checkout/Webhooks, plan: Prisma + PostgreSQL, Redis (kolejka AI), S3/R2 storage.
- AI: Banana.dev GPU, Stable Diffusion try-on pipeline (selfie + produkt + metryki + kategoria), wynik: obraz + analiza fit.

## Szybki start

1. Zainstaluj zależności: `cd extension && npm install` oraz `cd backend && npm install`.
2. Dev backend: `cd backend && npm run start:dev` (domyślnie http://localhost:4000/api).
3. Dev extension: `cd extension && npm run dev` (Vite build; dla MV3 użyj build i załaduj `extension/dist` jako „Load unpacked”).
4. W panelu (content script) endpoint AI domyślnie wskazuje `http://localhost:4000/ai/generate` – dostosuj do środowiska.

## Build

- Extension: `cd extension && npm run build` → pliki w `extension/dist`; załaduj jako unpacked w Chrome (MV3).
- Backend: `cd backend && npm run build` → wyjście w `backend/dist`; uruchom `npm start`.

## Konfiguracja backendu (env)

- PORT (domyślnie 4000)
- JWT_SECRET
- STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO
- CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL
- (plan) DATABASE_URL (PostgreSQL), REDIS_URL, S3/R2 credentials

## API (wstępne)

- POST /api/auth/login – mock login, zwraca JWT.
- POST /api/ai/generate – przyjmuje { productUrl, category, metrics, selfieUrl? }, zwraca podgląd (mock) i notę o dopasowaniu.
- POST /api/payments/checkout – przyjmuje { pack: 'starter' | 'pro' }, zwraca checkoutUrl Stripe.

## TODO (skrót głównych prac)

- Extension build + ikony, test MV3.
- Stripe checkout + webhook verification + księgowanie tokenów w DB (Prisma schema users/tokens).
- AI worker: kolejka Redis → Banana.dev → upload S3/R2 → realny URL i analiza fit.
- Persystencja metryk/selfie + zgody/retencja; synchronizacja tokenów z backendem.
- Bezpieczeństwo: rate limiting, auth guard na /ai, walidacja uploadów, audyt npm vulnerabilities.

## Uwagi dot. compliance

- Wymagana zgoda na przetwarzanie wizerunku; retencja obrazów ograniczona i kasowalna na żądanie.
- Przechowywanie danych w regionie UE; logi dostępu z rotacją; usuwanie danych zgodnie z RODO.
