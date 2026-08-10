import type { PrismaClient, User } from "@prisma/client";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../errors.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "./tokens.js";
import type { LoginInput, RefreshInput, RegisterInput } from "./auth.schemas.js";

export type RequestMetadata = {
  ipAddress: string | undefined;
  userAgent: string | undefined;
};

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: User["role"];
  createdAt: Date;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
};

export type AuthResult = {
  user: PublicUser;
  tokens: TokenPair;
};

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function invalidCredentials(): AppError {
  return new AppError(401, "AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
}

export function createAuthService(input: {
  prisma: PrismaClient;
  config: AppConfig;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());

  async function issueTokenPair(
    transaction: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    user: User,
    metadata: RequestMetadata,
  ): Promise<TokenPair> {
    const refreshToken = createRefreshToken();
    await transaction.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiresAt(now()),
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
    });

    return {
      accessToken: await createAccessToken({ userId: user.id, role: user.role }, input.config.jwtAccessSecret),
      refreshToken,
      accessTokenExpiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    };
  }

  async function register(registerInput: RegisterInput, metadata: RequestMetadata): Promise<AuthResult> {
    const existingUser = await input.prisma.user.findUnique({ where: { email: registerInput.email } });
    if (existingUser) {
      throw new AppError(409, "AUTH_EMAIL_TAKEN", "An account with this email already exists");
    }

    const passwordHash = await hashPassword(registerInput.password);
    return input.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: registerInput.email,
          fullName: registerInput.fullName,
          passwordHash,
          role: "CUSTOMER",
        },
      });
      const tokens = await issueTokenPair(transaction, user, metadata);
      await writeAuditEvent(transaction, {
        actorUserId: user.id,
        action: "AUTH_REGISTERED",
        entityType: "User",
        entityId: user.id,
        metadata: { role: user.role },
        ...metadata,
      });
      return { user: toPublicUser(user), tokens };
    });
  }

  async function login(loginInput: LoginInput, metadata: RequestMetadata): Promise<AuthResult> {
    const user = await input.prisma.user.findUnique({ where: { email: loginInput.email } });
    const validPassword = user ? await verifyPassword(user.passwordHash, loginInput.password) : false;
    if (!user || !user.isActive || !validPassword) {
      await writeAuditEvent(input.prisma, {
        actorUserId: user?.id ?? null,
        action: "AUTH_LOGIN_FAILED",
        entityType: "User",
        entityId: user?.id ?? null,
        metadata: { email: loginInput.email },
        ...metadata,
      });
      throw invalidCredentials();
    }

    return input.prisma.$transaction(async (transaction) => {
      const tokens = await issueTokenPair(transaction, user, metadata);
      await writeAuditEvent(transaction, {
        actorUserId: user.id,
        action: "AUTH_LOGIN_SUCCEEDED",
        entityType: "User",
        entityId: user.id,
        metadata: { role: user.role },
        ...metadata,
      });
      return { user: toPublicUser(user), tokens };
    });
  }

  async function refresh(refreshInput: RefreshInput, metadata: RequestMetadata): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(refreshInput.refreshToken);
    const storedToken = await input.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new AppError(401, "AUTH_INVALID_REFRESH_TOKEN", "Refresh token is invalid");
    }

    return input.prisma.$transaction(async (transaction) => {
      if (storedToken.revokedAt) {
        await transaction.refreshToken.updateMany({
          where: { userId: storedToken.userId, revokedAt: null },
          data: { revokedAt: now() },
        });
        await writeAuditEvent(transaction, {
          actorUserId: storedToken.userId,
          action: "AUTH_REFRESH_REUSE_DETECTED",
          entityType: "RefreshToken",
          entityId: storedToken.id,
          metadata: {},
          ...metadata,
        });
        throw new AppError(401, "AUTH_REFRESH_REUSED", "Refresh token reuse was detected");
      }

      if (storedToken.expiresAt <= now() || !storedToken.user.isActive) {
        await transaction.refreshToken.update({ where: { id: storedToken.id }, data: { revokedAt: now() } });
        throw new AppError(401, "AUTH_INVALID_REFRESH_TOKEN", "Refresh token is expired or inactive");
      }

      await transaction.refreshToken.update({ where: { id: storedToken.id }, data: { revokedAt: now() } });
      const tokens = await issueTokenPair(transaction, storedToken.user, metadata);
      await writeAuditEvent(transaction, {
        actorUserId: storedToken.userId,
        action: "AUTH_REFRESHED",
        entityType: "User",
        entityId: storedToken.userId,
        metadata: {},
        ...metadata,
      });
      return { user: toPublicUser(storedToken.user), tokens };
    });
  }

  async function logout(refreshInput: RefreshInput, metadata: RequestMetadata): Promise<void> {
    const tokenHash = hashRefreshToken(refreshInput.refreshToken);
    const storedToken = await input.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!storedToken || storedToken.revokedAt) {
      return;
    }

    await input.prisma.$transaction(async (transaction) => {
      await transaction.refreshToken.update({ where: { id: storedToken.id }, data: { revokedAt: now() } });
      await writeAuditEvent(transaction, {
        actorUserId: storedToken.userId,
        action: "AUTH_LOGGED_OUT",
        entityType: "RefreshToken",
        entityId: storedToken.id,
        metadata: {},
        ...metadata,
      });
    });
  }

  async function getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await input.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication is required");
    }
    return toPublicUser(user);
  }

  return { register, login, refresh, logout, getCurrentUser };
}

export type AuthService = ReturnType<typeof createAuthService>;
