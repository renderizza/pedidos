import type { UserRole } from "@/lib/auth/roles";
import { closeDb } from "@/db";
import { createUser, EmailAlreadyInUseError } from "@/lib/users/service";

export type TestUser = { name: string; email: string; password: string; role: UserRole };

export const TEST_USERS = {
  admin: { name: "Ana Admin", email: "admin@teste.com", password: "Admin@12345", role: "ADMIN" },
  consultor: {
    name: "Caio Consultor",
    email: "consultor@teste.com",
    password: "Consultor@12345",
    role: "CONSULTOR",
  },
  cliente: { name: "Cléo Cliente", email: "cliente@teste.com", password: "Cliente@12345", role: "CLIENTE" },
} as const satisfies Record<string, TestUser>;

/** Cria os usuários de teste (idempotente: ignora e-mails já cadastrados). */
export async function seedTestUsers(): Promise<void> {
  for (const user of Object.values(TEST_USERS)) {
    try {
      await createUser(user);
    } catch (error) {
      if (!(error instanceof EmailAlreadyInUseError)) throw error;
    }
  }
  await closeDb();
}
