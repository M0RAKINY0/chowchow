import express from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../src/db.js";
import {
  createMemoryPopularFoodCache,
  createRedisPopularFoodCache,
  type PopularFoodCache,
} from "../../../src/modules/popular/popular-food.cache.js";
import { createPopularFoodRouter } from "../../../src/modules/popular/popular-food.routes.js";
import { createPopularFoodService } from "../../../src/modules/popular/popular-food.service.js";

const vendorIds: string[] = [];
const userIds: string[] = [];

async function createPopularVendor() {
  const user = await prisma.user.create({
    data: {
      email: `popular-${randomUUID()}@example.com`,
      passwordHash: "test-hash",
      fullName: "Popular Food Customer",
    },
  });
  const vendor = await prisma.vendor.create({
    data: {
      name: "Popular Food Vendor",
      slug: `popular-${randomUUID()}`,
      notificationEmail: "vendor@example.com",
      deliveryFeeKobo: 500,
    },
  });
  const category = await prisma.menuCategory.create({
    data: { vendorId: vendor.id, name: "Popular Test Meals" },
  });
  const jollof = await prisma.menuItem.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      name: "Popular Jollof",
      description: "Test jollof",
      priceKobo: 2_500,
    },
  });
  const pasta = await prisma.menuItem.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      name: "Popular Pasta",
      description: "Test pasta",
      priceKobo: 3_000,
    },
  });

  vendorIds.push(vendor.id);
  userIds.push(user.id);
  return { user, vendor, jollof, pasta };
}

async function createOrder(input: {
  customerId: string;
  vendorId: string;
  status: "DELIVERED" | "CANCELLED";
  orderNumber: string;
  items: Array<{
    menuItemId: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceKobo: number;
  }>;
}) {
  return prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      customerId: input.customerId,
      vendorId: input.vendorId,
      status: input.status,
      subtotalKobo: 10_000,
      deliveryFeeKobo: 500,
      totalKobo: 10_500,
      deliveryAddress: "1 Popular Street",
      items: {
        create: input.items.map((item) => ({
          menuItemId: item.menuItemId,
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          unitPriceKobo: item.unitPriceKobo,
          lineTotalKobo: item.quantity * item.unitPriceKobo,
        })),
      },
      statusHistory: {
        create: { toStatus: input.status, actorUserId: input.customerId },
      },
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  for (const vendorId of vendorIds.splice(0)) {
    await prisma.order.deleteMany({ where: { vendorId } });
    await prisma.menuItem.deleteMany({ where: { vendorId } });
    await prisma.menuCategory.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
  }
  for (const userId of userIds.splice(0)) {
    await prisma.user.delete({ where: { id: userId } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("popular food cache and ranking", () => {
  it("ranks available menu items and excludes cancelled orders", async () => {
    const { user, vendor, jollof, pasta } = await createPopularVendor();
    await createOrder({
      customerId: user.id,
      vendorId: vendor.id,
      status: "DELIVERED",
      orderNumber: `CHW-POPULAR-${randomUUID()}`,
      items: [
        {
          menuItemId: jollof.id,
          nameSnapshot: jollof.name,
          quantity: 4,
          unitPriceKobo: jollof.priceKobo,
        },
        {
          menuItemId: pasta.id,
          nameSnapshot: pasta.name,
          quantity: 2,
          unitPriceKobo: pasta.priceKobo,
        },
      ],
    });
    await createOrder({
      customerId: user.id,
      vendorId: vendor.id,
      status: "CANCELLED",
      orderNumber: `CHW-CANCELLED-${randomUUID()}`,
      items: [
        {
          menuItemId: pasta.id,
          nameSnapshot: pasta.name,
          quantity: 99,
          unitPriceKobo: pasta.priceKobo,
        },
      ],
    });

    const service = createPopularFoodService({
      prisma,
      cache: createMemoryPopularFoodCache(),
    });
    const first = await service.listPopularItems(vendor.id, 10);
    const second = await service.listPopularItems(vendor.id, 1);

    expect(first.source).toBe("database");
    expect(first.items).toMatchObject([
      { id: jollof.id, name: jollof.name, orderCount: 4 },
      { id: pasta.id, name: pasta.name, orderCount: 2 },
    ]);
    expect(second).toMatchObject({
      source: "cache",
      items: [{ id: jollof.id, orderCount: 4 }],
    });

    await service.invalidateVendor(vendor.id);
    await expect(
      service.listPopularItems(vendor.id, 10),
    ).resolves.toMatchObject({ source: "database" });
  });

  it("falls back to the database when the cache is unavailable", async () => {
    const { user, vendor, jollof } = await createPopularVendor();
    await createOrder({
      customerId: user.id,
      vendorId: vendor.id,
      status: "DELIVERED",
      orderNumber: `CHW-FALLBACK-${randomUUID()}`,
      items: [
        {
          menuItemId: jollof.id,
          nameSnapshot: jollof.name,
          quantity: 1,
          unitPriceKobo: jollof.priceKobo,
        },
      ],
    });
    const cache: PopularFoodCache = {
      get: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      set: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      invalidate: vi.fn().mockResolvedValue(undefined),
    };
    const service = createPopularFoodService({ prisma, cache });

    await expect(
      service.listPopularItems(vendor.id, 10),
    ).resolves.toMatchObject({
      source: "database",
      items: [{ id: jollof.id, orderCount: 1 }],
    });
  });

  it("serializes Redis values with a TTL and invalidates the vendor key", async () => {
    const client = {
      isReady: true,
      get: vi.fn(),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const cache = createRedisPopularFoodCache({
      redisUrl: "redis://localhost:6379/1",
      ttlSeconds: 120,
      client,
    });
    const items = [
      {
        id: "menu-item-1",
        name: "Jollof",
        description: null,
        priceKobo: 2_500,
        imageUrl: null,
        orderCount: 5,
      },
    ];

    await cache.set("vendor-1", items);
    expect(client.set).toHaveBeenCalledWith(
      "popular-food:vendor-1:v1",
      JSON.stringify(items),
      { EX: 120 },
    );
    client.get.mockResolvedValueOnce(JSON.stringify(items));
    await expect(cache.get("vendor-1")).resolves.toEqual(items);
    await cache.invalidate("vendor-1");
    expect(client.del).toHaveBeenCalledWith("popular-food:vendor-1:v1");
  });

  it("validates the public popular-items route and returns the service result", async () => {
    const service = {
      listPopularItems: vi.fn().mockResolvedValue({
        source: "cache",
        items: [
          {
            id: "menu-item-1",
            name: "Jollof",
            description: null,
            priceKobo: 2_500,
            imageUrl: null,
            orderCount: 5,
          },
        ],
      }),
      invalidateVendor: vi.fn().mockResolvedValue(undefined),
    };
    const app = express();
    app.use("/vendors", createPopularFoodRouter(service));

    const response = await request(app).get(
      "/vendors/00000000-0000-0000-0000-000000000001/popular-items?limit=1",
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      source: "cache",
      items: [{ name: "Jollof" }],
    });
    expect(service.listPopularItems).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      1,
    );

    const invalidResponse = await request(app).get(
      "/vendors/00000000-0000-0000-0000-000000000001/popular-items?limit=0",
    );
    expect(invalidResponse.status).toBe(400);
  });
});
