import { z } from "zod";

const uuid = z.string().uuid();

export const vendorIdSchema = uuid;
export const cartItemIdSchema = uuid;

export const addCartItemSchema = z.object({
  menuItemId: uuid,
  quantity: z.number().int().min(1).max(99),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

export const checkoutSchema = z.object({
  vendorId: uuid,
  deliveryAddress: z.string().trim().min(5).max(500),
  deliveryNote: z.string().trim().max(500).nullable().optional(),
  paymentMethod: z.literal("CASH_ON_DELIVERY").default("CASH_ON_DELIVERY"),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
