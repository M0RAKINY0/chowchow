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
    'TRUNCATE TABLE "NotificationOutbox", "OrderStatusHistory", "OrderItem", "CheckoutIdempotency", "Order", "CartItem", "Cart", "MenuItem", "MenuCategory", "VendorMembership", "Vendor", "AuditLog", "RefreshToken", "User" RESTART IDENTITY CASCADE',
  );
}

async function createUser(input: {
  email: string;
  fullName: string;
  role?: "CUSTOMER" | "VENDOR" | "ADMIN";
}) {
  return prisma.user.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      role: input.role ?? "CUSTOMER",
      passwordHash: await hashPassword("not-used-in-this-test"),
    },
  });
}

async function createOrderFixture(
  input: {
    status?: "PENDING_VENDOR_CONFIRMATION" | "CONFIRMED" | "PREPARING";
  } = {},
) {
  const customer = await createUser({
    email: `customer-${Date.now()}@example.com`,
    fullName: "Customer",
  });
  const vendorUser = await createUser({
    email: `vendor-${Date.now()}@example.com`,
    fullName: "Vendor",
    role: "VENDOR",
  });
  const vendor = await prisma.vendor.create({
    data: {
      name: "Lifecycle Vendor",
      slug: `lifecycle-vendor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      notificationEmail: "vendor-alert@example.com",
      deliveryFeeKobo: 25_000,
      memberships: { create: { userId: vendorUser.id, role: "OWNER" } },
    },
  });
  const menuItem = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: "Lifecycle Dish", priceKobo: 100_000 },
  });
  const status = input.status ?? "PENDING_VENDOR_CONFIRMATION";
  const order = await prisma.order.create({
    data: {
      orderNumber: `CHW-LIFECYCLE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      customerId: customer.id,
      vendorId: vendor.id,
      status,
      subtotalKobo: 100_000,
      deliveryFeeKobo: 25_000,
      totalKobo: 125_000,
      deliveryAddress: "1 Demo Street",
      items: {
        create: {
          menuItemId: menuItem.id,
          nameSnapshot: menuItem.name,
          unitPriceKobo: menuItem.priceKobo,
          quantity: 1,
          lineTotalKobo: menuItem.priceKobo,
        },
      },
      statusHistory: {
        create: {
          toStatus: status,
          actorUserId: customer.id,
        },
      },
    },
  });
  return { customer, vendorUser, vendor, order };
}

async function tokenFor(user: {
  id: string;
  role: "CUSTOMER" | "VENDOR" | "ADMIN";
}) {
  return createAccessToken(
    { userId: user.id, role: user.role },
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

describe("order lifecycle API", () => {
  it("scopes order queries and details to the authenticated actor", async () => {
    const first = await createOrderFixture();
    const second = await createOrderFixture();
    const customerToken = await tokenFor({
      id: first.customer.id,
      role: first.customer.role,
    });
    const vendorToken = await tokenFor({
      id: first.vendorUser.id,
      role: first.vendorUser.role,
    });

    const customerOrdersResponse = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(customerOrdersResponse.status).toBe(200);
    expect(customerOrdersResponse.body.data.items).toHaveLength(1);
    expect(customerOrdersResponse.body.data.items[0].id).toBe(first.order.id);

    const otherOrderResponse = await request(app)
      .get(`/api/v1/orders/${second.order.id}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(otherOrderResponse.status).toBe(403);

    const vendorOrdersResponse = await request(app)
      .get(`/api/v1/vendors/${first.vendor.id}/orders`)
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(vendorOrdersResponse.status).toBe(200);
    expect(vendorOrdersResponse.body.data.items).toHaveLength(1);
    expect(vendorOrdersResponse.body.data.items[0].id).toBe(first.order.id);
  });

  it("allows the vendor to progress every valid operational transition", async () => {
    const fixture = await createOrderFixture();
    const vendorToken = await tokenFor({
      id: fixture.vendorUser.id,
      role: fixture.vendorUser.role,
    });
    const transitions = [
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_DISPATCH",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ] as const;

    for (const status of transitions) {
      const response = await request(app)
        .patch(`/api/v1/orders/${fixture.order.id}/status`)
        .set("Authorization", `Bearer ${vendorToken}`)
        .send({ status, note: `Moved to ${status}` });
      expect(response.status).toBe(200);
      expect(response.body.data.order.status).toBe(status);
    }

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: fixture.order.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((entry) => entry.toStatus)).toEqual([
      "PENDING_VENDOR_CONFIRMATION",
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_DISPATCH",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    await expect(
      prisma.auditLog.count({
        where: { action: "ORDER_STATUS_CHANGED", entityId: fixture.order.id },
      }),
    ).resolves.toBe(5);
    await expect(
      prisma.notificationOutbox.count({
        where: { aggregateId: fixture.order.id, type: "ORDER_STATUS_CHANGED" },
      }),
    ).resolves.toBe(5);
  });

  it("rejects invalid transitions and customer attempts to operate the order", async () => {
    const fixture = await createOrderFixture();
    const customerToken = await tokenFor({
      id: fixture.customer.id,
      role: fixture.customer.role,
    });
    const vendorToken = await tokenFor({
      id: fixture.vendorUser.id,
      role: fixture.vendorUser.role,
    });

    const customerProgressResponse = await request(app)
      .patch(`/api/v1/orders/${fixture.order.id}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "CONFIRMED" });
    expect(customerProgressResponse.status).toBe(403);

    const invalidTransitionResponse = await request(app)
      .patch(`/api/v1/orders/${fixture.order.id}/status`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ status: "DELIVERED" });
    expect(invalidTransitionResponse.status).toBe(409);
    expect(invalidTransitionResponse.body.error.code).toBe(
      "ORDER_INVALID_TRANSITION",
    );
    await expect(
      prisma.order.findUnique({ where: { id: fixture.order.id } }),
    ).resolves.toMatchObject({ status: "PENDING_VENDOR_CONFIRMATION" });
  });

  it("allows customer cancellation before preparation and rejects it afterward", async () => {
    const cancellable = await createOrderFixture();
    const customerToken = await tokenFor({
      id: cancellable.customer.id,
      role: cancellable.customer.role,
    });

    const cancelResponse = await request(app)
      .post(`/api/v1/orders/${cancellable.order.id}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ note: "Changed my mind" });
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.data.order.status).toBe("CANCELLED");
    await expect(
      prisma.notificationOutbox.findUnique({
        where: { dedupeKey: `order-status:${cancellable.order.id}:CANCELLED` },
      }),
    ).resolves.toMatchObject({
      recipientEmail: "vendor-alert@example.com",
      type: "ORDER_STATUS_CHANGED",
    });

    const preparing = await createOrderFixture({ status: "PREPARING" });
    const preparingCustomerToken = await tokenFor({
      id: preparing.customer.id,
      role: preparing.customer.role,
    });
    const lateCancelResponse = await request(app)
      .post(`/api/v1/orders/${preparing.order.id}/cancel`)
      .set("Authorization", `Bearer ${preparingCustomerToken}`)
      .send({ note: "Too late" });
    expect(lateCancelResponse.status).toBe(409);
    expect(lateCancelResponse.body.error.code).toBe(
      "ORDER_CANCELLATION_NOT_ALLOWED",
    );
  });

  it("allows an admin to inspect and operate across vendors", async () => {
    const fixture = await createOrderFixture();
    const admin = await createUser({
      email: "admin@example.com",
      fullName: "Admin",
      role: "ADMIN",
    });
    const adminToken = await tokenFor({ id: admin.id, role: admin.role });

    const allOrdersResponse = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(allOrdersResponse.status).toBe(200);
    expect(allOrdersResponse.body.data.items[0].id).toBe(fixture.order.id);

    const statusResponse = await request(app)
      .patch(`/api/v1/orders/${fixture.order.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED", note: "Admin cancellation" });
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data.order.status).toBe("CANCELLED");
  });
});
