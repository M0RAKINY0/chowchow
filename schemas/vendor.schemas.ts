import { z } from "zod";

const postgresInt = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const nonNegativeKobo = z.number().int().min(0).max(2_147_483_647);
const positiveKobo = z.number().int().min(1).max(2_147_483_647);
const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email().max(320);

export const vendorIdSchema = uuid;

export const vendorListQuerySchema = z.object({
  search: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(100).optional(),
  ),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createVendorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  notificationEmail: email,
  deliveryFeeKobo: nonNegativeKobo,
});

export const updateVendorSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    notificationEmail: email.optional(),
    deliveryFeeKobo: nonNegativeKobo.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: postgresInt.min(0).default(0),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: postgresInt.min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const createMenuItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  priceKobo: positiveKobo,
  categoryId: uuid.nullable().optional(),
  imageUrl: z.string().trim().url().max(2_048).nullable().optional(),
  isAvailable: z.boolean().default(true),
});

export const updateMenuItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    priceKobo: positiveKobo.optional(),
    categoryId: uuid.nullable().optional(),
    imageUrl: z.string().trim().url().max(2_048).nullable().optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type VendorListQuery = z.infer<typeof vendorListQuerySchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
