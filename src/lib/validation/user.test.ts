import { describe, expect, it } from "vitest";
import { createUserSchema, loginSchema, userRoleSchema } from "./user";

const valid = { name: "Maria Silva", email: "maria@exemplo.com", password: "senha1234", role: "CONSULTOR" };

describe("createUserSchema", () => {
  it("aceita um usuário válido", () => {
    expect(createUserSchema.parse(valid)).toEqual(valid);
  });

  it("normaliza o e-mail (trim + minúsculas) e apara o nome", () => {
    const result = createUserSchema.parse({ ...valid, name: "  Maria Silva  ", email: "  MARIA@Exemplo.COM " });
    expect(result.email).toBe("maria@exemplo.com");
    expect(result.name).toBe("Maria Silva");
  });

  it("usa CLIENTE como perfil padrão", () => {
    const { role: _role, ...withoutRole } = valid;
    expect(createUserSchema.parse(withoutRole).role).toBe("CLIENTE");
  });

  it.each(["ADMIN", "CONSULTOR", "CLIENTE"])("aceita o perfil %s", (role) => {
    expect(userRoleSchema.parse(role)).toBe(role);
  });

  it.each(["admin", "SUPER", "", null, 1])("rejeita o perfil %j", (role) => {
    expect(userRoleSchema.safeParse(role).success).toBe(false);
  });

  it("rejeita e-mail inválido", () => {
    const result = createUserSchema.safeParse({ ...valid, email: "sem-arroba" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("E-mail inválido");
  });

  it("rejeita senha curta e senha longa demais", () => {
    expect(createUserSchema.safeParse({ ...valid, password: "1234567" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, password: "x".repeat(129) }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, password: "x".repeat(128) }).success).toBe(true);
  });

  it("rejeita nome vazio ou só com espaços", () => {
    expect(createUserSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejeita campos ausentes", () => {
    const result = createUserSchema.safeParse({});
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });
});

describe("loginSchema", () => {
  it("aceita credenciais e normaliza o e-mail", () => {
    expect(loginSchema.parse({ email: " A@B.com ", password: "qualquer" })).toEqual({
      email: "a@b.com",
      password: "qualquer",
    });
  });

  it("não aplica regra de força de senha no login", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "1" }).success).toBe(true);
  });

  it("rejeita senha vazia e e-mail inválido", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});
