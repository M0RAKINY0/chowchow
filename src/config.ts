import "dotenv/config";
import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().email().default("onboarding@resend.dev"),
    SENTRY_DSN: z.string().url().optional(),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((value, context) => {
    if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
      });
    }
  });

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  emailProvider: "console" | "resend";
  resendApiKey: string | undefined;
  emailFrom: string;
  sentryDsn: string | undefined;
  corsOrigin: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid runtime configuration: ${message}`);
  }

  const value = result.data;

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    jwtAccessSecret: value.JWT_ACCESS_SECRET,
    jwtRefreshSecret: value.JWT_REFRESH_SECRET,
    emailProvider: value.EMAIL_PROVIDER,
    resendApiKey: value.RESEND_API_KEY,
    emailFrom: value.EMAIL_FROM,
    sentryDsn: value.SENTRY_DSN,
    corsOrigin: value.CORS_ORIGIN,
    logLevel: value.LOG_LEVEL,
  };
}
