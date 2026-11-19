import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { UserRole } from "@/lib/auth/roles";
import { createSession } from "@/lib/auth/session";
import { createUser } from "@/lib/users/service";

/** Esvazia todas as tabelas de domínio (o banco de integração é só dos testes). */
export async function resetDatabase(): Promise<void> {
  await getDb().execute(
    sql`truncate table order_items, orders, products, categories, sessions, users restart identity cascade`,
  );
}

let counter = 0;

/** Cria um usuário com e-mail único e devolve também um token de sessão válido. */
export async function createUserWithSession(role: UserRole, options: { active?: boolean } = {}) {
  counter += 1;
  const user = await createUser({
    name: `Usuário ${role} ${counter}`,
    email: `${role.toLowerCase()}${counter}@teste.com`,
    password: "Senha@12345",
    role,
  });
  if (options.active === false) {
    await getDb().update(users).set({ active: false }).where(eq(users.id, user.id));
  }
  const { token } = await createSession(user.id);
  return { user, token };
}
