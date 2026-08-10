import type { Request } from "express";
import { Router } from "express";
import { AppError } from "../../errors.js";
import { authenticate, requireRoles } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import {
  addCartItemSchema,
  cartItemIdSchema,
  checkoutSchema,
  idempotencyKeySchema,
  updateCartItemSchema,
  vendorIdSchema,
} from "./cart.schemas.js";
import type { CartService } from "./cart.service.js";
import type { RequestMetadata } from "../auth/auth.service.js";

function parse<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { flatten: () => unknown } },
): T {
  if (!result.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      result.error.flatten(),
    );
  }
  return result.data;
}

function pathId(request: Request, name: string): string {
  return parse(vendorIdSchema.safeParse(request.params[name]));
}

function requestMetadata(request: Request): RequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.get("user-agent") ?? undefined,
  };
}

function idempotencyKey(request: Request): string {
  return parse(idempotencyKeySchema.safeParse(request.get("Idempotency-Key")));
}

export function createCartRouter(cartService: CartService): Router {
  const router = Router();
  const customerAccess = [authenticate, requireRoles("CUSTOMER")];

  router.get(
    "/:vendorId",
    ...customerAccess,
    asyncHandler(async (request, response) => {
      const cart = await cartService.getCart(
        request.auth!.id,
        pathId(request, "vendorId"),
      );
      response.status(200).json({ data: cart });
    }),
  );

  router.post(
    "/:vendorId/items",
    ...customerAccess,
    asyncHandler(async (request, response) => {
      const cart = await cartService.addItem(
        request.auth!.id,
        pathId(request, "vendorId"),
        parse(addCartItemSchema.safeParse(request.body)),
      );
      response.status(201).json({ data: cart });
    }),
  );

  router.patch(
    "/:vendorId/items/:cartItemId",
    ...customerAccess,
    asyncHandler(async (request, response) => {
      const cart = await cartService.updateItem(
        request.auth!.id,
        pathId(request, "vendorId"),
        parse(cartItemIdSchema.safeParse(request.params.cartItemId)),
        parse(updateCartItemSchema.safeParse(request.body)),
      );
      response.status(200).json({ data: cart });
    }),
  );

  router.delete(
    "/:vendorId/items/:cartItemId",
    ...customerAccess,
    asyncHandler(async (request, response) => {
      await cartService.removeItem(
        request.auth!.id,
        pathId(request, "vendorId"),
        parse(cartItemIdSchema.safeParse(request.params.cartItemId)),
      );
      response.status(204).send();
    }),
  );

  return router;
}

export function createCheckoutRouter(cartService: CartService): Router {
  const router = Router();
  router.post(
    "/",
    authenticate,
    requireRoles("CUSTOMER"),
    asyncHandler(async (request, response) => {
      const result = await cartService.checkout(
        request.auth!.id,
        parse(checkoutSchema.safeParse(request.body)),
        idempotencyKey(request),
        requestMetadata(request),
      );
      response.status(result.replayed ? 200 : 201).json({ data: result });
    }),
  );
  return router;
}
