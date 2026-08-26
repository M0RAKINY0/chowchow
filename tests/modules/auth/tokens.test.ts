import { describe, expect, it } from "vitest";
import {
  createAccessToken,
  hashRefreshToken,
  verifyAccessToken,
} from "../../../src/modules/auth/tokens.js";

describe("auth tokens", () => {
  it("creates and verifies an access token with the expected claims", async () => {
    const token = await createAccessToken(
      { userId: "user-123", role: "CUSTOMER" },
      "test-access-secret-chowchow-2026",
    );

    await expect(
      verifyAccessToken(token, "test-access-secret-chowchow-2026"),
    ).resolves.toMatchObject({
      sub: "user-123",
      role: "CUSTOMER",
      type: "access",
    });
  });

  it("hashes the same refresh token deterministically without storing it in plaintext", () => {
    const refreshToken = "opaque-refresh-token";
    const firstHash = hashRefreshToken(refreshToken);

    expect(firstHash).toBe(hashRefreshToken(refreshToken));
    expect(firstHash).not.toBe(refreshToken);
  });
});
