import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
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
      resolve(process.cwd(), "docs/openapi.json"),
      "utf8",
    );

    expect(JSON.parse(fileContents)).toEqual(openApiDocument);
  });
});
