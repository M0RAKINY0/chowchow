import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes a password and verifies the original value", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");

    expect(passwordHash).not.toContain("correct horse battery staple");
    await expect(verifyPassword(passwordHash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "wrong password")).resolves.toBe(false);
  });
});
