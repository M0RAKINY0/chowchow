import { describe, expect, it } from "vitest";
import { seedData } from "./seed-data.js";

describe("seed data", () => {
  it("contains two vendors with menu categories and items", () => {
    expect(seedData.vendors).toHaveLength(2);
    expect(seedData.categories).toHaveLength(4);
    expect(seedData.menuItems).toHaveLength(8);
    expect(seedData.users.map((user) => user.role)).toEqual(
      expect.arrayContaining(["CUSTOMER", "ADMIN", "VENDOR", "VENDOR"]),
    );
  });
});
