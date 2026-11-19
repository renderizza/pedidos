import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { closeDb } from "@/db";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("responde 200 com database 'up' quando o PostgreSQL está acessível", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", database: "up" });
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it("responde 503 com database 'down' quando o PostgreSQL está inacessível", async () => {
    // O pool fica em globalThis e o ambiente é memorizado por módulo: fechamos o pool
    // atual e isolamos os módulos para que a nova DATABASE_URL seja realmente lida.
    await closeDb();
    vi.resetModules();
    // Porta onde nada escuta: a conexão é recusada imediatamente.
    vi.stubEnv("DATABASE_URL", "postgresql://pedidos:pedidos@127.0.0.1:1/pedidos_test");

    const { GET: isolatedGet } = await import("@/app/api/health/route");
    const { closeDb: closeIsolatedDb } = await import("@/db");
    try {
      const response = await isolatedGet();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: "error", database: "down" });
    } finally {
      await closeIsolatedDb();
    }
  });
});
