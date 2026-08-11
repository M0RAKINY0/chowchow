import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../src/db.js";
import {
  createConsoleEmailSender,
  createResendEmailSender,
  type EmailMessage,
} from "../../../src/modules/notifications/email.sender.js";
import { renderNotification } from "../../../src/modules/notifications/notification.templates.js";
import {
  createNotificationWorker,
  type EmailSender,
} from "../../../src/modules/notifications/notification.worker.js";

const basePayload = {
  orderId: "order-1",
  orderNumber: "CHW-001",
  vendorName: "Lagos Bites",
  deliveryAddress: "1 Demo Street",
  totalKobo: 250_000,
  items: [
    {
      name: "Jollof Rice",
      quantity: 2,
      unitPriceKobo: 100_000,
      lineTotalKobo: 200_000,
    },
  ],
};

async function resetDatabase(): Promise<void> {
  await prisma.notificationOutbox.deleteMany();
}

async function createOutbox(input: {
  dedupeKey: string;
  type?: string;
  status?: "PENDING" | "PROCESSING";
  attempts?: number;
  nextAttemptAt?: Date;
  lockedAt?: Date | null;
  payload?: object;
}) {
  return prisma.notificationOutbox.create({
    data: {
      dedupeKey: input.dedupeKey,
      type: input.type ?? "ORDER_CREATED",
      aggregateType: "Order",
      aggregateId: "order-1",
      recipientEmail: "vendor@example.com",
      payload: input.payload ?? basePayload,
      status: input.status ?? "PENDING",
      attempts: input.attempts ?? 0,
      nextAttemptAt:
        input.nextAttemptAt ?? new Date("2026-08-10T10:00:00.000Z"),
      lockedAt: input.lockedAt ?? null,
    },
  });
}

function fakeSender(send: EmailSender["send"]): EmailSender {
  return { send };
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(resetDatabase);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("notification templates and email adapters", () => {
  it("renders order-created and status-change messages with useful content", () => {
    const created = renderNotification({
      type: "ORDER_CREATED",
      recipientEmail: "vendor@example.com",
      payload: basePayload,
    });
    expect(created.subject).toContain("CHW-001");
    expect(created.text).toContain("Jollof Rice");
    expect(created.html).toContain("250000");

    const status = renderNotification({
      type: "ORDER_STATUS_CHANGED",
      recipientEmail: "customer@example.com",
      payload: {
        ...basePayload,
        fromStatus: "CONFIRMED",
        toStatus: "PREPARING",
        note: "Kitchen started",
      },
    });
    expect(status.subject).toContain("PREPARING");
    expect(status.text).toContain("Kitchen started");
  });

  it("supports an observable console email adapter", async () => {
    const onSend = vi.fn();
    const sender = createConsoleEmailSender({
      from: "onboarding@resend.dev",
      onSend,
    });
    const message: EmailMessage = {
      from: "onboarding@resend.dev",
      to: "vendor@example.com",
      subject: "Test",
      text: "Test body",
      html: "<p>Test body</p>",
    };

    await sender.send(message);
    expect(onSend).toHaveBeenCalledWith(message);
  });

  it("sends through Resend and surfaces provider errors", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ data: { id: "email-1" }, error: null });
    const sender = createResendEmailSender({
      apiKey: "re_test_key",
      from: "onboarding@resend.dev",
      client: { emails: { send } },
    });
    const message: EmailMessage = {
      from: "onboarding@resend.dev",
      to: "vendor@example.com",
      subject: "Test",
      text: "Test body",
      html: "<p>Test body</p>",
    };

    await sender.send(message);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: message.from,
        to: message.to,
        subject: message.subject,
      }),
    );

    send.mockResolvedValueOnce({
      data: null,
      error: { message: "Resend rejected the email" },
    });
    await expect(sender.send(message)).rejects.toThrow(
      "Resend rejected the email",
    );
  });
});

describe("notification outbox worker", () => {
  it("claims, sends, marks sent, and does not duplicate completed notifications", async () => {
    const now = new Date("2026-08-10T10:00:00.000Z");
    await createOutbox({ dedupeKey: "dedupe-1" });
    const send = vi.fn().mockResolvedValue(undefined);
    const worker = createNotificationWorker({
      prisma,
      emailSender: fakeSender(send),
      now: () => now,
    });

    const firstRun = await worker.processBatch();
    const secondRun = await worker.processBatch();
    const record = await prisma.notificationOutbox.findUnique({
      where: { dedupeKey: "dedupe-1" },
    });

    expect(firstRun).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(secondRun).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({
      status: "SENT",
      attempts: 1,
      sentAt: now,
      lockedAt: null,
    });
  });

  it("retries with exponential backoff and captures exhausted failures", async () => {
    let now = new Date("2026-08-10T10:00:00.000Z");
    await createOutbox({ dedupeKey: "retry-1" });
    const send = vi.fn().mockRejectedValue(new Error("temporary email outage"));
    const captureError = vi.fn();
    const worker = createNotificationWorker({
      prisma,
      emailSender: fakeSender(send),
      now: () => now,
      retryBaseMs: 1_000,
      maxAttempts: 3,
      captureError,
    });

    await worker.processBatch();
    let record = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { dedupeKey: "retry-1" },
    });
    expect(record).toMatchObject({
      status: "PENDING",
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 1_000),
    });
    expect(captureError).not.toHaveBeenCalled();

    now = new Date(now.getTime() + 1_000);
    await worker.processBatch();
    now = new Date(now.getTime() + 2_000);
    await worker.processBatch();
    record = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { dedupeKey: "retry-1" },
    });

    expect(record.status).toBe("FAILED");
    expect(record.attempts).toBe(3);
    expect(record.lastError).toBe("temporary email outage");
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("reclaims stale processing records and prevents concurrent duplicate claims", async () => {
    const now = new Date("2026-08-10T10:00:00.000Z");
    await createOutbox({
      dedupeKey: "stale-1",
      status: "PROCESSING",
      lockedAt: new Date("2026-08-10T09:00:00.000Z"),
    });
    await createOutbox({ dedupeKey: "concurrent-1" });
    await createOutbox({ dedupeKey: "concurrent-2" });
    const send = vi.fn(async () => undefined);
    const firstWorker = createNotificationWorker({
      prisma,
      emailSender: fakeSender(send),
      now: () => now,
      batchSize: 1,
    });
    const secondWorker = createNotificationWorker({
      prisma,
      emailSender: fakeSender(send),
      now: () => now,
      batchSize: 1,
    });

    const [firstRun, secondRun] = await Promise.all([
      firstWorker.processBatch(),
      secondWorker.processBatch(),
    ]);
    const records = await prisma.notificationOutbox.findMany({
      orderBy: { dedupeKey: "asc" },
    });

    expect(firstRun.claimed + secondRun.claimed).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(records.filter((record) => record.status === "SENT")).toHaveLength(
      2,
    );
    expect(
      records.find((record) => record.dedupeKey === "concurrent-2")?.status,
    ).toBe("PENDING");
  });
});
