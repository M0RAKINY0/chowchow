import { Prisma, type OrderStatus, type PrismaClient } from "@prisma/client";
import { AppError } from "../../errors.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import {
  invalidatePopularFoodCache,
  type PopularFoodCache,
} from "../popular/popular-food.cache.js";
import type {
  OrderListQuery,
  OrderStatusInput,
  UpdateOrderStatusInput,
} from "../../../schemas/order.schemas.js";

const orderInclude = {
  customer: { select: { id: true, email: true, fullName: true } },
  vendor: {
    select: { id: true, name: true, slug: true, notificationEmail: true },
  },
  items: { orderBy: { id: "asc" } },
  statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.OrderInclude;

type OrderWithDetails = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;
export type OrderActor = { id: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" };

type RequestMetadata = {
  ipAddress: string | undefined;
  userAgent: string | undefined;
};

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_VENDOR_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_DISPATCH"],
  READY_FOR_DISPATCH: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

function notFound(): AppError {
  return new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
}

function toPublicOrder(order: OrderWithDetails) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    vendorId: order.vendorId,
    status: order.status,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotalKobo: order.subtotalKobo,
    deliveryFeeKobo: order.deliveryFeeKobo,
    totalKobo: order.totalKobo,
    deliveryAddress: order.deliveryAddress,
    deliveryNote: order.deliveryNote,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    customer: order.customer,
    vendor: {
      id: order.vendor.id,
      name: order.vendor.name,
      slug: order.vendor.slug,
    },
    items: order.items,
    statusHistory: order.statusHistory,
  };
}

export function createOrderService(input: {
  prisma: PrismaClient;
  popularFoodCache?: PopularFoodCache;
}) {
  async function findOrder(orderId: string): Promise<OrderWithDetails> {
    const order = await input.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    if (!order) {
      throw notFound();
    }
    return order;
  }

  async function assertAccess(
    order: OrderWithDetails,
    actor: OrderActor,
  ): Promise<void> {
    if (actor.role === "ADMIN") {
      return;
    }
    if (actor.role === "CUSTOMER") {
      if (order.customerId !== actor.id) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "You do not have access to this order",
        );
      }
      return;
    }

    const membership = await input.prisma.vendorMembership.findUnique({
      where: {
        userId_vendorId: { userId: actor.id, vendorId: order.vendorId },
      },
    });
    if (!membership) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "You do not have access to this order",
      );
    }
  }

  async function listOrders(actor: OrderActor, query: OrderListQuery) {
    const where: Prisma.OrderWhereInput = {};
    if (actor.role === "CUSTOMER") {
      where.customerId = actor.id;
    } else if (actor.role === "VENDOR") {
      if (query.vendorId) {
        const membership = await input.prisma.vendorMembership.findUnique({
          where: {
            userId_vendorId: { userId: actor.id, vendorId: query.vendorId },
          },
        });
        if (!membership) {
          throw new AppError(
            403,
            "FORBIDDEN",
            "You do not have access to this vendor",
          );
        }
        where.vendorId = query.vendorId;
      } else {
        const memberships = await input.prisma.vendorMembership.findMany({
          where: { userId: actor.id },
          select: { vendorId: true },
        });
        where.vendorId = {
          in: memberships.map((membership) => membership.vendorId),
        };
      }
    } else if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.vendorId && actor.role === "CUSTOMER") {
      where.vendorId = query.vendorId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const [orders, total] = await input.prisma.$transaction([
      input.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: query.offset,
        take: query.limit,
      }),
      input.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map(toPublicOrder),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore: query.offset + orders.length < total,
      },
    };
  }

  async function getOrder(orderId: string, actor: OrderActor) {
    const order = await findOrder(orderId);
    await assertAccess(order, actor);
    return { order: toPublicOrder(order) };
  }

  async function assertTransitionAllowed(
    order: OrderWithDetails,
    actor: OrderActor,
    status: OrderStatusInput,
  ): Promise<void> {
    if (actor.role === "CUSTOMER") {
      if (status !== "CANCELLED") {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Customers can only cancel their own orders",
        );
      }
      if (
        order.status !== "PENDING_VENDOR_CONFIRMATION" &&
        order.status !== "CONFIRMED"
      ) {
        throw new AppError(
          409,
          "ORDER_CANCELLATION_NOT_ALLOWED",
          "An order cannot be cancelled after preparation starts",
        );
      }
    } else if (actor.role === "VENDOR") {
      await assertAccess(order, actor);
    }

    if (order.status === status) {
      throw new AppError(
        409,
        "ORDER_ALREADY_IN_STATUS",
        "The order is already in that status",
      );
    }
    if (!allowedTransitions[order.status].includes(status)) {
      throw new AppError(
        409,
        "ORDER_INVALID_TRANSITION",
        `Order cannot move from ${order.status} to ${status}`,
      );
    }
  }

  async function updateStatus(
    orderId: string,
    actor: OrderActor,
    statusInput: UpdateOrderStatusInput,
    metadata: RequestMetadata,
  ) {
    const order = await findOrder(orderId);
    await assertAccess(order, actor);
    await assertTransitionAllowed(order, actor, statusInput.status);

    const updatedOrder = await input.prisma.$transaction(
      async (transaction) => {
        const changed = await transaction.order.updateMany({
          where: { id: order.id, status: order.status },
          data: { status: statusInput.status },
        });
        if (changed.count !== 1) {
          throw new AppError(
            409,
            "ORDER_STATUS_CONFLICT",
            "The order status changed; please retry",
          );
        }

        await transaction.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: statusInput.status,
            actorUserId: actor.id,
            note: statusInput.note ?? null,
          },
        });
        const recipientEmail =
          actor.role === "CUSTOMER"
            ? order.vendor.notificationEmail
            : order.customer.email;
        await transaction.notificationOutbox.create({
          data: {
            dedupeKey: `order-status:${order.id}:${statusInput.status}`,
            type: "ORDER_STATUS_CHANGED",
            aggregateType: "Order",
            aggregateId: order.id,
            recipientEmail,
            payload: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              fromStatus: order.status,
              toStatus: statusInput.status,
              note: statusInput.note ?? null,
            },
          },
        });
        await writeAuditEvent(transaction, {
          actorUserId: actor.id,
          action: "ORDER_STATUS_CHANGED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            fromStatus: order.status,
            toStatus: statusInput.status,
            note: statusInput.note ?? null,
          },
          ...metadata,
        });

        return transaction.order.findUniqueOrThrow({
          where: { id: order.id },
          include: orderInclude,
        });
      },
    );

    await invalidatePopularFoodCache(
      input.popularFoodCache,
      updatedOrder.vendorId,
    );
    return { order: toPublicOrder(updatedOrder) };
  }

  return { listOrders, getOrder, updateStatus };
}

export type OrderService = ReturnType<typeof createOrderService>;
