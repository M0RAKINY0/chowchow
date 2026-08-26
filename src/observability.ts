import * as Sentry from "@sentry/node";
import type { AppConfig } from "./config.js";

let sentryInitialized = false;

export function initializeSentry(config: AppConfig): void {
  if (sentryInitialized || !config.sentryDsn) {
    return;
  }

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }

      return event;
    },
  });

  sentryInitialized = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext("request", context);
    }
    Sentry.captureException(error);
  });
}
