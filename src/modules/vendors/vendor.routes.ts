import type { Request } from "express";
import { Router } from "express";
import { AppError } from "../../errors.js";
import { authenticate, requireRoles } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireVendorAccess } from "../../middleware/vendor-access.js";
import type { RequestMetadata } from "../auth/auth.service.js";
import { prisma } from "../../db.js";
import {
  createCategorySchema,
  createMenuItemSchema,
  createVendorSchema,
  updateCategorySchema,
  updateMenuItemSchema,
  updateVendorSchema,
  vendorIdSchema,
  vendorListQuerySchema,
} from "../../../schemas/vendor.schemas.js";
import type { VendorService } from "./vendor.service.js";

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

function vendorId(request: Request): string {
  return parse(vendorIdSchema.safeParse(request.params.vendorId));
}

function requestMetadata(request: Request): RequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.get("user-agent") ?? undefined,
  };
}

export function createVendorRouter(vendorService: VendorService): Router {
  const router = Router();
  const vendorManagement = [
    authenticate,
    requireRoles("ADMIN", "VENDOR"),
    requireVendorAccess(prisma),
  ];

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const query = parse(vendorListQuerySchema.safeParse(request.query));
      const result = await vendorService.listPublicVendors(query);
      response.status(200).json({ data: result });
    }),
  );

  router.post(
    "/",
    authenticate,
    requireRoles("ADMIN"),
    asyncHandler(async (request, response) => {
      const input = parse(createVendorSchema.safeParse(request.body));
      const vendor = await vendorService.createVendor(
        request.auth!.id,
        input,
        requestMetadata(request),
      );
      response.status(201).json({ data: { vendor } });
    }),
  );

  router.get(
    "/:vendorId/menu",
    asyncHandler(async (request, response) => {
      const result = await vendorService.getPublicMenu(vendorId(request));
      response.status(200).json({ data: result });
    }),
  );

  router.get(
    "/:vendorId",
    asyncHandler(async (request, response) => {
      const vendor = await vendorService.getPublicVendor(vendorId(request));
      response.status(200).json({ data: { vendor } });
    }),
  );

  router.patch(
    "/:vendorId",
    authenticate,
    requireRoles("ADMIN"),
    asyncHandler(async (request, response) => {
      const input = parse(updateVendorSchema.safeParse(request.body));
      const vendor = await vendorService.updateVendor(
        request.auth!.id,
        vendorId(request),
        input,
        requestMetadata(request),
      );
      response.status(200).json({ data: { vendor } });
    }),
  );

  router.post(
    "/:vendorId/categories",
    ...vendorManagement,
    asyncHandler(async (request, response) => {
      const category = await vendorService.createCategory(
        request.auth!.id,
        vendorId(request),
        parse(createCategorySchema.safeParse(request.body)),
        requestMetadata(request),
      );
      response.status(201).json({ data: { category } });
    }),
  );

  router.patch(
    "/:vendorId/categories/:categoryId",
    ...vendorManagement,
    asyncHandler(async (request, response) => {
      const category = await vendorService.updateCategory(
        request.auth!.id,
        vendorId(request),
        parse(vendorIdSchema.safeParse(request.params.categoryId)),
        parse(updateCategorySchema.safeParse(request.body)),
        requestMetadata(request),
      );
      response.status(200).json({ data: { category } });
    }),
  );

  router.post(
    "/:vendorId/menu-items",
    ...vendorManagement,
    asyncHandler(async (request, response) => {
      const menuItem = await vendorService.createMenuItem(
        request.auth!.id,
        vendorId(request),
        parse(createMenuItemSchema.safeParse(request.body)),
        requestMetadata(request),
      );
      response.status(201).json({ data: { menuItem } });
    }),
  );

  router.patch(
    "/:vendorId/menu-items/:menuItemId",
    ...vendorManagement,
    asyncHandler(async (request, response) => {
      const menuItem = await vendorService.updateMenuItem(
        request.auth!.id,
        vendorId(request),
        parse(vendorIdSchema.safeParse(request.params.menuItemId)),
        parse(updateMenuItemSchema.safeParse(request.body)),
        requestMetadata(request),
      );
      response.status(200).json({ data: { menuItem } });
    }),
  );

  return router;
}
