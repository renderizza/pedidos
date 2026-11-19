import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;

// Guardado em globalThis para sobreviver ao hot reload do Next em desenvolvimento
// sem abrir um novo pool de conexões a cada recompilação.
const globalForDb = globalThis as unknown as { __pgPool?: Pool; __db?: Database };

/** Pool de conexões criado sob demanda (não conecta até a primeira query). */
export function getPool(): Pool {
  globalForDb.__pgPool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
  return globalForDb.__pgPool;
}

export function getDb(): Database {
  globalForDb.__db ??= drizzle(getPool(), { schema });
  return globalForDb.__db;
}

/** Encerra o pool (usado em testes e scripts). */
export async function closeDb(): Promise<void> {
  const pool = globalForDb.__pgPool;
  globalForDb.__pgPool = undefined;
  globalForDb.__db = undefined;
  await pool?.end();
}

export { schema };
