# Reorganize Tests and Validation Schemas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every automated test file into a top-level `tests/` tree and centralize the application’s Zod validation schemas under a top-level `schemas/` directory without changing runtime behavior.

**Architecture:** Production code remains under `src/`. Tests move to `tests/` while preserving their current domain/module subdirectories so unit and integration boundaries stay recognizable. The four application validation modules move to `schemas/`; `prisma/schema.prisma` remains under `prisma/` because it is the Prisma migration/source-of-truth boundary rather than an application validation module.

**Tech Stack:** TypeScript, NodeNext ESM imports, Vitest, Express, Zod, Prisma, PostgreSQL, Redis.

## Global Constraints

- Keep all production behavior unchanged; this is a file-organization refactor.
- Preserve `.js` extensions in TypeScript ESM imports.
- Vitest must discover `tests/**/*.test.ts` and load `tests/test-setup.ts`.
- TypeScript production builds must compile `src/**/*.ts` and `schemas/**/*.ts`.
- Keep `prisma/schema.prisma`, `prisma/migrations`, and `prisma/seed.ts` in the Prisma-owned directory.
- Preserve unrelated working-tree files, including the existing untracked `artifacts/` directory.

---

### Task 1: Move application validation schemas

**Files:**

- Create: `schemas/auth.schemas.ts`
- Create: `schemas/cart.schemas.ts`
- Create: `schemas/order.schemas.ts`
- Create: `schemas/vendor.schemas.ts`
- Modify: `src/middleware/vendor-access.ts`
- Modify: `src/modules/auth/auth.routes.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/cart/cart.routes.ts`
- Modify: `src/modules/cart/cart.service.ts`
- Modify: `src/modules/orders/order.routes.ts`
- Modify: `src/modules/orders/order.service.ts`
- Modify: `src/modules/vendors/vendor.routes.ts`
- Modify: `src/modules/vendors/vendor.service.ts`

**Interfaces:**

- Preserve every existing exported schema and inferred input type.
- Production modules import from `schemas/<name>.schemas.js` using paths relative to their current source location.

- [ ] Move the four `src/modules/*/*.schemas.ts` files to `schemas/` without changing their contents.
- [ ] Update all production imports to the new root-level schema paths.
- [ ] Confirm there are no remaining production references to `src/modules/*/*.schemas.js`.

### Task 2: Move tests and test setup

**Files:**

- Create: `tests/app.test.ts`
- Create: `tests/config.test.ts`
- Create: `tests/prisma-seed.test.ts`
- Create: `tests/test-setup.ts`
- Create: `tests/docs/docs.integration.test.ts`
- Create: `tests/domain/money.test.ts`
- Create: `tests/middleware/auth.test.ts`
- Create: `tests/modules/auth/auth.integration.test.ts`
- Create: `tests/modules/auth/password.test.ts`
- Create: `tests/modules/auth/tokens.test.ts`
- Create: `tests/modules/cart/cart.integration.test.ts`
- Create: `tests/modules/notifications/notification.worker.test.ts`
- Create: `tests/modules/orders/orders.integration.test.ts`
- Create: `tests/modules/popular/popular-food.integration.test.ts`
- Create: `tests/modules/vendors/vendors.integration.test.ts`
- Modify: `vitest.config.mjs`
- Modify: every moved test file’s relative source imports

**Interfaces:**

- Vitest discovers all moved tests through `tests/**/*.test.ts`.
- The setup file continues to set the test database, Redis database, and test secrets before imports execute.

- [ ] Move all fourteen `*.test.ts` files and `src/test-setup.ts` into the mirrored `tests/` tree.
- [ ] Rewrite each moved test’s relative imports so they resolve into `src/` from its new location.
- [ ] Change Vitest’s include glob to `tests/**/*.test.ts` and setup path to `./tests/test-setup.ts`.
- [ ] Confirm no test files remain under `src/` and no config references `src/test-setup.ts`.

### Task 3: Update repository documentation

**Files:**

- Modify: `README.md`

- [ ] Update the test setup reference from `src/test-setup.ts` to `tests/test-setup.ts`.
- [ ] Update the project layout to document `tests/` and `schemas/` and keep the Prisma schema under `prisma/`.

- [ ] Update TypeScript’s root/output configuration and production start paths for the top-level `schemas/` imports.

### Task 4: Verify the refactor

**Files:**

- No additional source files.

- [ ] Run `npm test` and confirm all existing tests pass.
- [ ] Run `npm run build` and confirm TypeScript compilation passes.
- [ ] Run `npm run lint` and confirm the new paths satisfy ESLint.
- [ ] Run `npx prettier --check src tests schemas package.json README.md vitest.config.mjs` and confirm formatting passes.
- [ ] Inspect `git diff --stat` and `git status --short` to confirm only the intended organization/documentation changes are present, leaving `artifacts/` untouched.
