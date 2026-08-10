import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { prisma } from "../../db.js";

const app = createApp(loadConfig());

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "RefreshToken", "VendorMembership", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("authentication API", () => {
  it("registers a customer, returns tokens, and records a safe audit event", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({
      email: "customer@example.com",
      fullName: "Example Customer",
      password: "correct horse battery staple",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user).toMatchObject({
      email: "customer@example.com",
      fullName: "Example Customer",
      role: "CUSTOMER",
    });
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "customer@example.com" } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "AUTH_REGISTERED" } });
    expect(user.passwordHash).not.toContain("correct horse battery staple");
    expect(audit.metadata).not.toHaveProperty("password");
  });

  it("rejects invalid credentials and records the failed login", async () => {
    await request(app).post("/api/v1/auth/register").send({
      email: "customer@example.com",
      fullName: "Example Customer",
      password: "correct horse battery staple",
    });

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "customer@example.com",
      password: "wrong password",
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    await expect(prisma.auditLog.findFirst({ where: { action: "AUTH_LOGIN_FAILED" } })).resolves.not.toBeNull();
  });

  it("rotates refresh tokens and rejects reuse of the old token", async () => {
    const registerResponse = await request(app).post("/api/v1/auth/register").send({
      email: "customer@example.com",
      fullName: "Example Customer",
      password: "correct horse battery staple",
    });
    const firstRefreshToken = registerResponse.body.data.refreshToken as string;

    const refreshResponse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: firstRefreshToken });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.data.refreshToken).not.toBe(firstRefreshToken);

    const reuseResponse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: firstRefreshToken });
    expect(reuseResponse.status).toBe(401);
    expect(reuseResponse.body.error.code).toBe("AUTH_REFRESH_REUSED");
  });

  it("protects the current-user endpoint and revokes a refresh token on logout", async () => {
    const registerResponse = await request(app).post("/api/v1/auth/register").send({
      email: "customer@example.com",
      fullName: "Example Customer",
      password: "correct horse battery staple",
    });
    const { accessToken, refreshToken } = registerResponse.body.data as {
      accessToken: string;
      refreshToken: string;
    };

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.user.email).toBe("customer@example.com");

    const logoutResponse = await request(app).post("/api/v1/auth/logout").send({ refreshToken });
    expect(logoutResponse.status).toBe(204);

    const refreshAfterLogout = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
