import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { captureException } from "../observability.js";

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const appError = error instanceof AppError ? error : undefined;
  const statusCode = appError?.statusCode ?? 500;
  const code = appError?.code ?? "INTERNAL_SERVER_ERROR";
  const message = appError?.message ?? "An unexpected error occurred";

  if (!appError || statusCode >= 500) {
    logger.error({ err: error, requestId: request.requestId }, "Unhandled request error");
    captureException(error, { requestId: request.requestId, path: request.path, method: request.method });
  }

  const errorBody: { code: string; message: string; requestId: string; details?: unknown } = {
    code,
    message,
    requestId: request.requestId,
  };

  if (appError?.details !== undefined) {
    errorBody.details = appError.details;
  }

  response.status(statusCode).json({ error: errorBody });
};
