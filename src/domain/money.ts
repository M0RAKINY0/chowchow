export type PricedLineItem = {
  unitPriceKobo: number;
  quantity: number;
};

export type OrderTotals = {
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
};

export function calculateOrderTotals(input: {
  items: PricedLineItem[];
  deliveryFeeKobo: number;
}): OrderTotals {
  if (!Number.isSafeInteger(input.deliveryFeeKobo) || input.deliveryFeeKobo < 0) {
    throw new Error("Delivery fees must be a non-negative integer");
  }

  let subtotalKobo = 0;

  for (const item of input.items) {
    if (!Number.isSafeInteger(item.unitPriceKobo) || item.unitPriceKobo <= 0) {
      throw new Error("Menu item prices must be positive");
    }

    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Menu item quantities must be positive integers");
    }

    subtotalKobo += item.unitPriceKobo * item.quantity;
    if (!Number.isSafeInteger(subtotalKobo)) {
      throw new Error("Order total exceeds the supported amount");
    }
  }

  const totalKobo = subtotalKobo + input.deliveryFeeKobo;
  if (!Number.isSafeInteger(totalKobo)) {
    throw new Error("Order total exceeds the supported amount");
  }

  return { subtotalKobo, deliveryFeeKobo: input.deliveryFeeKobo, totalKobo };
}
