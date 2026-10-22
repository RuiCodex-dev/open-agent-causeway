import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("GET /health", () => {
  const appPromise = buildServer();

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it("returns 200 and status ok", async () => {
    const app = await appPromise;
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; service: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("causeway");
  });
});
