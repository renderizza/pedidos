/**
 * Cria o primeiro usuário ADMIN em qualquer banco — inclusive produção, onde o `db:seed` é bloqueado
 * (ele só cria usuários de desenvolvimento, com senhas conhecidas).
 *
 * Uso (a senha vai por variável de ambiente para não aparecer na lista de processos):
 *   DATABASE_URL='postgresql://...' \
 *   ADMIN_NAME='Maria Silva' ADMIN_EMAIL='maria@empresa.com' ADMIN_PASSWORD='...' \
 *   npm run db:create-admin
 *
 * Variáveis já definidas no ambiente têm prioridade sobre as do arquivo .env.
 */
import { ZodError } from "zod";
import { closeDb } from "@/db";
import { parseConnection } from "@/db/connection";
import { getEnv } from "@/lib/env";
import { createUser, EmailAlreadyInUseError } from "@/lib/users/service";

async function main() {
  const { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!name || !email || !password) {
    throw new Error("Defina ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD (veja o comentário no topo do script).");
  }

  // Mostra o destino (sem a senha) para evitar criar o admin no banco errado.
  const { host, database } = parseConnection(getEnv().DATABASE_URL);
  console.log(`Banco: ${database} em ${host}`);

  try {
    const admin = await createUser({ name, email, password, role: "ADMIN" });
    console.log(`✔ ADMIN criado: ${admin.name} <${admin.email}>`);
  } catch (error) {
    if (error instanceof EmailAlreadyInUseError) {
      console.log(`• ${email} já existe; nada foi alterado.`);
    } else if (error instanceof ZodError) {
      throw new Error(`Dados inválidos:\n${error.issues.map((issue) => `  - ${issue.message}`).join("\n")}`);
    } else {
      throw error;
    }
  }
}

/**
 * O Drizzle embrulha o erro do driver e põe a query com os parâmetros (inclusive o hash da senha) na
 * mensagem. Mostra só a causa, que é o que ajuda a achar o problema (senha do banco errada, TLS etc.).
 */
function describeError(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error) return error.cause.message;
  return error instanceof Error ? error.message : String(error);
}

main()
  .catch((error) => {
    console.error(describeError(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
