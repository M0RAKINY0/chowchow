import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { loadConfig, type AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { logger } from "./logger.js";
import { initializeSentry } from "./observability.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { createVendorRouter } from "./modules/vendors/vendor.routes.js";
import { createVendorService } from "./modules/vendors/vendor.service.js";
import {
  createCartRouter,
  createCheckoutRouter,
} from "./modules/cart/cart.routes.js";
import { createCartService } from "./modules/cart/cart.service.js";
import {
  createOrderRouter,
  createVendorOrderRouter,
} from "./modules/orders/order.routes.js";
import { createOrderService } from "./modules/orders/order.service.js";
import { createPopularFoodRouter } from "./modules/popular/popular-food.routes.js";
import { createPopularFoodService } from "./modules/popular/popular-food.service.js";
import { createPopularFoodCache } from "./modules/popular/popular-food.cache.js";
import { openApiDocument } from "./docs/openapi.js";

export function createApp(config: AppConfig = loadConfig()): Express {
  initializeSentry(config);

  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin.split(",").map((origin) => origin.trim()),
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/docs/openapi.json", (_request, response) => {
    response.status(200).json(openApiDocument);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  const popularFoodCache = createPopularFoodCache(config);
  const popularFoodService = createPopularFoodService({
    prisma,
    cache: popularFoodCache,
  });
  app.use("/api/v1/vendors", createPopularFoodRouter(popularFoodService));
  app.use(
    "/api/v1/auth",
    createAuthRouter(createAuthService({ prisma, config })),
  );
  app.use(
    "/api/v1/vendors",
    createVendorRouter(createVendorService({ prisma, popularFoodCache })),
  );
  const cartService = createCartService({ prisma, popularFoodCache });
  app.use("/api/v1/carts", createCartRouter(cartService));
  app.use("/api/v1/checkout", createCheckoutRouter(cartService));
  const orderService = createOrderService({ prisma, popularFoodCache });
  app.use("/api/v1/orders", createOrderRouter(orderService));
  app.use("/api/v1/vendors", createVendorOrderRouter(orderService));

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
