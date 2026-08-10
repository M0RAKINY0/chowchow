import {
  Prisma,
  type MenuCategory,
  type MenuItem,
  type PrismaClient,
  type Vendor,
} from "@prisma/client";
import { AppError } from "../../errors.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import {
  invalidatePopularFoodCache,
  type PopularFoodCache,
} from "../popular/popular-food.cache.js";
import type {
  CreateCategoryInput,
  CreateMenuItemInput,
  CreateVendorInput,
  UpdateCategoryInput,
  UpdateMenuItemInput,
  UpdateVendorInput,
  VendorListQuery,
} from "./vendor.schemas.js";

type RequestMetadata = {
  ipAddress: string | undefined;
  userAgent: string | undefined;
};

type PublicVendor = Pick<
  Vendor,
  | "id"
  | "name"
  | "slug"
  | "deliveryFeeKobo"
  | "isActive"
  | "createdAt"
  | "updatedAt"
>;

type PublicMenuItem = Pick<
  MenuItem,
  | "id"
  | "name"
  | "description"
  | "priceKobo"
  | "imageUrl"
  | "isAvailable"
  | "categoryId"
  | "createdAt"
  | "updatedAt"
>;

type PublicMenuCategory = Pick<
  MenuCategory,
  "id" | "name" | "sortOrder" | "isActive"
> & {
  items: PublicMenuItem[];
};

function toPublicVendor(vendor: PublicVendor): PublicVendor {
  return vendor;
}

function toPublicMenuItem(item: PublicMenuItem): PublicMenuItem {
  return item;
}

function notFound(entity: string): AppError {
  return new AppError(
    404,
    `${entity.toUpperCase()}_NOT_FOUND`,
    `${entity} was not found`,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function rethrowConflict(error: unknown, code: string, message: string): never {
  if (isUniqueConstraintError(error)) {
    throw new AppError(409, code, message);
  }
  throw error;
}

export function createVendorService(input: {
  prisma: PrismaClient;
  popularFoodCache?: PopularFoodCache;
}) {
  async function listPublicVendors(query: VendorListQuery) {
    const where: Prisma.VendorWhereInput = {
      isActive: true,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const select = {
      id: true,
      name: true,
      slug: true,
      deliveryFeeKobo: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    const [items, total] = await input.prisma.$transaction([
      input.prisma.vendor.findMany({
        where,
        select,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: query.offset,
        take: query.limit,
      }),
      input.prisma.vendor.count({ where }),
    ]);

    return {
      items: items.map(toPublicVendor),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore: query.offset + items.length < total,
      },
    };
  }

  async function getPublicVendor(vendorId: string): Promise<PublicVendor> {
    const vendor = await input.prisma.vendor.findFirst({
      where: { id: vendorId, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        deliveryFeeKobo: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!vendor) {
      throw notFound("Vendor");
    }
    return toPublicVendor(vendor);
  }

  async function getPublicMenu(vendorId: string) {
    const vendor = await getPublicVendor(vendorId);
    const categories = await input.prisma.menuCategory.findMany({
      where: { vendorId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        menuItems: {
          where: { isAvailable: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            description: true,
            priceKobo: true,
            imageUrl: true,
            isAvailable: true,
            categoryId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return {
      vendor,
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        items: category.menuItems.map(toPublicMenuItem),
      })),
    };
  }

  async function getVendorForManagement(vendorId: string): Promise<Vendor> {
    const vendor = await input.prisma.vendor.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) {
      throw notFound("Vendor");
    }
    return vendor;
  }

  async function createVendor(
    actorUserId: string,
    vendorInput: CreateVendorInput,
    metadata: RequestMetadata,
  ): Promise<Vendor> {
    try {
      return await input.prisma.$transaction(async (transaction) => {
        const vendor = await transaction.vendor.create({ data: vendorInput });
        await writeAuditEvent(transaction, {
          actorUserId,
          action: "VENDOR_CREATED",
          entityType: "Vendor",
          entityId: vendor.id,
          metadata: { slug: vendor.slug, name: vendor.name },
          ...metadata,
        });
        return vendor;
      });
    } catch (error) {
      rethrowConflict(
        error,
        "VENDOR_SLUG_TAKEN",
        "A vendor with this slug already exists",
      );
    }
  }

  async function updateVendor(
    actorUserId: string,
    vendorId: string,
    vendorInput: UpdateVendorInput,
    metadata: RequestMetadata,
  ): Promise<Vendor> {
    await getVendorForManagement(vendorId);
    const data: Prisma.VendorUpdateInput = {};
    if (vendorInput.name !== undefined) data.name = vendorInput.name;
    if (vendorInput.notificationEmail !== undefined)
      data.notificationEmail = vendorInput.notificationEmail;
    if (vendorInput.deliveryFeeKobo !== undefined)
      data.deliveryFeeKobo = vendorInput.deliveryFeeKobo;
    if (vendorInput.isActive !== undefined)
      data.isActive = vendorInput.isActive;
    const vendor = await input.prisma.vendor.update({
      where: { id: vendorId },
      data,
    });
    await writeAuditEvent(input.prisma, {
      actorUserId,
      action: "VENDOR_UPDATED",
      entityType: "Vendor",
      entityId: vendor.id,
      metadata: { fields: Object.keys(vendorInput) },
      ...metadata,
    });
    await invalidatePopularFoodCache(input.popularFoodCache, vendor.id);
    return vendor;
  }

  async function createCategory(
    actorUserId: string,
    vendorId: string,
    categoryInput: CreateCategoryInput,
    metadata: RequestMetadata,
  ): Promise<MenuCategory> {
    await getVendorForManagement(vendorId);
    try {
      return await input.prisma.$transaction(async (transaction) => {
        const category = await transaction.menuCategory.create({
          data: { ...categoryInput, vendorId },
        });
        await writeAuditEvent(transaction, {
          actorUserId,
          action: "MENU_CATEGORY_CREATED",
          entityType: "MenuCategory",
          entityId: category.id,
          metadata: { vendorId, name: category.name },
          ...metadata,
        });
        return category;
      });
    } catch (error) {
      rethrowConflict(
        error,
        "MENU_CATEGORY_NAME_TAKEN",
        "A category with this name already exists for this vendor",
      );
    }
  }

  async function updateCategory(
    actorUserId: string,
    vendorId: string,
    categoryId: string,
    categoryInput: UpdateCategoryInput,
    metadata: RequestMetadata,
  ): Promise<MenuCategory> {
    const category = await input.prisma.menuCategory.findFirst({
      where: { id: categoryId, vendorId },
    });
    if (!category) {
      throw notFound("Menu category");
    }
    try {
      const data: Prisma.MenuCategoryUpdateInput = {};
      if (categoryInput.name !== undefined) data.name = categoryInput.name;
      if (categoryInput.sortOrder !== undefined)
        data.sortOrder = categoryInput.sortOrder;
      if (categoryInput.isActive !== undefined)
        data.isActive = categoryInput.isActive;
      const updatedCategory = await input.prisma.menuCategory.update({
        where: { id: category.id },
        data,
      });
      await writeAuditEvent(input.prisma, {
        actorUserId,
        action: "MENU_CATEGORY_UPDATED",
        entityType: "MenuCategory",
        entityId: updatedCategory.id,
        metadata: { vendorId, fields: Object.keys(categoryInput) },
        ...metadata,
      });
      return updatedCategory;
    } catch (error) {
      rethrowConflict(
        error,
        "MENU_CATEGORY_NAME_TAKEN",
        "A category with this name already exists for this vendor",
      );
    }
  }

  async function validateCategory(
    vendorId: string,
    categoryId: string | null | undefined,
  ): Promise<void> {
    if (categoryId === undefined || categoryId === null) {
      return;
    }
    const category = await input.prisma.menuCategory.findFirst({
      where: { id: categoryId, vendorId },
    });
    if (!category) {
      throw new AppError(
        400,
        "MENU_CATEGORY_INVALID",
        "The category does not belong to this vendor",
      );
    }
  }

  async function createMenuItem(
    actorUserId: string,
    vendorId: string,
    menuItemInput: CreateMenuItemInput,
    metadata: RequestMetadata,
  ): Promise<MenuItem> {
    await getVendorForManagement(vendorId);
    await validateCategory(vendorId, menuItemInput.categoryId);
    try {
      const menuItem = await input.prisma.$transaction(async (transaction) => {
        const data: Prisma.MenuItemUncheckedCreateInput = {
          vendorId,
          name: menuItemInput.name,
          priceKobo: menuItemInput.priceKobo,
          isAvailable: menuItemInput.isAvailable,
          categoryId: menuItemInput.categoryId ?? null,
          ...(menuItemInput.description !== undefined
            ? { description: menuItemInput.description }
            : {}),
          ...(menuItemInput.imageUrl !== undefined
            ? { imageUrl: menuItemInput.imageUrl }
            : {}),
        };
        const menuItem = await transaction.menuItem.create({ data });
        await writeAuditEvent(transaction, {
          actorUserId,
          action: "MENU_ITEM_CREATED",
          entityType: "MenuItem",
          entityId: menuItem.id,
          metadata: { vendorId, name: menuItem.name },
          ...metadata,
        });
        return menuItem;
      });
      await invalidatePopularFoodCache(input.popularFoodCache, vendorId);
      return menuItem;
    } catch (error) {
      rethrowConflict(
        error,
        "MENU_ITEM_NAME_TAKEN",
        "A menu item with this name already exists for this vendor",
      );
    }
  }

  async function updateMenuItem(
    actorUserId: string,
    vendorId: string,
    menuItemId: string,
    menuItemInput: UpdateMenuItemInput,
    metadata: RequestMetadata,
  ): Promise<MenuItem> {
    const menuItem = await input.prisma.menuItem.findFirst({
      where: { id: menuItemId, vendorId },
    });
    if (!menuItem) {
      throw notFound("Menu item");
    }
    await validateCategory(vendorId, menuItemInput.categoryId);
    try {
      const data: Prisma.MenuItemUncheckedUpdateInput = {};
      if (menuItemInput.name !== undefined) data.name = menuItemInput.name;
      if (menuItemInput.description !== undefined)
        data.description = menuItemInput.description;
      if (menuItemInput.priceKobo !== undefined)
        data.priceKobo = menuItemInput.priceKobo;
      if (menuItemInput.categoryId !== undefined)
        data.categoryId = menuItemInput.categoryId;
      if (menuItemInput.imageUrl !== undefined)
        data.imageUrl = menuItemInput.imageUrl;
      if (menuItemInput.isAvailable !== undefined)
        data.isAvailable = menuItemInput.isAvailable;
      const updatedMenuItem = await input.prisma.menuItem.update({
        where: { id: menuItem.id },
        data,
      });
      await writeAuditEvent(input.prisma, {
        actorUserId,
        action: "MENU_ITEM_UPDATED",
        entityType: "MenuItem",
        entityId: updatedMenuItem.id,
        metadata: { vendorId, fields: Object.keys(menuItemInput) },
        ...metadata,
      });
      await invalidatePopularFoodCache(input.popularFoodCache, vendorId);
      return updatedMenuItem;
    } catch (error) {
      rethrowConflict(
        error,
        "MENU_ITEM_NAME_TAKEN",
        "A menu item with this name already exists for this vendor",
      );
    }
  }

  return {
    listPublicVendors,
    getPublicVendor,
    getPublicMenu,
    createVendor,
    updateVendor,
    createCategory,
    updateCategory,
    createMenuItem,
    updateMenuItem,
    getVendorForManagement,
  };
}

export type VendorService = ReturnType<typeof createVendorService>;
