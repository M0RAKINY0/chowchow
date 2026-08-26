# Chowchow Backend Implementation Plan

> **For agentic workers:** Execute the chunks in order. Each chunk must follow a red-green-refactor test cycle, pass its stated checks, then be committed and pushed before the next chunk begins.

**Goal:** Build a multi-vendor Chowdeck-like ordering REST API with authentication, order processing, Resend notifications, Sentry error logging, audit logging, and Redis popular-item caching.

**Architecture:** A modular Express API and a separate notification worker use PostgreSQL/Prisma as the source of truth. Redis stores only popular-item rankings, while a transactional PostgreSQL outbox guarantees that email delivery can retry independently from order writes.

**Tech Stack:** Node.js LTS, npm, TypeScript, Express, Prisma, PostgreSQL, Redis/ioredis, Resend, Sentry, Zod, Vitest, Supertest, Pino, and Swagger UI.

## Global Constraints

- Backend only; no frontend is included.
- API routes are versioned under `/api/v1`.
- Roles are `CUSTOMER`, `VENDOR`, and `ADMIN`.
- Money is stored as integer NGN kobo; order total is subtotal plus vendor delivery fee.
- Checkout uses a server-side cart and requires an `Idempotency-Key`.
- Access JWTs last 15 minutes; refresh tokens last 30 days, rotate, and are stored hashed.
- Order states are `PENDING_VENDOR_CONFIRMATION`, `CONFIRMED`, `PREPARING`, `READY_FOR_DISPATCH`, `OUT_FOR_DELIVERY`, `DELIVERED`, and `CANCELLED`.
- Resend delivery is asynchronous through a transactional outbox; `EMAIL_PROVIDER=console` is available locally and `EMAIL_PROVIDER=resend` sends real email.
- Redis is a five-minute cache for per-vendor rolling-30-day popular items and must never block order creation.
- Credentials and provider secrets must come from environment variables and never be committed.
- Every chunk requires tests before production implementation, fresh verification, a focused commit, and a push to the feature branch.

## Chunk Tasks

### Chunk 1: Project foundation

Create the npm/TypeScript project, strict compiler settings, Express app/server entrypoints, configuration validation, request IDs, structured logging, centralized error handling, health endpoints, Sentry setup, baseline test harness, `.env.example`, `.gitignore`, and README setup skeleton.

Tests: configuration validation, health route response, and error-envelope behavior.

Checks: `npm test`, `npm run build`.

Commit: `chore: bootstrap api foundation`.

### Chunk 2: Database schema and seed data

Add Prisma schema and initial migration for users, refresh tokens, vendors, memberships, menu categories/items, carts/items, orders/items, order status history, audit logs, notification outbox, and checkout idempotency records. Add deterministic seed data for two vendors, menus, customer, vendor users, and admin.

Tests: money totals and Prisma schema/seed smoke tests against the configured development/test database.

Checks: Prisma generate, migration deploy, seed, tests, and build.

Commit: `feat: add prisma schema and seed data`.

### Chunk 3: Authentication, roles, and audit logging

Implement customer registration, login, refresh rotation, logout, current-user lookup, Argon2id password hashing, JWT middleware, role and vendor-membership authorization, login rate limiting, and durable audit events for auth actions.

Tests: registration/login, invalid credentials, refresh rotation/reuse, logout revocation, role boundaries, and audit records without secrets.

Checks: targeted auth tests, full test suite, and build.

Commit: `feat: add authentication and audit logging`.

### Chunk 4: Vendors and menus

Implement vendor listing/detail, menu browsing, vendor menu/category management, availability updates, vendor ownership checks, validation, pagination, and audit events for menu mutations.

Tests: public browsing, vendor isolation, admin access, invalid prices, unavailable items, and audit records.

Checks: targeted vendor/menu tests, full test suite, and build.

Commit: `feat: add vendors and menus`.

### Chunk 5: Carts, checkout, and order creation

Implement one-vendor server-side carts, cart item updates/removals, availability and price revalidation, address snapshot, NGN subtotal/delivery/total calculation, order item snapshots, initial outbox/audit records, and idempotent checkout.

Tests: cart ownership, quantity validation, mixed-vendor rejection, price changes, unavailable items, totals, address snapshot, duplicate idempotency keys, and rollback behavior.

Checks: targeted cart/order tests, full test suite, and build.

Commit: `feat: add carts and checkout`.

### Chunk 6: Order lifecycle

Implement customer/vendor order queries, order details, status transition validation, vendor membership authorization, customer cancellation before preparation, admin operations, status history, audit events, and status notification outbox creation.

Tests: every allowed/rejected transition, customer/vendor/admin permissions, cancellation rules, history ordering, and outbox/audit consistency.

Checks: targeted lifecycle tests, full test suite, and build.

Commit: `feat: add order lifecycle`.

### Chunk 7: Resend notification worker

Implement outbox claiming, notification templates, Resend adapter, console adapter, retry/backoff, deduplication, failure recording, worker health/logging, and Sentry capture for exhausted/unexpected failures.

Tests: template content, console delivery, Resend success/failure, retry timing, deduplication, concurrent claims, and order independence from email failure.

Checks: worker tests, full test suite, and build.

Commit: `feat: add resend notification worker`.

### Chunk 8: Redis popular-items cache

Implement PostgreSQL rolling-30-day aggregation over non-cancelled confirmed-through-delivered orders, Redis sorted-set cache reads/writes, five-minute TTL, invalidation after order changes, and database fallback when Redis is unavailable.

Tests: ranking, cache hit/miss, TTL, invalidation, rebuild, vendor isolation, and Redis outage fallback.

Checks: targeted cache tests, full test suite, and build.

Commit: `feat: add popular items redis cache`.

### Chunk 9: API documentation and final verification

Add complete OpenAPI schemas/routes, Swagger UI, README demo flow, Redis Docker Compose service, environment documentation, integration smoke tests, and final error/health verification.

Checks: full test suite, build, lint/format checks, migration/seed smoke test, and end-to-end API walkthrough.

Commit: `docs: complete api documentation and verification`.
