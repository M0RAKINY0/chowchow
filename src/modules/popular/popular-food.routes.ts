import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import type { PopularFoodService } from "./popular-food.service.js";

const vendorIdSchema = z.string().uuid();
const popularFoodQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

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

export function createPopularFoodRouter(
  popularFoodService: PopularFoodService,
): Router {
  const router = Router();

  router.get(
    "/:vendorId/popular-items",
    asyncHandler(async (request, response) => {
      const query = parse(popularFoodQuerySchema.safeParse(request.query));
      const result = await popularFoodService.listPopularItems(
        vendorId(request),
        query.limit,
      );
      response.status(200).json({ data: result });
    }),
  );

  return router;
}
