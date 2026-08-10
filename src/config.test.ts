import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("loads required runtime configuration from environment variables", () => {
    process.env.NODE_ENV = "test";
    process.env.PORT = "4100";
    process.env.DATABASE_URL = "postgresql://postgres:password@localhost:5432/chowchow_test";
    process.env.REDIS_URL = "redis://localhost:6379/1";
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);

    expect(loadConfig()).toMatchObject({
      nodeEnv: "test",
      port: 4100,
      databaseUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
    });
  });

  it("rejects missing secrets instead of starting with unsafe defaults", () => {
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => loadConfig()).toThrowError(/DATABASE_URL|JWT_ACCESS_SECRET/);
  });
});
