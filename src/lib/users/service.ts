import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";
import { createUserSchema, loginSchema, type CreateUserInput } from "@/lib/validation/user";

export class EmailAlreadyInUseError extends Error {
  constructor(email: string) {
    super(`Já existe um usuário com o e-mail ${email}`);
    this.name = "EmailAlreadyInUseError";
  }
}

/** Valida a entrada com Zod, aplica hash na senha e grava o usuário. */
export async function createUser(input: CreateUserInput | Record<string, unknown>): Promise<SessionUser> {
  const data = createUserSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  try {
    const [created] = await getDb()
      .insert(users)
      .values({ name: data.name, email: data.email, passwordHash, role: data.role })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailAlreadyInUseError(data.email);
    throw error;
  }
}

// Hash descartável: usado quando o e-mail não existe, para que o tempo de resposta
// seja parecido com o de uma senha errada (dificulta descobrir e-mails cadastrados).
let dummyHash: Promise<string> | undefined;

/**
 * Confere e-mail e senha. Devolve `null` para QUALQUER falha (e-mail inexistente,
 * senha errada, usuário desativado), sem revelar qual foi o motivo.
 */
export async function authenticate(input: { email?: unknown; password?: unknown }): Promise<SessionUser | null> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;

  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, parsed.data.email))
    .limit(1);

  if (!user) {
    dummyHash ??= hashPassword("senha-descartavel-para-igualar-o-tempo");
    await verifyPassword(parsed.data.password, await dummyHash);
    return null;
  }

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordOk || !user.active) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
