import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(320);

export const registerSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
