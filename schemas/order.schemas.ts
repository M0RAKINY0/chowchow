import { z } from "zod";

const uuid = z.string().uuid();

export const orderIdSchema = uuid;

export const orderStatusSchema = z.enum([
  "PENDING_VENDOR_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DISPATCH",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
]);

export const orderListQuerySchema = z.object({
  vendorId: uuid.optional(),
  customerId: uuid.optional(),
  status: orderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(500).nullable().optional(),
});

export const cancelOrderSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});

export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
