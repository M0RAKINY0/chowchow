import { PrismaClient, Prisma } from "@prisma/client";
import { seedData } from "../src/seed-data.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = new Map<string, { id: string }>();
  for (const user of seedData.users) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: { fullName: user.fullName, role: user.role as Prisma.UserRole, isActive: true },
      create: {
        email: user.email,
        fullName: user.fullName,
        role: user.role as Prisma.UserRole,
        passwordHash: user.passwordHash,
      },
      select: { id: true },
    });
    users.set(user.email, record);
  }

  const vendors = new Map<string, { id: string }>();
  for (const vendor of seedData.vendors) {
    const record = await prisma.vendor.upsert({
      where: { slug: vendor.slug },
      update: {
        name: vendor.name,
        notificationEmail: vendor.notificationEmail,
        deliveryFeeKobo: vendor.deliveryFeeKobo,
        isActive: true,
      },
      create: vendor,
      select: { id: true },
    });
    vendors.set(vendor.slug, record);
  }

  for (const membership of seedData.memberships) {
    const user = users.get(membership.userEmail);
    const vendor = vendors.get(membership.vendorSlug);
    if (!user || !vendor) {
      throw new Error(`Missing seed relationship for ${membership.userEmail}/${membership.vendorSlug}`);
    }

    await prisma.vendorMembership.upsert({
      where: { userId_vendorId: { userId: user.id, vendorId: vendor.id } },
      update: { role: membership.role as Prisma.VendorMembershipRole },
      create: { userId: user.id, vendorId: vendor.id, role: membership.role as Prisma.VendorMembershipRole },
    });
  }

  const categories = new Map<string, { id: string }>();
  for (const category of seedData.categories) {
    const vendor = vendors.get(category.vendorSlug);
    if (!vendor) {
      throw new Error(`Missing vendor for category ${category.name}`);
    }

    const record = await prisma.menuCategory.upsert({
      where: { vendorId_name: { vendorId: vendor.id, name: category.name } },
      update: { sortOrder: category.sortOrder, isActive: true },
      create: {
        vendorId: vendor.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: true,
      },
      select: { id: true },
    });
    categories.set(`${category.vendorSlug}:${category.name}`, record);
  }

  for (const item of seedData.menuItems) {
    const vendor = vendors.get(item.vendorSlug);
    const category = categories.get(`${item.vendorSlug}:${item.categoryName}`);
    if (!vendor || !category) {
      throw new Error(`Missing menu relationship for ${item.name}`);
    }

    await prisma.menuItem.upsert({
      where: { vendorId_name: { vendorId: vendor.id, name: item.name } },
      update: {
        categoryId: category.id,
        description: item.description,
        priceKobo: item.priceKobo,
        isAvailable: true,
      },
      create: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: item.name,
        description: item.description,
        priceKobo: item.priceKobo,
        isAvailable: true,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
