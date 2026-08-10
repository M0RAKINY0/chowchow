import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AppError } from "../../errors.js";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { loginSchema, refreshSchema, registerSchema } from "./auth.schemas.js";
import type { AuthService, RequestMetadata } from "./auth.service.js";

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function requestMetadata(request: Parameters<typeof asyncHandler>[0] extends never ? never : any): RequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.get("user-agent") ?? undefined,
  };
}

function parseBody<T>(result: { success: true; data: T } | { success: false; error: { flatten: () => unknown } }): T {
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", result.error.flatten());
  }
  return result.data;
}

function responseData(result: Awaited<ReturnType<AuthService["register"]>>) {
  return {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessTokenExpiresIn: result.tokens.accessTokenExpiresIn,
  };
}

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post(
    "/register",
    authRateLimiter,
    asyncHandler(async (request, response) => {
      const input = parseBody(registerSchema.safeParse(request.body));
      const result = await authService.register(input, requestMetadata(request));
      response.status(201).json({ data: responseData(result) });
    }),
  );

  router.post(
    "/login",
    authRateLimiter,
    asyncHandler(async (request, response) => {
      const input = parseBody(loginSchema.safeParse(request.body));
      const result = await authService.login(input, requestMetadata(request));
      response.status(200).json({ data: responseData(result) });
    }),
  );

  router.post(
    "/refresh",
    authRateLimiter,
    asyncHandler(async (request, response) => {
      const input = parseBody(refreshSchema.safeParse(request.body));
      const result = await authService.refresh(input, requestMetadata(request));
      response.status(200).json({ data: responseData(result) });
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (request, response) => {
      const input = parseBody(refreshSchema.safeParse(request.body));
      await authService.logout(input, requestMetadata(request));
      response.status(204).send();
    }),
  );

  router.get(
    "/me",
    authenticate,
    asyncHandler(async (request, response) => {
      const user = await authService.getCurrentUser(request.auth!.id);
      response.status(200).json({ data: { user } });
    }),
  );

  return router;
}
