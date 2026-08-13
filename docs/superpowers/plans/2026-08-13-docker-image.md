# Docker Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one production-ready Docker image that can run either the Chowchow API or notification worker while PostgreSQL remains external.

**Architecture:** A multi-stage Node 22 Debian image installs all dependencies and generates Prisma in the build stage, compiles TypeScript, prunes development dependencies, and copies only runtime assets into a non-root final stage. The final image starts the API by default; deployment tooling can override the command to start the worker.

**Tech Stack:** Docker, Node.js 22, npm, TypeScript, Prisma, Express, PostgreSQL outside Docker, Redis supplied through runtime configuration.

## Global Constraints

- PostgreSQL remains outside Docker and is configured with `DATABASE_URL` at runtime.
- No credentials or `.env` files are copied into the image.
- The final image runs as the non-root `node` user.
- The image exposes port `4000` and uses `/health/live` for its health check.
- No deployment, registry push, or cloud-specific configuration is included.

---

### Task 1: Build the production image

**Files:**

- Create: `Dockerfile`

**Interfaces:**

- Produces an image whose default command is `node dist/src/server.js`.
- Produces an image that can run `node dist/src/worker.js` as a command override.

- [ ] **Step 1: Add the multi-stage Dockerfile**

  Use `node:22-bookworm-slim`, run `npm ci`, generate Prisma from `prisma/schema.prisma`, compile `src` and `schemas`, prune development dependencies, copy only `package.json`, production `node_modules`, and `dist` into the runtime stage, set `NODE_ENV=production`, use `USER node`, expose `4000`, and add a `/health/live` health check.

- [ ] **Step 2: Build the image**

  Run: `docker build --tag chowchow-backend:local .`

  Expected: the image builds with exit code `0`. If Docker Desktop is not running, record that limitation and continue with static and application verification.

- [ ] **Step 3: Commit the image definition**

  Run: `git add Dockerfile && git commit -m "build: add production Docker image"`

### Task 2: Define the Docker build context and usage documentation

**Files:**

- Create: `.dockerignore`
- Create: `docker.env.example`
- Modify: `README.md`

**Interfaces:**

- Produces a safe Docker context that excludes secrets and local-only files.
- Documents how to build the image, run the API, and run the worker against external PostgreSQL and Redis.

- [ ] **Step 1: Add the Docker ignore rules**

  Exclude `.git`, `.env`, `.env.*`, `node_modules`, `dist`, coverage output, logs, tests, local artifacts, editor metadata, and Docker Compose local data while retaining `.env.example` as documentation only.

- [ ] **Step 2: Add a safe container environment example**

  Provide placeholders for `DATABASE_URL`, `REDIS_URL`, JWT secrets, email settings, Sentry, CORS, and logging. Use `host.docker.internal` only in the local Docker example and explain that deployed environments must use their managed service hostnames.

- [ ] **Step 3: Document API and worker commands**

  Document:

  ```powershell
  docker build --tag chowchow-backend:local .
  docker run --rm --name chowchow-api --env-file docker.env -p 4000:4000 chowchow-backend:local
  docker run --rm --name chowchow-worker --env-file docker.env chowchow-backend:local node dist/src/worker.js
  ```

- [ ] **Step 4: Run application verification**

  Run: `npm test`, `npm run build`, `npm run lint`, and `npm run docs:export`.

  Expected: all commands exit with code `0`; the Docker build is separately verified when the daemon is available.

- [ ] **Step 5: Commit the context and documentation**

  Run: `git add .dockerignore docker.env.example README.md && git commit -m "docs: document Docker image usage"`
