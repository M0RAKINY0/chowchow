import { Prisma, PrismaClient } from "@prisma/client";
import { captureException } from "../../observability.js";
import { renderNotification } from "./notification.templates.js";
import { type EmailMessage, type EmailSender } from "./email.sender.js";

export type { EmailSender } from "./email.sender.js";

export type NotificationBatchResult = {
  claimed: number;
  sent: number;
  failed: number;
};

export type NotificationWorkerHealth = {
  lastRunAt: Date | null;
  lastRunError: string | null;
};

type NotificationWorkerOptions = {
  prisma: PrismaClient;
  emailSender: EmailSender;
  from?: string;
  batchSize?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  lockTimeoutMs?: number;
  now?: () => Date;
  captureError?: (error: unknown, context?: Record<string, unknown>) => void;
};

type StartOptions = {
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForNextPoll(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createNotificationWorker(options: NotificationWorkerOptions) {
  const batchSize = options.batchSize ?? 10;
  const maxAttempts = options.maxAttempts ?? 5;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  const lockTimeoutMs = options.lockTimeoutMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  const from = options.from ?? "onboarding@resend.dev";
  const captureError = options.captureError ?? captureException;
  const health: NotificationWorkerHealth = {
    lastRunAt: null,
    lastRunError: null,
  };

  if (
    batchSize < 1 ||
    maxAttempts < 1 ||
    retryBaseMs < 0 ||
    lockTimeoutMs < 0
  ) {
    throw new Error(
      "Notification worker options must use positive limits and non-negative delays",
    );
  }

  async function claimBatch() {
    const currentTime = now();
    const staleBefore = new Date(currentTime.getTime() - lockTimeoutMs);

    return options.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE (
          (
            "status" = CAST('PENDING' AS "NotificationStatus")
            AND "nextAttemptAt" <= ${currentTime}
          )
          OR (
            "status" = CAST('PROCESSING' AS "NotificationStatus")
            AND ("lockedAt" IS NULL OR "lockedAt" <= ${staleBefore})
          )
        )
        ORDER BY "createdAt" ASC, "dedupeKey" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      `);

      if (candidates.length === 0) {
        return [];
      }

      const ids = candidates.map((candidate) => candidate.id);
      await transaction.notificationOutbox.updateMany({
        where: { id: { in: ids } },
        data: { status: "PROCESSING", lockedAt: currentTime },
      });

      return transaction.notificationOutbox.findMany({
        where: { id: { in: ids } },
        orderBy: [{ createdAt: "asc" }, { dedupeKey: "asc" }],
      });
    });
  }

  async function processRecord(
    record: Awaited<ReturnType<typeof claimBatch>>[number],
  ): Promise<"sent" | "failed"> {
    try {
      const rendered = renderNotification({
        type: record.type,
        recipientEmail: record.recipientEmail,
        payload: record.payload,
      });
      const message: EmailMessage = {
        from,
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      };

      await options.emailSender.send(message);
      await options.prisma.notificationOutbox.update({
        where: { id: record.id },
        data: {
          status: "SENT",
          attempts: record.attempts + 1,
          sentAt: now(),
          lockedAt: null,
          lastError: null,
        },
      });
      return "sent";
    } catch (error) {
      const attempts = record.attempts + 1;
      const exhausted = attempts >= maxAttempts;
      const currentTime = now();
      const nextAttemptAt = new Date(
        currentTime.getTime() + retryBaseMs * 2 ** (attempts - 1),
      );

      await options.prisma.notificationOutbox.update({
        where: { id: record.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          nextAttemptAt,
          lockedAt: null,
          lastError: errorMessage(error),
          sentAt: null,
        },
      });

      if (exhausted) {
        captureError(error, {
          notificationId: record.id,
          notificationType: record.type,
          attempts,
        });
      }

      return "failed";
    }
  }

  async function processBatch(): Promise<NotificationBatchResult> {
    const runAt = now();

    try {
      const records = await claimBatch();
      let sent = 0;
      let failed = 0;

      for (const record of records) {
        const result = await processRecord(record);
        if (result === "sent") {
          sent += 1;
        } else {
          failed += 1;
        }
      }

      health.lastRunAt = runAt;
      health.lastRunError = null;
      return { claimed: records.length, sent, failed };
    } catch (error) {
      health.lastRunAt = runAt;
      health.lastRunError = errorMessage(error);
      captureError(error, { worker: "notification-outbox", phase: "claim" });
      throw error;
    }
  }

  async function start(startOptions: StartOptions = {}): Promise<void> {
    const pollIntervalMs = startOptions.pollIntervalMs ?? 1_000;

    while (!startOptions.signal?.aborted) {
      await processBatch();
      await waitForNextPoll(pollIntervalMs, startOptions.signal);
    }
  }

  return {
    processBatch,
    start,
    getHealth(): NotificationWorkerHealth {
      return { ...health };
    },
  };
}
