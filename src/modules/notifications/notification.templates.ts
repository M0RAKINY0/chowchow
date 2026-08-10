export type NotificationInput = {
  type: string;
  recipientEmail: string;
  payload: unknown;
};

export type RenderedNotification = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type NotificationPayload = Record<string, unknown>;

function asPayload(value: unknown): NotificationPayload {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as NotificationPayload;
  }

  return {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? fallback
      : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'\"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

function orderSummary(payload: NotificationPayload): {
  orderNumber: string;
  vendorName: string;
  deliveryAddress: string;
  totalKobo: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPriceKobo: number;
    lineTotalKobo: number;
  }>;
} {
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => {
        const itemPayload = asPayload(item);
        return {
          name: asString(itemPayload.name, "Menu item"),
          quantity: asNumber(itemPayload.quantity, 0),
          unitPriceKobo: asNumber(itemPayload.unitPriceKobo, 0),
          lineTotalKobo: asNumber(itemPayload.lineTotalKobo, 0),
        };
      })
    : [];

  return {
    orderNumber: asString(
      payload.orderNumber,
      asString(payload.orderId, "Unknown order"),
    ),
    vendorName: asString(payload.vendorName, "Chowchow vendor"),
    deliveryAddress: asString(payload.deliveryAddress, "Not provided"),
    totalKobo: asNumber(payload.totalKobo, 0),
    items,
  };
}

export function renderNotification(
  input: NotificationInput,
): RenderedNotification {
  const payload = asPayload(input.payload);
  const summary = orderSummary(payload);
  const itemText = summary.items.length
    ? summary.items
        .map(
          (item) =>
            `- ${item.quantity} x ${item.name} at ${item.unitPriceKobo} kobo = ${item.lineTotalKobo} kobo`,
        )
        .join("\n")
    : "- No items listed";
  const itemHtml = summary.items.length
    ? summary.items
        .map(
          (item) =>
            `<li>${escapeHtml(String(item.quantity))} x ${escapeHtml(item.name)} at ${escapeHtml(String(item.unitPriceKobo))} kobo = ${escapeHtml(String(item.lineTotalKobo))} kobo</li>`,
        )
        .join("")
    : "<li>No items listed</li>";

  if (input.type === "ORDER_CREATED") {
    return {
      to: input.recipientEmail,
      subject: `New order ${summary.orderNumber} for ${summary.vendorName}`,
      text: [
        `A new order ${summary.orderNumber} has been placed for ${summary.vendorName}.`,
        "",
        itemText,
        "",
        `Delivery address: ${summary.deliveryAddress}`,
        `Total: ${summary.totalKobo} kobo`,
      ].join("\n"),
      html: [
        `<h1>New order ${escapeHtml(summary.orderNumber)}</h1>`,
        `<p>A new order has been placed for ${escapeHtml(summary.vendorName)}.</p>`,
        `<ul>${itemHtml}</ul>`,
        `<p>Delivery address: ${escapeHtml(summary.deliveryAddress)}</p>`,
        `<p>Total: ${escapeHtml(String(summary.totalKobo))} kobo</p>`,
      ].join(""),
    };
  }

  if (input.type === "ORDER_STATUS_CHANGED") {
    const fromStatus = asString(payload.fromStatus, "UNKNOWN");
    const toStatus = asString(payload.toStatus, "UNKNOWN");
    const note = asString(payload.note);

    return {
      to: input.recipientEmail,
      subject: `Order ${summary.orderNumber} is now ${toStatus}`,
      text: [
        `Order ${summary.orderNumber} changed from ${fromStatus} to ${toStatus}.`,
        note ? `Note: ${note}` : "",
        `Vendor: ${summary.vendorName}`,
      ]
        .filter(Boolean)
        .join("\n"),
      html: [
        `<h1>Order ${escapeHtml(summary.orderNumber)}: ${escapeHtml(toStatus)}</h1>`,
        `<p>Status changed from ${escapeHtml(fromStatus)} to ${escapeHtml(toStatus)}.</p>`,
        note ? `<p>Note: ${escapeHtml(note)}</p>` : "",
        `<p>Vendor: ${escapeHtml(summary.vendorName)}</p>`,
      ].join(""),
    };
  }

  throw new Error(`Unsupported notification type: ${input.type}`);
}
