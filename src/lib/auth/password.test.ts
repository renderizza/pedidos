import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("valida a senha correta", async () => {
    const hash = await hashPassword("Senha@12345");
    expect(await verifyPassword("Senha@12345", hash)).toBe(true);
  });

  it("rejeita senha incorreta", async () => {
    const hash = await hashPassword("Senha@12345");
    expect(await verifyPassword("senha@12345", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("nunca guarda a senha em texto puro e usa o formato scrypt com parâmetros", async () => {
    const hash = await hashPassword("Senha@12345");
    expect(hash).not.toContain("Senha@12345");
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("gera hashes diferentes para a mesma senha (salt aleatório)", async () => {
    const [a, b] = await Promise.all([hashPassword("mesma-senha"), hashPassword("mesma-senha")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("mesma-senha", a)).toBe(true);
    expect(await verifyPassword("mesma-senha", b)).toBe(true);
  });

  it("trata senhas Unicode equivalentes (NFC/NFD) como iguais", async () => {
    const hash = await hashPassword("açúcar-12345");
    expect(await verifyPassword("a̧úcar-12345".normalize("NFD"), hash)).toBe(false);
    expect(await verifyPassword("açúcar-12345".normalize("NFD"), hash)).toBe(true);
  });

  it.each(["", "texto-qualquer", "bcrypt$10$abc$def", "scrypt$x$y$z$a$b", "scrypt$16384$8$1$AAAA$AAAA"])(
    "devolve false (sem lançar erro) para hash armazenado inválido: %j",
    async (stored) => {
      expect(await verifyPassword("qualquer", stored)).toBe(false);
    },
  );
});
