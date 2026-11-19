import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, getPool, schema } from "@/db";

describe("conexão com o PostgreSQL", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("usa o banco de testes (nunca o de desenvolvimento)", async () => {
    const { rows } = await getPool().query<{ current_database: string }>(
      "select current_database()",
    );
    expect(rows[0].current_database).toMatch(/_test$/);
  });

  it("responde a uma query simples via Drizzle", async () => {
    const result = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows[0].ok).toBe(1);
  });

  it("está rodando PostgreSQL 16", async () => {
    const { rows } = await getPool().query<{ server_version: string }>("show server_version");
    expect(rows[0].server_version.startsWith("16")).toBe(true);
  });
});

describe("migrações", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("registra as migrações aplicadas no controle do Drizzle", async () => {
    const { rows } = await getPool().query<{ total: string }>(
      "select count(*) as total from drizzle.__drizzle_migrations",
    );
    expect(Number(rows[0].total)).toBeGreaterThanOrEqual(1);
  });

  it("criou a tabela app_meta com as colunas esperadas", async () => {
    const { rows } = await getPool().query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'app_meta' order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["created_at", "key", "updated_at", "value"]);
    expect(rows.every((r) => r.is_nullable === "NO")).toBe(true);
  });

  it("grava, lê e remove um registro (roundtrip) com timestamps automáticos", async () => {
    const db = getDb();
    const key = `teste-${Date.now()}`;
    try {
      await db.insert(schema.appMeta).values({ key, value: "ok" });
      const [row] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key));
      expect(row.value).toBe("ok");
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    } finally {
      await db.delete(schema.appMeta).where(eq(schema.appMeta.key, key));
    }
    const remaining = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key));
    expect(remaining).toHaveLength(0);
  });

  it("rejeita chave duplicada (primary key)", async () => {
    const db = getDb();
    const key = `dup-${Date.now()}`;
    try {
      await db.insert(schema.appMeta).values({ key, value: "a" });
      await expect(db.insert(schema.appMeta).values({ key, value: "b" })).rejects.toThrow();
    } finally {
      await db.delete(schema.appMeta).where(eq(schema.appMeta.key, key));
    }
  });
});
