# Chowchow Docker Image Design

## Goal

Prepare Chowchow for a future deployment by producing one reusable production Docker image without containerizing PostgreSQL or deploying any service now.

## Scope

- Build a multi-stage Node.js 22 production image.
- Compile TypeScript and generate the Prisma client during the image build.
- Keep only production dependencies and compiled output in the final image.
- Run the API by default with `node dist/src/server.js`.
- Reuse the same image for the notification worker with `node dist/src/worker.js` as the command override.
- Supply database, Redis, JWT, Resend, Sentry, and other runtime settings through environment variables.
- Exclude secrets, local dependencies, test files, build output, Git metadata, and local artifacts from the Docker build context.
- Document image build and API/worker run commands.

## Non-goals

- PostgreSQL will remain outside Docker and will be reached through runtime configuration.
- This change will not deploy the image, publish it to a registry, or add cloud-specific infrastructure.
- The existing Redis-only local Compose workflow will remain available and will not be expanded into a full application stack.

## Runtime contract

The image listens on port `4000` and exposes `/health/live` for the container health check. The API and worker receive the same environment variables; the worker differs only by its startup command.

## Verification

- Run the existing unit and integration test suite.
- Run the TypeScript build and lint checks.
- Run the OpenAPI exporter and verify the committed artifact remains synchronized.
- Build the Docker image when the Docker daemon is available.
- Inspect the final image configuration and verify the API health endpoint when a container can be started.
