import type { Request } from "express";
import { Router } from "express";
import { prisma } from "../../db.js";
import { AppError } from "../../errors.js";
import { authenticate, requireRoles } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireVendorAccess } from "../../middleware/vendor-access.js";
import type { RequestMetadata } from "../auth/auth.service.js";
import {
  cancelOrderSchema,
  orderIdSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
} from "../../../schemas/order.schemas.js";
import type { OrderService } from "./order.service.js";

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

function pathId(request: Request): string {
  return parse(orderIdSchema.safeParse(request.params.orderId));
}

function requestMetadata(request: Request): RequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.get("user-agent") ?? undefined,
  };
}

export function createOrderRouter(orderService: OrderService): Router {
  const router = Router();
  const orderAccess = [
    authenticate,
    requireRoles("CUSTOMER", "VENDOR", "ADMIN"),
  ];

  router.get(
    "/",
    ...orderAccess,
    asyncHandler(async (request, response) => {
      const result = await orderService.listOrders(
        { id: request.auth!.id, role: request.auth!.role },
        parse(orderListQuerySchema.safeParse(request.query)),
      );
      response.status(200).json({ data: result });
    }),
  );

  router.get(
    "/:orderId",
    ...orderAccess,
    asyncHandler(async (request, response) => {
      const result = await orderService.getOrder(pathId(request), {
        id: request.auth!.id,
        role: request.auth!.role,
      });
      response.status(200).json({ data: result });
    }),
  );

  router.patch(
    "/:orderId/status",
    ...orderAccess,
    asyncHandler(async (request, response) => {
      const result = await orderService.updateStatus(
        pathId(request),
        { id: request.auth!.id, role: request.auth!.role },
        parse(updateOrderStatusSchema.safeParse(request.body)),
        requestMetadata(request),
      );
      response.status(200).json({ data: result });
    }),
  );

  router.post(
    "/:orderId/cancel",
    authenticate,
    requireRoles("CUSTOMER", "ADMIN", "VENDOR"),
    asyncHandler(async (request, response) => {
      const cancellation = parse(cancelOrderSchema.safeParse(request.body));
      const result = await orderService.updateStatus(
        pathId(request),
        { id: request.auth!.id, role: request.auth!.role },
        { status: "CANCELLED", note: cancellation.note },
        requestMetadata(request),
      );
      response.status(200).json({ data: result });
    }),
  );

  return router;
}

export function createVendorOrderRouter(orderService: OrderService): Router {
  const router = Router();
  router.get(
    "/:vendorId/orders",
    authenticate,
    requireRoles("VENDOR", "ADMIN"),
    requireVendorAccess(prisma),
    asyncHandler(async (request, response) => {
      const vendorId = request.params.vendorId;
      const query = parse(
        orderListQuerySchema.safeParse({ ...request.query, vendorId }),
      );
      const result = await orderService.listOrders(
        { id: request.auth!.id, role: request.auth!.role },
        query,
      );
      response.status(200).json({ data: result });
    }),
  );
  return router;
}
