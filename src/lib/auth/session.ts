import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import type { UserRole } from "./roles";

export const SESSION_COOKIE = "pedidos_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/** Usuário autenticado, sem nenhum dado sensível (nunca inclui o hash da senha). */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type Options = { now?: Date };

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda apenas o hash: vazamento da tabela não permite sequestrar sessões. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  { now = new Date() }: Options = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await getDb().insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

/** Resolve o usuário de um token; `null` se inexistente, expirado ou usuário desativado. */
export async function getUserBySessionToken(
  token: string,
  { now = new Date() }: Options = {},
): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, now),
        eq(users.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** Remove sessões vencidas (manutenção; pode rodar em um job periódico). */
export async function deleteExpiredSessions({ now = new Date() }: Options = {}): Promise<number> {
  const removed = await getDb()
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return removed.length;
}
