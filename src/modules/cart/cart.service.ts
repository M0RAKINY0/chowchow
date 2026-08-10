import { randomUUID } from "node:crypto";
import {
  Prisma,
  type Cart,
  type CartItem,
  type PrismaClient,
} from "@prisma/client";
import { calculateOrderTotals } from "../../domain/money.js";
import { AppError } from "../../errors.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import {
  invalidatePopularFoodCache,
  type PopularFoodCache,
} from "../popular/popular-food.cache.js";
import type {
  AddCartItemInput,
  CheckoutInput,
  UpdateCartItemInput,
} from "./cart.schemas.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

type RequestMetadata = {
  ipAddress: string | undefined;
  userAgent: string | undefined;
};

const cartInclude = {
  vendor: {
    select: {
      id: true,
      name: true,
      notificationEmail: true,
      deliveryFeeKobo: true,
      isActive: true,
    },
  },
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      menuItem: {
        select: {
          id: true,
          vendorId: true,
          name: true,
          description: true,
          priceKobo: true,
          imageUrl: true,
          isAvailable: true,
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

const orderInclude = {
  items: {
    orderBy: { id: "asc" },
  },
  statusHistory: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderInclude;

type CartWithDetails = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type OrderWithDetails = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function serializeCart(cart: CartWithDetails | null) {
  if (!cart) {
    return null;
  }

  return {
    id: cart.id,
    customerId: cart.customerId,
    vendorId: cart.vendorId,
    vendor: cart.vendor,
    items: cart.items.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.menuItem.name,
      description: item.menuItem.description,
      imageUrl: item.menuItem.imageUrl,
      unitPriceKobo: item.unitPriceKobo,
      currentPriceKobo: item.menuItem.priceKobo,
      priceChanged: item.unitPriceKobo !== item.menuItem.priceKobo,
      isAvailable: item.menuItem.isAvailable,
      quantity: item.quantity,
      lineTotalKobo: item.unitPriceKobo * item.quantity,
    })),
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

function serializeOrder(order: OrderWithDetails) {
  return {
    ...order,
    items: order.items,
    statusHistory: order.statusHistory,
  };
}

export function createCartService(input: {
  prisma: PrismaClient;
  now?: () => Date;
  popularFoodCache?: PopularFoodCache;
}) {
  const now = input.now ?? (() => new Date());

  async function getActiveVendor(vendorId: string) {
    const vendor = await input.prisma.vendor.findFirst({
      where: { id: vendorId, isActive: true },
    });
    if (!vendor) {
      throw notFound(
        "VENDOR_NOT_FOUND",
        "Vendor was not found or is not accepting orders",
      );
    }
    return vendor;
  }

  async function getCartRecord(
    customerId: string,
    vendorId: string,
  ): Promise<CartWithDetails | null> {
    return input.prisma.cart.findUnique({
      where: { customerId_vendorId: { customerId, vendorId } },
      include: cartInclude,
    });
  }

  async function getCart(customerId: string, vendorId: string) {
    await getActiveVendor(vendorId);
    return { cart: serializeCart(await getCartRecord(customerId, vendorId)) };
  }

  async function addItem(
    customerId: string,
    vendorId: string,
    cartItemInput: AddCartItemInput,
  ) {
    await getActiveVendor(vendorId);
    await input.prisma.$transaction(async (transaction) => {
      const menuItem = await transaction.menuItem.findUnique({
        where: { id: cartItemInput.menuItemId },
      });
      if (!menuItem) {
        throw notFound("MENU_ITEM_NOT_FOUND", "Menu item was not found");
      }
      if (menuItem.vendorId !== vendorId) {
        throw new AppError(
          400,
          "CART_ITEM_VENDOR_MISMATCH",
          "The menu item belongs to another vendor",
        );
      }
      if (!menuItem.isAvailable) {
        throw conflict(
          "CART_ITEM_UNAVAILABLE",
          "This menu item is currently unavailable",
        );
      }

      const cart = await transaction.cart.upsert({
        where: { customerId_vendorId: { customerId, vendorId } },
        create: { customerId, vendorId },
        update: {},
      });
      const existingItem = await transaction.cartItem.findUnique({
        where: {
          cartId_menuItemId: { cartId: cart.id, menuItemId: menuItem.id },
        },
      });
      const quantity = (existingItem?.quantity ?? 0) + cartItemInput.quantity;
      if (quantity > 99) {
        throw new AppError(
          400,
          "CART_QUANTITY_LIMIT",
          "A cart item quantity cannot exceed 99",
        );
      }

      if (existingItem) {
        await transaction.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity, unitPriceKobo: menuItem.priceKobo },
        });
      } else {
        await transaction.cartItem.create({
          data: {
            cartId: cart.id,
            menuItemId: menuItem.id,
            quantity,
            unitPriceKobo: menuItem.priceKobo,
          },
        });
      }
    });

    return getCart(customerId, vendorId);
  }

  async function findOwnedCartItem(
    customerId: string,
    vendorId: string,
    cartItemId: string,
  ): Promise<CartItem & { cart: Cart }> {
    const item = await input.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });
    if (!item || item.cart.vendorId !== vendorId) {
      throw notFound("CART_ITEM_NOT_FOUND", "Cart item was not found");
    }
    if (item.cart.customerId !== customerId) {
      throw new AppError(
        403,
        "CART_FORBIDDEN",
        "You do not have access to this cart",
      );
    }
    return item;
  }

  async function updateItem(
    customerId: string,
    vendorId: string,
    cartItemId: string,
    cartItemInput: UpdateCartItemInput,
  ) {
    const cartItem = await findOwnedCartItem(customerId, vendorId, cartItemId);
    const menuItem = await input.prisma.menuItem.findUnique({
      where: { id: cartItem.menuItemId },
    });
    if (!menuItem || !menuItem.isAvailable) {
      throw conflict(
        "CART_ITEM_UNAVAILABLE",
        "This menu item is currently unavailable",
      );
    }
    await input.prisma.cartItem.update({
      where: { id: cartItem.id },
      data: {
        quantity: cartItemInput.quantity,
        unitPriceKobo: menuItem.priceKobo,
      },
    });
    return getCart(customerId, vendorId);
  }

  async function removeItem(
    customerId: string,
    vendorId: string,
    cartItemId: string,
  ): Promise<void> {
    const cartItem = await findOwnedCartItem(customerId, vendorId, cartItemId);
    await input.prisma.$transaction(async (transaction) => {
      await transaction.cartItem.delete({ where: { id: cartItem.id } });
      const remainingItems = await transaction.cartItem.count({
        where: { cartId: cartItem.cartId },
      });
      if (remainingItems === 0) {
        await transaction.cart.delete({ where: { id: cartItem.cartId } });
      }
    });
  }

  async function findExistingCheckout(
    customerId: string,
    key: string,
  ): Promise<OrderWithDetails | null> {
    const existing = await input.prisma.checkoutIdempotency.findUnique({
      where: { customerId_key: { customerId, key } },
      include: { order: { include: orderInclude } },
    });
    if (!existing) {
      return null;
    }
    if (existing.expiresAt <= now()) {
      await input.prisma.checkoutIdempotency.delete({
        where: { id: existing.id },
      });
      return null;
    }
    if (!existing.order) {
      throw conflict(
        "CHECKOUT_IN_PROGRESS",
        "A checkout with this idempotency key is still in progress",
      );
    }
    return existing.order;
  }

  async function checkout(
    customerId: string,
    checkoutInput: CheckoutInput,
    idempotencyKey: string,
    metadata: RequestMetadata,
  ): Promise<{ order: ReturnType<typeof serializeOrder>; replayed: boolean }> {
    const existingOrder = await findExistingCheckout(
      customerId,
      idempotencyKey,
    );
    if (existingOrder) {
      return { order: serializeOrder(existingOrder), replayed: true };
    }

    try {
      const order = await input.prisma.$transaction(async (transaction) => {
        const cart = await transaction.cart.findUnique({
          where: {
            customerId_vendorId: {
              customerId,
              vendorId: checkoutInput.vendorId,
            },
          },
          include: cartInclude,
        });
        if (!cart) {
          throw notFound("CART_NOT_FOUND", "Your cart is empty");
        }
        if (!cart.vendor.isActive) {
          throw conflict(
            "VENDOR_NOT_ACCEPTING_ORDERS",
            "This vendor is not accepting orders",
          );
        }
        if (cart.items.length === 0) {
          throw notFound("CART_NOT_FOUND", "Your cart is empty");
        }

        for (const item of cart.items) {
          if (item.menuItem.vendorId !== cart.vendorId) {
            throw new AppError(
              400,
              "CART_ITEM_VENDOR_MISMATCH",
              "The cart contains an item from another vendor",
            );
          }
          if (!item.menuItem.isAvailable) {
            throw conflict(
              "CART_ITEM_UNAVAILABLE",
              `${item.menuItem.name} is currently unavailable`,
            );
          }
          if (item.unitPriceKobo !== item.menuItem.priceKobo) {
            throw conflict(
              "CART_PRICE_CHANGED",
              `${item.menuItem.name} changed price while in your cart`,
              {
                menuItemId: item.menuItem.id,
                previousPriceKobo: item.unitPriceKobo,
                currentPriceKobo: item.menuItem.priceKobo,
              },
            );
          }
        }

        let totals;
        try {
          totals = calculateOrderTotals({
            items: cart.items.map((item) => ({
              unitPriceKobo: item.menuItem.priceKobo,
              quantity: item.quantity,
            })),
            deliveryFeeKobo: cart.vendor.deliveryFeeKobo,
          });
        } catch (error) {
          throw new AppError(
            400,
            "ORDER_TOTAL_INVALID",
            error instanceof Error ? error.message : "Order total is invalid",
          );
        }

        const order = await transaction.order.create({
          data: {
            orderNumber: `CHW-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
            customerId,
            vendorId: cart.vendorId,
            paymentMethod: checkoutInput.paymentMethod,
            subtotalKobo: totals.subtotalKobo,
            deliveryFeeKobo: totals.deliveryFeeKobo,
            totalKobo: totals.totalKobo,
            deliveryAddress: checkoutInput.deliveryAddress,
            deliveryNote: checkoutInput.deliveryNote ?? null,
            items: {
              create: cart.items.map((item) => ({
                menuItemId: item.menuItem.id,
                nameSnapshot: item.menuItem.name,
                unitPriceKobo: item.menuItem.priceKobo,
                quantity: item.quantity,
                lineTotalKobo: item.menuItem.priceKobo * item.quantity,
              })),
            },
            statusHistory: {
              create: {
                toStatus: "PENDING_VENDOR_CONFIRMATION",
                actorUserId: customerId,
              },
            },
          },
        });

        await transaction.checkoutIdempotency.create({
          data: {
            customerId,
            key: idempotencyKey,
            orderId: order.id,
            expiresAt: new Date(now().getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
        await transaction.notificationOutbox.create({
          data: {
            dedupeKey: `order-created:${order.id}`,
            type: "ORDER_CREATED",
            aggregateType: "Order",
            aggregateId: order.id,
            recipientEmail: cart.vendor.notificationEmail,
            payload: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              vendorName: cart.vendor.name,
              deliveryAddress: order.deliveryAddress,
              totalKobo: order.totalKobo,
              items: cart.items.map((item) => ({
                name: item.menuItem.name,
                quantity: item.quantity,
                unitPriceKobo: item.menuItem.priceKobo,
                lineTotalKobo: item.menuItem.priceKobo * item.quantity,
              })),
            },
          },
        });
        await writeAuditEvent(transaction, {
          actorUserId: customerId,
          action: "ORDER_CREATED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            orderNumber: order.orderNumber,
            vendorId: order.vendorId,
            totalKobo: order.totalKobo,
            paymentMethod: order.paymentMethod,
          },
          ...metadata,
        });
        await transaction.cart.delete({ where: { id: cart.id } });

        return transaction.order.findUniqueOrThrow({
          where: { id: order.id },
          include: orderInclude,
        });
      });
      await invalidatePopularFoodCache(input.popularFoodCache, order.vendorId);
      return { order: serializeOrder(order), replayed: false };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrentOrder = await findExistingCheckout(
          customerId,
          idempotencyKey,
        );
        if (concurrentOrder) {
          return { order: serializeOrder(concurrentOrder), replayed: true };
        }
      }
      throw error;
    }
  }

  return { getCart, addItem, updateItem, removeItem, checkout };
}

export type CartService = ReturnType<typeof createCartService>;
