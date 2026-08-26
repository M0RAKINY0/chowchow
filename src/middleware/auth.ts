import type { RequestHandler } from "express";
import { AppError } from "../errors.js";
import { asyncHandler } from "./async-handler.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";

export const authenticate: RequestHandler = asyncHandler(async (request, _response, next) => {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication is required");
  }

  try {
    const claims = await verifyAccessToken(authorization.slice("Bearer ".length).trim(), process.env.JWT_ACCESS_SECRET!);
    request.auth = { id: claims.sub, role: claims.role };
    next();
  } catch {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication is required");
  }
});

export function requireRoles(...roles: Array<"CUSTOMER" | "VENDOR" | "ADMIN">): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth) {
      next(new AppError(401, "AUTH_UNAUTHORIZED", "Authentication is required"));
      return;
    }

    if (!roles.includes(request.auth.role)) {
      next(new AppError(403, "FORBIDDEN", "You do not have permission to perform this action"));
      return;
    }

    next();
  };
}
