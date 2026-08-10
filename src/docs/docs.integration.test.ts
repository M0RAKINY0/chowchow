import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

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
});
