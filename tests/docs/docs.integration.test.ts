import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { exportOpenApi } from "../../src/docs/export.js";
import { openApiDocument } from "../../src/docs/openapi.js";

describe("API documentation", () => {
  it("serves the OpenAPI document", async () => {
    const response = await request(createApp()).get("/docs/openapi.json");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      openapi: "3.0.3",
      info: { title: "Chowchow Backend API" },
    });
    expect(response.body.paths).toHaveProperty("/api/v1/checkout");
    expect(response.body.paths).toHaveProperty(
      "/api/v1/vendors/{vendorId}/popular-items",
    );
  });

  it("serves the interactive Swagger UI", async () => {
    const response = await request(createApp()).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui");
  });

  it("keeps the committed OpenAPI JSON synchronized with the runtime document", async () => {
    const fileContents = await readFile(
      resolve(process.cwd(), "openapi.json"),
      "utf8",
    );

    expect(JSON.parse(fileContents)).toEqual(openApiDocument);
  });

  it("exports OpenAPI JSON to the requested output path", async () => {
    const temporaryDirectory = await mkdtemp(
      resolve(tmpdir(), "chowchow-openapi-"),
    );
    const outputPath = resolve(temporaryDirectory, "nested", "openapi.json");

    try {
      await exportOpenApi(outputPath);

      const fileContents = await readFile(outputPath, "utf8");

      expect(JSON.parse(fileContents)).toMatchObject({
        openapi: "3.0.3",
        info: { title: "Chowchow Backend API" },
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
