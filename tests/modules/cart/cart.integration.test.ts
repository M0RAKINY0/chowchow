import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { loadConfig } from "../../../src/config.js";
import { prisma } from "../../../src/db.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { createAccessToken } from "../../../src/modules/auth/tokens.js";

const app = createApp(loadConfig());

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "NotificationOutbox", "OrderStatusHistory", "OrderItem", "CheckoutIdempotency", "Order", "CartItem", "Cart", "MenuItem", "MenuCategory", "VendorMembership", "Vendor", "AuditLog", "User" RESTART IDENTITY CASCADE',
  );
}

async function createUser(input: { email: string; fullName: string }) {
  return prisma.user.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      passwordHash: await hashPassword("not-used-in-this-test"),
    },
  });
}

async function createVendor(input: { slug: string; deliveryFeeKobo: number }) {
  return prisma.vendor.create({
    data: {
      name: input.slug,
      slug: input.slug,
      notificationEmail: `${input.slug}@example.com`,
      deliveryFeeKobo: input.deliveryFeeKobo,
    },
  });
}

async function createMenuItem(
  vendorId: string,
  input: { name: string; priceKobo: number; isAvailable?: boolean },
) {
  return prisma.menuItem.create({
    data: {
      vendorId,
      name: input.name,
      priceKobo: input.priceKobo,
      isAvailable: input.isAvailable ?? true,
    },
  });
}

async function tokenFor(userId: string) {
  return createAccessToken(
    { userId, role: "CUSTOMER" },
    process.env.JWT_ACCESS_SECRET!,
  );
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(resetDatabase);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cart and checkout API", () => {
  it("keeps cart ownership isolated and validates quantities", async () => {
    const owner = await createUser({
      email: "owner@example.com",
      fullName: "Owner",
    });
    const otherCustomer = await createUser({
      email: "other@example.com",
      fullName: "Other",
    });
    const vendor = await createVendor({
      slug: "cart-vendor",
      deliveryFeeKobo: 50_000,
    });
    const item = await createMenuItem(vendor.id, {
      name: "Jollof",
      priceKobo: 120_000,
    });
    const ownerToken = await tokenFor(owner.id);
    const otherToken = await tokenFor(otherCustomer.id);

    const addResponse = await request(app)
      .post(`/api/v1/carts/${vendor.id}/items`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ menuItemId: item.id, quantity: 2 });

    expect(addResponse.status).toBe(201);
    const cartItemId = addResponse.body.data.cart.items[0].id as string;

    const invalidQuantityResponse = await request(app)
      .patch(`/api/v1/carts/${vendor.id}/items/${cartItemId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ quantity: 0 });
    expect(invalidQuantityResponse.status).toBe(400);

    const unauthorizedResponse = await request(app)
      .patch(`/api/v1/carts/${vendor.id}/items/${cartItemId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ quantity: 3 });
    expect(unauthorizedResponse.status).toBe(403);

    const cart = await prisma.cart.findUnique({
      where: {
        customerId_vendorId: { customerId: owner.id, vendorId: vendor.id },
      },
    });
    await expect(
      prisma.cartItem.findUnique({ where: { id: cartItemId } }),
    ).resolves.toMatchObject({ cartId: cart!.id, quantity: 2 });
  });

  it("rejects adding an item from another vendor to an existing cart", async () => {
    const customer = await createUser({
      email: "customer@example.com",
      fullName: "Customer",
    });
    const firstVendor = await createVendor({
      slug: "first-vendor",
      deliveryFeeKobo: 10_000,
    });
    const secondVendor = await createVendor({
      slug: "second-vendor",
      deliveryFeeKobo: 20_000,
    });
    const firstItem = await createMenuItem(firstVendor.id, {
      name: "First Dish",
      priceKobo: 100_000,
    });
    const secondItem = await createMenuItem(secondVendor.id, {
      name: "Second Dish",
      priceKobo: 200_000,
    });
    const token = await tokenFor(customer.id);

    const firstResponse = await request(app)
      .post(`/api/v1/carts/${firstVendor.id}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ menuItemId: firstItem.id, quantity: 1 });
    expect(firstResponse.status).toBe(201);

    const mixedVendorResponse = await request(app)
      .post(`/api/v1/carts/${firstVendor.id}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ menuItemId: secondItem.id, quantity: 1 });
    expect(mixedVendorResponse.status).toBe(400);
    expect(mixedVendorResponse.body.error.code).toBe(
      "CART_ITEM_VENDOR_MISMATCH",
    );
  });

  it("revalidates prices and availability before checkout", async () => {
    const customer = await createUser({
      email: "customer@example.com",
      fullName: "Customer",
    });
    const vendor = await createVendor({
      slug: "revalidation-vendor",
      deliveryFeeKobo: 30_000,
    });
    const item = await createMenuItem(vendor.id, {
      name: "Price Changes",
      priceKobo: 100_000,
    });
    const token = await tokenFor(customer.id);

    await request(app)
      .post(`/api/v1/carts/${vendor.id}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ menuItemId: item.id, quantity: 1 });
    await prisma.menuItem.update({
      where: { id: item.id },
      data: { priceKobo: 120_000 },
    });

    const priceResponse = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "price-change-checkout")
      .send({ vendorId: vendor.id, deliveryAddress: "12 Allen Avenue" });

    expect(priceResponse.status).toBe(409);
    expect(priceResponse.body.error.code).toBe("CART_PRICE_CHANGED");
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(
      prisma.cart.count({
        where: { customerId: customer.id, vendorId: vendor.id },
      }),
    ).resolves.toBe(1);

    await prisma.menuItem.update({
      where: { id: item.id },
      data: { priceKobo: 100_000, isAvailable: false },
    });
    const unavailableResponse = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "unavailable-checkout")
      .send({ vendorId: vendor.id, deliveryAddress: "12 Allen Avenue" });
    expect(unavailableResponse.status).toBe(409);
    expect(unavailableResponse.body.error.code).toBe("CART_ITEM_UNAVAILABLE");
    await expect(prisma.order.count()).resolves.toBe(0);
  });

  it("creates an order with snapshots, NGN totals, outbox, audit, and idempotency", async () => {
    const customer = await createUser({
      email: "customer@example.com",
      fullName: "Customer",
    });
    const vendor = await createVendor({
      slug: "checkout-vendor",
      deliveryFeeKobo: 50_000,
    });
    const item = await createMenuItem(vendor.id, {
      name: "Snapshot Dish",
      priceKobo: 120_000,
    });
    const token = await tokenFor(customer.id);

    await request(app)
      .post(`/api/v1/carts/${vendor.id}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ menuItemId: item.id, quantity: 2 });

    const checkoutResponse = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "checkout-001")
      .send({
        vendorId: vendor.id,
        deliveryAddress: "12 Allen Avenue",
        deliveryNote: "Call on arrival",
      });

    expect(checkoutResponse.status).toBe(201);
    expect(checkoutResponse.body.data.order).toMatchObject({
      customerId: customer.id,
      vendorId: vendor.id,
      status: "PENDING_VENDOR_CONFIRMATION",
      currency: "NGN",
      subtotalKobo: 240_000,
      deliveryFeeKobo: 50_000,
      totalKobo: 290_000,
      deliveryAddress: "12 Allen Avenue",
      deliveryNote: "Call on arrival",
    });
    const orderId = checkoutResponse.body.data.order.id as string;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, statusHistory: true },
    });
    expect(order?.items).toEqual([
      expect.objectContaining({
        menuItemId: item.id,
        nameSnapshot: "Snapshot Dish",
        unitPriceKobo: 120_000,
        quantity: 2,
        lineTotalKobo: 240_000,
      }),
    ]);
    expect(order?.statusHistory).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: "PENDING_VENDOR_CONFIRMATION",
        actorUserId: customer.id,
      }),
    ]);
    await expect(
      prisma.notificationOutbox.findUnique({
        where: { dedupeKey: `order-created:${orderId}` },
      }),
    ).resolves.toMatchObject({
      type: "ORDER_CREATED",
      recipientEmail: "checkout-vendor@example.com",
      status: "PENDING",
    });
    await expect(
      prisma.auditLog.findFirst({
        where: { action: "ORDER_CREATED", entityId: orderId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.cart.count({
        where: { customerId: customer.id, vendorId: vendor.id },
      }),
    ).resolves.toBe(0);
  });

  it("replays a completed checkout for the same idempotency key", async () => {
    const customer = await createUser({
      email: "customer@example.com",
      fullName: "Customer",
    });
    const vendor = await createVendor({
      slug: "idempotent-vendor",
      deliveryFeeKobo: 10_000,
    });
    const item = await createMenuItem(vendor.id, {
      name: "Idempotent Dish",
      priceKobo: 80_000,
    });
    const token = await tokenFor(customer.id);

    await request(app)
      .post(`/api/v1/carts/${vendor.id}/items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ menuItemId: item.id, quantity: 1 });

    const firstResponse = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same-key")
      .send({ vendorId: vendor.id, deliveryAddress: "1 Demo Street" });
    const secondResponse = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same-key")
      .send({ vendorId: vendor.id, deliveryAddress: "1 Demo Street" });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.data.replayed).toBe(true);
    expect(secondResponse.body.data.order.id).toBe(
      firstResponse.body.data.order.id,
    );
    await expect(prisma.order.count()).resolves.toBe(1);
    await expect(prisma.checkoutIdempotency.count()).resolves.toBe(1);
  });
});
