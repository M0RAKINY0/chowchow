import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../errors.js";
import { logger } from "../../logger.js";
import {
  invalidatePopularFoodCache,
  type PopularFoodCache,
  type PopularFoodItem,
} from "./popular-food.cache.js";

const MAX_CACHED_ITEMS = 50;

type PopularFoodRow = {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  imageUrl: string | null;
  orderCount: number | bigint;
};

function notFound(): AppError {
  return new AppError(
    404,
    "VENDOR_NOT_FOUND",
    "Vendor was not found or is not accepting orders",
  );
}

export function createPopularFoodService(input: {
  prisma: PrismaClient;
  cache: PopularFoodCache;
}) {
  async function assertActiveVendor(vendorId: string): Promise<void> {
    const vendor = await input.prisma.vendor.findFirst({
      where: { id: vendorId, isActive: true },
      select: { id: true },
    });
    if (!vendor) {
      throw notFound();
    }
  }

  async function queryPopularItems(
    vendorId: string,
  ): Promise<PopularFoodItem[]> {
    const rows = await input.prisma.$queryRaw<PopularFoodRow[]>(Prisma.sql`
      SELECT
        mi."id",
        mi."name",
        mi."description",
        mi."priceKobo",
        mi."imageUrl",
        COALESCE(
          SUM(CASE WHEN o."id" IS NULL THEN 0 ELSE oi."quantity" END),
          0
        )::int AS "orderCount"
      FROM "MenuItem" mi
      LEFT JOIN "OrderItem" oi ON oi."menuItemId" = mi."id"
      LEFT JOIN "Order" o
        ON o."id" = oi."orderId"
        AND o."vendorId" = mi."vendorId"
        AND o."status" <> CAST('CANCELLED' AS "OrderStatus")
      WHERE mi."vendorId" = CAST(${vendorId} AS uuid)
        AND mi."isAvailable" = true
      GROUP BY mi."id", mi."name", mi."description", mi."priceKobo", mi."imageUrl"
      HAVING COALESCE(SUM(CASE WHEN o."id" IS NULL THEN 0 ELSE oi."quantity" END), 0) > 0
      ORDER BY "orderCount" DESC, mi."name" ASC, mi."id" ASC
      LIMIT ${MAX_CACHED_ITEMS}
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      priceKobo: row.priceKobo,
      imageUrl: row.imageUrl,
      orderCount: Number(row.orderCount),
    }));
  }

  async function getCachedItems(
    vendorId: string,
  ): Promise<PopularFoodItem[] | null> {
    try {
      return await input.cache.get(vendorId);
    } catch (error) {
      logger.warn(
        { err: error, vendorId },
        "Unable to read popular food cache",
      );
      return null;
    }
  }

  async function setCachedItems(
    vendorId: string,
    items: PopularFoodItem[],
  ): Promise<void> {
    try {
      await input.cache.set(vendorId, items);
    } catch (error) {
      logger.warn(
        { err: error, vendorId },
        "Unable to write popular food cache",
      );
    }
  }

  async function listPopularItems(vendorId: string, limit: number) {
    await assertActiveVendor(vendorId);
    const cachedItems = await getCachedItems(vendorId);
    if (cachedItems) {
      return { items: cachedItems.slice(0, limit), source: "cache" as const };
    }

    const items = await queryPopularItems(vendorId);
    await setCachedItems(vendorId, items);
    return { items: items.slice(0, limit), source: "database" as const };
  }

  return {
    listPopularItems,
    invalidateVendor: (vendorId: string) =>
      invalidatePopularFoodCache(input.cache, vendorId),
  };
}

export type PopularFoodService = ReturnType<typeof createPopularFoodService>;
