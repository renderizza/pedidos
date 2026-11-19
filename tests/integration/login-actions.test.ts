import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction, logoutAction } from "@/app/login/actions";
import { closeDb, getDb } from "@/db";
import { sessions } from "@/db/schema";
import { INVALID_CREDENTIALS_MESSAGE, performLogin } from "@/lib/auth/login";
import { getUserBySessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";
import { createUser } from "@/lib/users/service";
import { resetDatabase } from "../setup/db-helpers";
import { cookieJar, cookieOptions, RedirectError, resetNextMocks } from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);

const PASSWORD = "Senha@12345";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function sessionCount() {
  return (await getDb().select().from(sessions)).length;
}

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
  await createUser({ name: "Ana", email: "admin@teste.com", password: PASSWORD, role: "ADMIN" });
  await createUser({ name: "Caio", email: "consultor@teste.com", password: PASSWORD, role: "CONSULTOR" });
  await createUser({ name: "Cléo", email: "cliente@teste.com", password: PASSWORD, role: "CLIENTE" });
});

afterAll(async () => {
  await closeDb();
});

describe("performLogin", () => {
  it.each([
    ["admin@teste.com", "ADMIN", "/admin"],
    ["consultor@teste.com", "CONSULTOR", "/"],
    ["cliente@teste.com", "CLIENTE", "/"],
  ])("%s entra como %s e vai para %s", async (email, role, redirectTo) => {
    const result = await performLogin(form({ email, password: PASSWORD }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.role).toBe(role);
    expect(result.redirectTo).toBe(redirectTo);
    expect(await getUserBySessionToken(result.token)).toEqual(result.user);
  });

  it("respeita o parâmetro next quando é um caminho interno", async () => {
    const result = await performLogin(form({ email: "admin@teste.com", password: PASSWORD, next: "/admin/produtos" }));
    expect(result.ok && result.redirectTo).toBe("/admin/produtos");
  });

  it.each(["https://evil.com", "//evil.com", "javascript:alert(1)"])(
    "ignora next malicioso %s (open redirect)",
    async (next) => {
      const result = await performLogin(form({ email: "admin@teste.com", password: PASSWORD, next }));
      expect(result.ok && result.redirectTo).toBe("/admin");
    },
  );

  it("senha errada: mensagem genérica, e-mail preservado, nenhuma sessão criada", async () => {
    const result = await performLogin(form({ email: "admin@teste.com", password: "errada1234" }));
    expect(result).toEqual({ ok: false, state: { error: INVALID_CREDENTIALS_MESSAGE, email: "admin@teste.com" } });
    expect(await sessionCount()).toBe(0);
  });

  it("e-mail inexistente recebe a MESMA mensagem (não revela quais e-mails existem)", async () => {
    const wrongPassword = await performLogin(form({ email: "admin@teste.com", password: "errada1234" }));
    const unknownEmail = await performLogin(form({ email: "fantasma@teste.com", password: "errada1234" }));
    expect(!unknownEmail.ok && unknownEmail.state.error).toBe(!wrongPassword.ok && wrongPassword.state.error);
  });

  it("campos vazios devolvem erros por campo (Zod) e não consultam credenciais", async () => {
    const result = await performLogin(form({ email: "", password: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.fieldErrors).toMatchObject({ email: expect.any(Array), password: expect.any(Array) });
    expect(await sessionCount()).toBe(0);
  });

  it("nunca devolve a senha no estado do formulário", async () => {
    const result = await performLogin(form({ email: "admin@teste.com", password: "errada1234" }));
    expect(JSON.stringify(result)).not.toContain("errada1234");
  });
});

describe("loginAction (Server Action)", () => {
  it("sucesso: grava o cookie de sessão seguro e redireciona para a página do perfil", async () => {
    await expect(loginAction(undefined, form({ email: "admin@teste.com", password: PASSWORD }))).rejects.toMatchObject({
      url: "/admin",
    });

    const token = cookieJar.get(SESSION_COOKIE)!;
    expect(token).toBeTruthy();
    expect(await getUserBySessionToken(token)).toMatchObject({ role: "ADMIN" });

    const options = cookieOptions.get(SESSION_COOKIE)!;
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const lifetime = (options.expires as Date).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(SESSION_TTL_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(SESSION_TTL_MS);
  });

  it("falha: devolve o erro, não define cookie e não redireciona", async () => {
    const state = await loginAction(undefined, form({ email: "admin@teste.com", password: "errada1234" }));
    expect(state?.error).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("logoutAction", () => {
  it("apaga a sessão do banco, limpa o cookie e redireciona ao login", async () => {
    await expect(loginAction(undefined, form({ email: "cliente@teste.com", password: PASSWORD }))).rejects.toBeInstanceOf(
      RedirectError,
    );
    const token = cookieJar.get(SESSION_COOKIE)!;
    expect(await sessionCount()).toBe(1);

    await expect(logoutAction()).rejects.toMatchObject({ url: "/login" });

    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    expect(await sessionCount()).toBe(0);
    expect(await getUserBySessionToken(token)).toBeNull();
  });

  it("sem sessão ativa, apenas redireciona ao login", async () => {
    await expect(logoutAction()).rejects.toMatchObject({ url: "/login" });
  });

  it("encerra só a sessão atual, mantendo as de outros dispositivos", async () => {
    await expect(loginAction(undefined, form({ email: "cliente@teste.com", password: PASSWORD }))).rejects.toBeInstanceOf(
      RedirectError,
    );
    const otherDevice = await performLogin(form({ email: "cliente@teste.com", password: PASSWORD }));
    expect(await sessionCount()).toBe(2);

    await expect(logoutAction()).rejects.toBeInstanceOf(RedirectError);

    expect(await sessionCount()).toBe(1);
    expect(otherDevice.ok && (await getUserBySessionToken(otherDevice.token))).toBeTruthy();
  });
});
