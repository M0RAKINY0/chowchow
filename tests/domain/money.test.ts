import { describe, expect, it } from "vitest";
import { calculateOrderTotals } from "../../src/domain/money.js";

describe("calculateOrderTotals", () => {
  it("calculates integer-kobo subtotal, delivery fee, and total", () => {
    expect(
      calculateOrderTotals({
        items: [
          { unitPriceKobo: 250_000, quantity: 2 },
          { unitPriceKobo: 175_000, quantity: 1 },
        ],
        deliveryFeeKobo: 100_000,
      }),
    ).toEqual({
      subtotalKobo: 675_000,
      deliveryFeeKobo: 100_000,
      totalKobo: 775_000,
    });
  });

  it("rejects non-positive prices and quantities", () => {
    expect(() =>
      calculateOrderTotals({
        items: [{ unitPriceKobo: 0, quantity: 1 }],
        deliveryFeeKobo: 100_000,
      }),
    ).toThrowError("Menu item prices must be positive");
  });
});
