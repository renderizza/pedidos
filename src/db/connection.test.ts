import { describe, expect, it } from "vitest";
import { parseConnection } from "./connection";

const SUPABASE_POOLER =
  "postgresql://postgres.abcdefghijklmnop:s3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

describe("parseConnection — campos da URL", () => {
  it("separa host, porta, usuário, senha e banco", () => {
    expect(parseConnection("postgresql://pedidos:pedidos@localhost:5433/pedidos", {})).toMatchObject({
      host: "localhost",
      port: 5433,
      user: "pedidos",
      password: "pedidos",
      database: "pedidos",
    });
  });

  it("usa a porta 5432 quando a URL não traz porta", () => {
    expect(parseConnection("postgres://u:p@db.exemplo.com/app", {}).port).toBe(5432);
  });

  it("decodifica usuário e senha (caracteres especiais vêm em %XX)", () => {
    const connection = parseConnection("postgresql://us%40er:p%40ss%2Fw%23rd@db.exemplo.com:5432/app", {});
    expect(connection.user).toBe("us@er");
    expect(connection.password).toBe("p@ss/w#rd");
  });

  it("aceita o usuário do pooler do Supabase (postgres.<ref>)", () => {
    expect(parseConnection(SUPABASE_POOLER, {})).toMatchObject({
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: 6543,
      user: "postgres.abcdefghijklmnop",
      database: "postgres",
    });
  });

  it("tira os colchetes de um host IPv6", () => {
    const connection = parseConnection("postgresql://u:p@[::1]:5433/app", {});
    expect(connection.host).toBe("::1");
    expect(connection.ssl).toBe(false);
  });

  it("recusa uma URL sem host, com uma mensagem clara", () => {
    expect(() => parseConnection("postgresql:///app", {})).toThrow(/host/);
  });
});

describe("parseConnection — TLS", () => {
  it.each(["localhost", "127.0.0.1", "host.docker.internal"])("host local (%s) não usa TLS", (host) => {
    expect(parseConnection(`postgresql://u:p@${host}:5433/app`, {}).ssl).toBe(false);
  });

  it("host remoto usa TLS sem validar a cadeia (o Supabase não usa uma CA pública)", () => {
    expect(parseConnection(SUPABASE_POOLER, {}).ssl).toEqual({ rejectUnauthorized: false });
  });

  it("sslmode=require continua sem validar a cadeia (o pg o trataria como verify-full)", () => {
    expect(parseConnection(`${SUPABASE_POOLER}?sslmode=require`, {}).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("sslmode=disable desliga o TLS mesmo em host remoto", () => {
    expect(parseConnection(`${SUPABASE_POOLER}?sslmode=disable`, {}).ssl).toBe(false);
  });

  it("sslmode=require num host local liga o TLS", () => {
    expect(parseConnection("postgresql://u:p@localhost:5433/app?sslmode=require", {}).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("com DATABASE_SSL_CA valida o certificado do servidor contra essa CA", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----";
    expect(parseConnection(SUPABASE_POOLER, { DATABASE_SSL_CA: ca }).ssl).toEqual({
      rejectUnauthorized: true,
      ca,
    });
  });

  it("DATABASE_SSL_CA aceita \\n literal (como vem de um arquivo .env)", () => {
    const connection = parseConnection(SUPABASE_POOLER, {
      DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----",
    });
    expect(connection.ssl).toMatchObject({
      ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----",
    });
  });

  it("DATABASE_SSL_CA em branco é ignorada", () => {
    expect(parseConnection(SUPABASE_POOLER, { DATABASE_SSL_CA: "  " }).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("DATABASE_SSL_CA não liga TLS num host local", () => {
    expect(parseConnection("postgresql://u:p@localhost:5433/app", { DATABASE_SSL_CA: "x" }).ssl).toBe(false);
  });
});
