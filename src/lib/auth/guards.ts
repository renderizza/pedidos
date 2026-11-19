import { forbidden, redirect } from "next/navigation";
import { readSessionToken } from "./cookies";
import { hasPermission, type Permission } from "./rbac";
import type { UserRole } from "./roles";
import { getUserBySessionToken, type SessionUser } from "./session";

/** Usuário da requisição atual ou `null` (visitante). Valida a sessão no banco. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  return getUserBySessionToken(token);
}

/** Exige login: visitantes são enviados para /login (com `next` para voltar depois). */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return user;
}

/** Exige login E um dos perfis informados; caso contrário responde 403. */
export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) forbidden();
  return user;
}

/** Exige login E a permissão informada; caso contrário responde 403. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) forbidden();
  return user;
}
