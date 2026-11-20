import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { parseConnection } from "./src/db/connection";

// Migrações usam DIRECT_URL (conexão direta ou "session pooler" do Supabase, porta 5432), porque o
// pooler em modo transação (porta 6543, usado pelo app) não é indicado para DDL. Sem DIRECT_URL,
// usa a DATABASE_URL — o caso do PostgreSQL local do Docker.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Campos separados (e não `url`): só assim o drizzle-kit aceita as opções de TLS.
  // Sem URL a config ainda carrega: `drizzle-kit generate` não precisa de banco.
  ...(url ? { dbCredentials: parseConnection(url) } : {}),
  strict: true,
  verbose: true,
});
