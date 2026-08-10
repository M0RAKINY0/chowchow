import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { AppError } from "../errors.js";
import { asyncHandler } from "./async-handler.js";
import { vendorIdSchema } from "../modules/vendors/vendor.schemas.js";

export function requireVendorAccess(prisma: PrismaClient): RequestHandler {
  return asyncHandler(async (request, _response, next) => {
    const result = vendorIdSchema.safeParse(request.params.vendorId);
    if (!result.success) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "The vendor id must be a valid UUID",
        result.error.flatten(),
      );
    }

    if (request.auth?.role === "ADMIN") {
      next();
      return;
    }

    if (!request.auth) {
      throw new AppError(
        401,
        "AUTH_UNAUTHORIZED",
        "Authentication is required",
      );
    }

    const membership = await prisma.vendorMembership.findUnique({
      where: {
        userId_vendorId: { userId: request.auth.id, vendorId: result.data },
      },
    });
    if (!membership) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "You do not have access to this vendor",
      );
    }

    next();
  });
}
