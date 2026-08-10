import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { hashPassword } from "../auth/password.js";
import { createAccessToken } from "../auth/tokens.js";

const app = createApp(loadConfig());

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "RefreshToken", "VendorMembership", "MenuItem", "MenuCategory", "Vendor", "User" RESTART IDENTITY CASCADE',
  );
}

async function createUser(input: {
  email: string;
  role: "CUSTOMER" | "VENDOR" | "ADMIN";
  fullName: string;
}) {
  return prisma.user.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      passwordHash: await hashPassword("not-used-in-this-test"),
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(resetDatabase);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("vendor and menu API", () => {
  it("lists active vendors and only available items in a public menu", async () => {
    const vendor = await prisma.vendor.create({
      data: {
        name: "Lagos Bites",
        slug: "lagos-bites",
        notificationEmail: "vendor@example.com",
        deliveryFeeKobo: 100_000,
      },
    });
    const category = await prisma.menuCategory.create({
      data: { vendorId: vendor.id, name: "Rice Bowls" },
    });
    await prisma.menuItem.createMany({
      data: [
        {
          vendorId: vendor.id,
          categoryId: category.id,
          name: "Jollof Rice",
          priceKobo: 350_000,
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          categoryId: category.id,
          name: "Sold Out Rice",
          priceKobo: 400_000,
          isAvailable: false,
        },
      ],
    });

    const vendorsResponse = await request(app).get("/api/v1/vendors");
    expect(vendorsResponse.status).toBe(200);
    expect(vendorsResponse.body.data.items).toHaveLength(1);

    const menuResponse = await request(app).get(
      `/api/v1/vendors/${vendor.id}/menu`,
    );
    expect(menuResponse.status).toBe(200);
    expect(menuResponse.body.data.categories[0].items).toEqual([
      expect.objectContaining({ name: "Jollof Rice", priceKobo: 350_000 }),
    ]);
  });

  it("allows an admin to create a vendor and records the mutation", async () => {
    const admin = await createUser({
      email: "admin@example.com",
      role: "ADMIN",
      fullName: "Admin",
    });
    const token = await createAccessToken(
      { userId: admin.id, role: admin.role },
      process.env.JWT_ACCESS_SECRET!,
    );

    const response = await request(app)
      .post("/api/v1/vendors")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Island Kitchen",
        slug: "island-kitchen",
        notificationEmail: "island@example.com",
        deliveryFeeKobo: 150_000,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.vendor).toMatchObject({
      name: "Island Kitchen",
      slug: "island-kitchen",
    });
    await expect(
      prisma.auditLog.findFirst({ where: { action: "VENDOR_CREATED" } }),
    ).resolves.not.toBeNull();
  });

  it("prevents a vendor member from mutating another vendor's menu", async () => {
    const vendorUser = await createUser({
      email: "vendor@example.com",
      role: "VENDOR",
      fullName: "Vendor",
    });
    const ownedVendor = await prisma.vendor.create({
      data: {
        name: "Owned Vendor",
        slug: "owned-vendor",
        notificationEmail: "owned@example.com",
        deliveryFeeKobo: 100_000,
      },
    });
    const otherVendor = await prisma.vendor.create({
      data: {
        name: "Other Vendor",
        slug: "other-vendor",
        notificationEmail: "other@example.com",
        deliveryFeeKobo: 100_000,
      },
    });
    await prisma.vendorMembership.create({
      data: { userId: vendorUser.id, vendorId: ownedVendor.id, role: "OWNER" },
    });
    const token = await createAccessToken(
      { userId: vendorUser.id, role: vendorUser.role },
      process.env.JWT_ACCESS_SECRET!,
    );

    const response = await request(app)
      .post(`/api/v1/vendors/${otherVendor.id}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Unauthorized Dish", priceKobo: 200_000 });

    expect(response.status).toBe(403);
    await expect(
      prisma.menuItem.findFirst({ where: { name: "Unauthorized Dish" } }),
    ).resolves.toBeNull();
  });

  it("validates menu prices and records vendor menu mutations", async () => {
    const vendorUser = await createUser({
      email: "vendor@example.com",
      role: "VENDOR",
      fullName: "Vendor",
    });
    const vendor = await prisma.vendor.create({
      data: {
        name: "Owned Vendor",
        slug: "owned-vendor",
        notificationEmail: "owned@example.com",
        deliveryFeeKobo: 100_000,
        memberships: { create: { userId: vendorUser.id, role: "OWNER" } },
        categories: { create: { name: "Mains" } },
      },
      include: { categories: true },
    });
    const token = await createAccessToken(
      { userId: vendorUser.id, role: vendorUser.role },
      process.env.JWT_ACCESS_SECRET!,
    );
    const categoryId = vendor.categories[0]!.id;

    const invalidResponse = await request(app)
      .post(`/api/v1/vendors/${vendor.id}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Invalid Dish", priceKobo: 0, categoryId });
    expect(invalidResponse.status).toBe(400);

    const createResponse = await request(app)
      .post(`/api/v1/vendors/${vendor.id}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Valid Dish", priceKobo: 250_000, categoryId });
    expect(createResponse.status).toBe(201);
    await expect(
      prisma.auditLog.findFirst({ where: { action: "MENU_ITEM_CREATED" } }),
    ).resolves.not.toBeNull();
  });

  it("lets a vendor toggle availability and removes the item from the public menu", async () => {
    const vendorUser = await createUser({
      email: "vendor@example.com",
      role: "VENDOR",
      fullName: "Vendor",
    });
    const vendor = await prisma.vendor.create({
      data: {
        name: "Owned Vendor",
        slug: "owned-vendor",
        notificationEmail: "owned@example.com",
        deliveryFeeKobo: 100_000,
        memberships: { create: { userId: vendorUser.id, role: "OWNER" } },
      },
    });
    const menuItem = await prisma.menuItem.create({
      data: {
        vendorId: vendor.id,
        name: "Temporarily Unavailable",
        priceKobo: 300_000,
      },
    });
    const token = await createAccessToken(
      { userId: vendorUser.id, role: vendorUser.role },
      process.env.JWT_ACCESS_SECRET!,
    );

    const response = await request(app)
      .patch(`/api/v1/vendors/${vendor.id}/menu-items/${menuItem.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isAvailable: false });

    expect(response.status).toBe(200);
    const menuResponse = await request(app).get(
      `/api/v1/vendors/${vendor.id}/menu`,
    );
    expect(menuResponse.status).toBe(200);
    expect(menuResponse.body.data.categories).toEqual([]);
    await expect(
      prisma.auditLog.findFirst({ where: { action: "MENU_ITEM_UPDATED" } }),
    ).resolves.not.toBeNull();
  });
});
