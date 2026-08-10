import { Resend, type CreateEmailOptions } from "resend";
import type { AppConfig } from "../../config.js";
import { logger } from "../../logger.js";

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailSender = {
  send(message: EmailMessage): Promise<void>;
};

type ResendLike = {
  emails: {
    send(options: CreateEmailOptions): Promise<{
      data?: unknown;
      error?: { message?: string } | null;
    }>;
  };
};

export function createConsoleEmailSender(options: {
  from: string;
  onSend?: (message: EmailMessage) => void | Promise<void>;
}): EmailSender {
  return {
    async send(message) {
      if (options.onSend) {
        await options.onSend(message);
        return;
      }

      logger.info(
        {
          from: options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        },
        "Console email sent",
      );
    },
  };
}

export function createResendEmailSender(options: {
  apiKey: string;
  from: string;
  client?: ResendLike;
}): EmailSender {
  const client =
    options.client ?? (new Resend(options.apiKey) as unknown as ResendLike);

  return {
    async send(message) {
      const response = await client.emails.send({
        from: message.from || options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Resend rejected the email");
      }
    },
  };
}

export function createEmailSender(config: AppConfig): EmailSender {
  if (config.emailProvider === "resend") {
    if (!config.resendApiKey) {
      throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    }

    return createResendEmailSender({
      apiKey: config.resendApiKey,
      from: config.emailFrom,
    });
  }

  return createConsoleEmailSender({ from: config.emailFrom });
}
