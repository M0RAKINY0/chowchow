import { loadConfig } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { captureException, initializeSentry } from "./observability.js";
import { createEmailSender } from "./modules/notifications/email.sender.js";
import { createNotificationWorker } from "./modules/notifications/notification.worker.js";

const config = loadConfig();
initializeSentry(config);

const worker = createNotificationWorker({
  prisma,
  emailSender: createEmailSender(config),
  from: config.emailFrom,
});
const shutdownController = new AbortController();

const requestShutdown = () => {
  logger.info("Notification worker shutdown requested");
  shutdownController.abort();
};

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

try {
  await worker.start({ signal: shutdownController.signal });
} catch (error) {
  captureException(error, { worker: "notification-outbox", phase: "runtime" });
  logger.error({ err: error }, "Notification worker stopped unexpectedly");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
