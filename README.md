# Chowchow Backend

Backend-only multi-vendor food ordering API built with Express, TypeScript, Prisma, PostgreSQL, Redis, Resend, Sentry, and Vitest.

The API is designed as a capability demo: customers can browse menus, manage a vendor-specific cart, check out idempotently, and follow an order through its lifecycle. Vendors receive asynchronous order/status email notifications through a transactional PostgreSQL outbox. Redis caches per-vendor popular food, while PostgreSQL remains the source of truth.

## What is included

- Versioned REST API under `/api/v1`.
- Customer, vendor, and admin roles with JWT access tokens, rotating refresh tokens, Argon2id password hashing, rate-limited auth routes, and audit events.
- Vendor/menu management with vendor-membership isolation.
- One-vendor carts, integer NGN kobo totals, price snapshots, availability revalidation, and checkout idempotency via `Idempotency-Key`.
- Order lifecycle validation, status history, cancellation rules, and role-scoped order queries.
- Transactional notification outbox with console and Resend adapters, retry/backoff, stale-lock recovery, and Sentry capture for exhausted failures.
- Redis-backed `GET /api/v1/vendors/:vendorId/popular-items` with PostgreSQL fallback and cache invalidation after order/menu changes.
- Swagger UI at [`/docs`](http://localhost:4000/docs) and the raw OpenAPI document at [`/docs/openapi.json`](http://localhost:4000/docs/openapi.json).

## Requirements

- Node.js 22 or newer
- npm
- PostgreSQL 15+ running locally
- Docker Desktop (recommended for the Redis service)

The local development database in this workspace is `food_ordering_dev` with the PostgreSQL user `postgres`. Keep the password in `.env`; never commit it.

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `SEED_PASSWORD`. For the local database used by this project:

   ```text
   DATABASE_URL=postgresql://postgres:<password>@localhost:5432/food_ordering_dev?schema=public
   ```

3. Start Redis:

   ```powershell
   docker compose up -d redis
   ```

4. Apply migrations and seed the demo data:

   ```powershell
   npm run db:migrate:deploy
   npm run db:seed
   ```

5. Start the API in one terminal and the notification worker in another:

   ```powershell
   npm run dev
   npm run dev:worker
   ```

   With `EMAIL_PROVIDER=console`, the worker logs email messages instead of calling Resend. To send real email, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a verified `EMAIL_FROM` address.

## Demo walkthrough

The seed creates these accounts: `customer@chowchow.local`, `vendor.one@chowchow.local`, `vendor.two@chowchow.local`, and `admin@chowchow.local`. They all use the `SEED_PASSWORD` value from `.env`.

1. Open [`http://localhost:4000/docs`](http://localhost:4000/docs), or log in directly:

   ```powershell
   $seedPassword = '<SEED_PASSWORD from .env>'
   $login = Invoke-RestMethod http://localhost:4000/api/v1/auth/login -Method Post -ContentType 'application/json' -Body (@{
     email = 'customer@chowchow.local'
     password = $seedPassword
   } | ConvertTo-Json)
   $token = $login.data.accessToken
   ```

2. List vendors and fetch a menu:

   ```powershell
   $vendors = Invoke-RestMethod http://localhost:4000/api/v1/vendors
   $vendorId = $vendors.data.items[0].id
   $menu = Invoke-RestMethod "http://localhost:4000/api/v1/vendors/$vendorId/menu"
   $menuItemId = $menu.data.categories[0].items[0].id
   ```

3. Add food to the cart and check out. The same idempotency key can safely be retried:

   ```powershell
   Invoke-RestMethod "http://localhost:4000/api/v1/carts/$vendorId/items" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (@{
     menuItemId = $menuItemId
     quantity = 1
   } | ConvertTo-Json)

   $order = Invoke-RestMethod http://localhost:4000/api/v1/checkout -Method Post -Headers @{
     Authorization = "Bearer $token"
     'Idempotency-Key' = 'demo-checkout-001'
   } -ContentType 'application/json' -Body (@{
     vendorId = $vendorId
     deliveryAddress = '1 Demo Street, Lagos'
     paymentMethod = 'CASH_ON_DELIVERY'
   } | ConvertTo-Json)
   ```

4. The worker claims the `ORDER_CREATED` outbox row and logs the vendor email. Log in as the matching vendor to list orders and advance the order status. Each status change creates another outbox notification.

5. Query popular food after the order:

   ```powershell
   Invoke-RestMethod "http://localhost:4000/api/v1/vendors/$vendorId/popular-items?limit=5"
   ```

## Configuration

| Variable         | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string                               |
| `REDIS_URL`      | Redis URL, default `redis://localhost:6379/0`              |
| `EMAIL_PROVIDER` | `console` for local logs or `resend` for delivery          |
| `RESEND_API_KEY` | Required when `EMAIL_PROVIDER=resend`                      |
| `EMAIL_FROM`     | Sender address accepted by Resend                          |
| `SENTRY_DSN`     | Optional Sentry DSN; secrets and auth headers are redacted |
| `CORS_ORIGIN`    | Comma-separated allowed origins                            |
| `LOG_LEVEL`      | Pino log level                                             |

## Verification commands

```powershell
npm test
npm run build
npx prettier --check `
  README.md package.json tsconfig.json vitest.config.mjs `
  schemas/*.ts tests/**/*.ts `
  src/middleware/vendor-access.ts `
  src/modules/auth/auth.routes.ts src/modules/auth/auth.service.ts `
  src/modules/cart/cart.routes.ts src/modules/cart/cart.service.ts `
  src/modules/orders/order.routes.ts src/modules/orders/order.service.ts `
  src/modules/vendors/vendor.routes.ts src/modules/vendors/vendor.service.ts
```

Run `npm run db:migrate:deploy` and `npm run db:seed` against a configured local database before a demo. Tests use the separate `food_ordering_test` database configured by `tests/test-setup.ts`.

## Project layout

```text
src/app.ts                         Express composition and docs routes
src/modules/auth                  Authentication, JWT, roles, and audit events
src/modules/vendors               Vendor/menu APIs and cache invalidation
src/modules/cart                  Cart and checkout transaction
src/modules/orders                Order queries and lifecycle transitions
src/modules/notifications         Transactional email outbox worker
src/modules/popular               Popular-food query, Redis adapter, and route
src/docs/openapi.ts                OpenAPI document served by Swagger UI
schemas/*.schemas.ts               Shared Zod request validation schemas
tests/                              Unit and integration tests
prisma/schema.prisma               PostgreSQL source-of-truth schema
docker-compose.yml                 Local Redis service
```
