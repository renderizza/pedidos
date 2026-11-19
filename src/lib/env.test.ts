import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("aceita uma DATABASE_URL postgres válida", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5433/pedidos" });
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5433/pedidos");
  });

  it("aceita o esquema curto postgres://", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://user:pass@localhost/db" })).not.toThrow();
  });

  it("falha quando DATABASE_URL está ausente", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("falha quando DATABASE_URL não é uma URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "isso-nao-e-url" })).toThrow(/URL válida/);
  });

  it("falha quando o protocolo não é postgres", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://user:pass@localhost/db" })).toThrow(
      /postgres/,
    );
  });

  describe("WHATSAPP_ORDERS_NUMBER (opcional)", () => {
    const base = { DATABASE_URL: "postgresql://user:pass@localhost:5433/pedidos" };

    it.each([undefined, "", "   "])("ausente ou em branco (%j) significa 'não configurado'", (value) => {
      expect(parseEnv({ ...base, WHATSAPP_ORDERS_NUMBER: value }).WHATSAPP_ORDERS_NUMBER).toBeUndefined();
    });

    it.each([
      ["5511999998888", "5511999998888"],
      ["+55 (11) 99999-8888", "5511999998888"],
      ["(11) 99999-8888", "11999998888"],
      ["1133334444", "1133334444"],
    ])("aceita %j e guarda só os dígitos", (value, digits) => {
      expect(parseEnv({ ...base, WHATSAPP_ORDERS_NUMBER: value }).WHATSAPP_ORDERS_NUMBER).toBe(digits);
    });

    it.each(["123", "abc", "1".repeat(16), "+()-"])("rejeita %j com mensagem clara", (value) => {
      expect(() => parseEnv({ ...base, WHATSAPP_ORDERS_NUMBER: value })).toThrow(/WHATSAPP_ORDERS_NUMBER/);
    });
  });
});
