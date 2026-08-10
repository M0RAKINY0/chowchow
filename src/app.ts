import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { loadConfig, type AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { logger } from "./logger.js";
import { initializeSentry } from "./observability.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";

export function createApp(config: AppConfig = loadConfig()): Express {
  initializeSentry(config);

  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(",").map((origin) => origin.trim()) }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1/auth", createAuthRouter(createAuthService({ prisma, config })));

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/health/ready", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export function createNotFoundError(): AppError {
  return new AppError(404, "NOT_FOUND", "Route not found");
}
