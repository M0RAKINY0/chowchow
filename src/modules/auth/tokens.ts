import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

const ACCESS_TOKEN_TTL = "15m";
export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccessTokenClaims = JWTPayload & {
  sub: string;
  role: UserRole;
  type: "access";
};

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(input: { userId: string; role: UserRole }, secret: string): Promise<string> {
  return new SignJWT({ role: input.role, type: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretBytes(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretBytes(secret), { algorithms: ["HS256"] });
  const role = payload.role;
  if (
    typeof payload.sub !== "string" ||
    payload.type !== "access" ||
    (role !== "CUSTOMER" && role !== "VENDOR" && role !== "ADMIN")
  ) {
    throw new Error("Invalid access token claims");
  }

  return { ...payload, sub: payload.sub, role, type: "access" };
}

export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

export function refreshTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}
