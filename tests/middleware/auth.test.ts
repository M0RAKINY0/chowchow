import { describe, expect, it, vi } from "vitest";
import { requireRoles } from "../../src/middleware/auth.js";

describe("requireRoles", () => {
  it("rejects an authenticated customer from an admin-only route", () => {
    const next = vi.fn();
    const request = { auth: { id: "customer-1", role: "CUSTOMER" } } as never;

    requireRoles("ADMIN")(request, {} as never, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: "FORBIDDEN" }),
    );
  });
});
