import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  getUserBySessionToken,
  hashSessionToken,
  SESSION_TTL_MS,
} from "@/lib/auth/session";
import { authenticate, createUser, EmailAlreadyInUseError } from "@/lib/users/service";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";

const input = { name: "Maria Silva", email: "Maria@Exemplo.com", password: "Senha@12345", role: "CONSULTOR" } as const;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("createUser", () => {
  it("cria o usuário, normaliza o e-mail e não devolve o hash da senha", async () => {
    const user = await createUser(input);
    expect(user).toMatchObject({ name: "Maria Silva", email: "maria@exemplo.com", role: "CONSULTOR" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("grava apenas o hash scrypt (verificável), nunca a senha", async () => {
    const created = await createUser(input);
    const [row] = await getDb().select().from(users).where(eq(users.id, created.id));
    expect(row.passwordHash).not.toContain("Senha@12345");
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Senha@12345", row.passwordHash)).toBe(true);
  });

  it("rejeita e-mail já cadastrado, ignorando maiúsculas/minúsculas", async () => {
    await createUser(input);
    await expect(createUser({ ...input, email: "MARIA@exemplo.COM" })).rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });

  it("valida a entrada com Zod antes de tocar no banco", async () => {
    await expect(createUser({ ...input, password: "curta" })).rejects.toBeInstanceOf(ZodError);
    await expect(createUser({ ...input, role: "ROOT" })).rejects.toBeInstanceOf(ZodError);
    expect(await getDb().select().from(users)).toHaveLength(0);
  });

  it("usa CLIENTE quando o perfil não é informado", async () => {
    const { role: _role, ...semPerfil } = input;
    expect((await createUser(semPerfil)).role).toBe("CLIENTE");
  });
});

describe("authenticate", () => {
  beforeEach(async () => {
    await createUser(input);
  });

  it("autentica com e-mail e senha corretos (e-mail case-insensitive)", async () => {
    const user = await authenticate({ email: "  MARIA@exemplo.com ", password: "Senha@12345" });
    expect(user).toMatchObject({ email: "maria@exemplo.com", role: "CONSULTOR" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("devolve null para senha errada", async () => {
    expect(await authenticate({ email: "maria@exemplo.com", password: "errada123" })).toBeNull();
  });

  it("devolve null para e-mail inexistente", async () => {
    expect(await authenticate({ email: "ninguem@exemplo.com", password: "Senha@12345" })).toBeNull();
  });

  it("devolve null para usuário desativado, mesmo com a senha certa", async () => {
    await getDb().update(users).set({ active: false }).where(eq(users.email, "maria@exemplo.com"));
    expect(await authenticate({ email: "maria@exemplo.com", password: "Senha@12345" })).toBeNull();
  });

  it.each([{}, { email: "x", password: "y" }, { email: null, password: null }, { email: "maria@exemplo.com", password: "" }])(
    "devolve null (sem lançar) para entrada malformada %j",
    async (bad) => {
      expect(await authenticate(bad)).toBeNull();
    },
  );
});

describe("sessões", () => {
  it("cria uma sessão válida por 7 dias e resolve o usuário pelo token", async () => {
    const { user } = await createUserWithSession("CLIENTE");
    const now = new Date("2026-01-01T12:00:00Z");
    const { token, expiresAt } = await createSession(user.id, { now });
    expect(expiresAt.getTime() - now.getTime()).toBe(SESSION_TTL_MS);
    expect(await getUserBySessionToken(token, { now })).toEqual(user);
  });

  it("guarda só o hash do token no banco", async () => {
    const { user } = await createUserWithSession("CLIENTE");
    const { token } = await createSession(user.id);
    const rows = await getDb().select().from(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
    expect(rows).toHaveLength(1);
    const all = JSON.stringify(await getDb().select().from(sessions));
    expect(all).not.toContain(token);
  });

  it("não resolve token inexistente, vazio ou adulterado", async () => {
    const { token } = await createUserWithSession("ADMIN");
    expect(await getUserBySessionToken("nao-existe")).toBeNull();
    expect(await getUserBySessionToken("")).toBeNull();
    expect(await getUserBySessionToken(`${token}x`)).toBeNull();
  });

  it("expira: após 7 dias o token deixa de valer", async () => {
    const { user } = await createUserWithSession("CLIENTE");
    const start = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(user.id, { now: start });
    const almost = new Date(start.getTime() + SESSION_TTL_MS - 1);
    const expired = new Date(start.getTime() + SESSION_TTL_MS);
    expect(await getUserBySessionToken(token, { now: almost })).not.toBeNull();
    expect(await getUserBySessionToken(token, { now: expired })).toBeNull();
  });

  it("invalida a sessão quando o usuário é desativado", async () => {
    const { user, token } = await createUserWithSession("CONSULTOR");
    expect(await getUserBySessionToken(token)).not.toBeNull();
    await getDb().update(users).set({ active: false }).where(eq(users.id, user.id));
    expect(await getUserBySessionToken(token)).toBeNull();
  });

  it("deleteSession encerra só a sessão informada", async () => {
    const { user, token } = await createUserWithSession("CLIENTE");
    const other = await createSession(user.id);
    await deleteSession(token);
    expect(await getUserBySessionToken(token)).toBeNull();
    expect(await getUserBySessionToken(other.token)).not.toBeNull();
  });

  it("deleteExpiredSessions remove apenas as vencidas", async () => {
    const { user } = await createUserWithSession("CLIENTE");
    const old = await createSession(user.id, { now: new Date("2020-01-01T00:00:00Z") });
    const fresh = await createSession(user.id);
    expect(await deleteExpiredSessions()).toBe(1);
    expect(await getUserBySessionToken(old.token, { now: new Date("2020-01-02T00:00:00Z") })).toBeNull();
    expect(await getUserBySessionToken(fresh.token)).not.toBeNull();
  });
});
