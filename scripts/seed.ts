/**
 * Popula o banco de DESENVOLVIMENTO com um usuário de cada perfil.
 * Uso: npm run db:seed
 */
import { closeDb } from "@/db";
import { createUser, EmailAlreadyInUseError } from "@/lib/users/service";

const DEV_USERS = [
  { name: "Administrador", email: "admin@pedidos.local", password: "admin12345", role: "ADMIN" },
  { name: "Consultor Demo", email: "consultor@pedidos.local", password: "consultor12345", role: "CONSULTOR" },
  { name: "Cliente Demo", email: "cliente@pedidos.local", password: "cliente12345", role: "CLIENTE" },
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed de desenvolvimento não deve rodar em produção.");
  }
  for (const user of DEV_USERS) {
    try {
      await createUser(user);
      console.log(`✔ ${user.role.padEnd(9)} ${user.email}  (senha: ${user.password})`);
    } catch (error) {
      if (error instanceof EmailAlreadyInUseError) {
        console.log(`• ${user.role.padEnd(9)} ${user.email}  já existe`);
      } else {
        throw error;
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
