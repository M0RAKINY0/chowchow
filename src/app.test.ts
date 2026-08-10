import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://postgres:password@localhost:5432/chowchow_test";
process.env.REDIS_URL = "redis://localhost:6379/1";
process.env.JWT_ACCESS_SECRET = "a".repeat(32);
process.env.JWT_REFRESH_SECRET = "b".repeat(32);

describe("API foundation", () => {
  it("returns a healthy liveness response", async () => {
    const response = await request(createApp()).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns the standard error envelope for unknown routes", async () => {
    const response = await request(createApp()).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Route not found",
    });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
