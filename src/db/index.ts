import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import { parseConnection } from "./connection";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;

// Guardado em globalThis para sobreviver ao hot reload do Next em desenvolvimento
// sem abrir um novo pool de conexões a cada recompilação.
const globalForDb = globalThis as unknown as { __pgPool?: Pool; __db?: Database };

/**
 * Em produção (Vercel) cada instância tem o seu pool, e o pooler do Supabase (porta 6543) limita as
 * conexões do projeto: poucas por instância. Fora dela, o padrão do `pg`, que os testes de concorrência usam.
 */
const POOL_MAX = process.env.NODE_ENV === "production" ? 5 : 10;

/** Pool de conexões criado sob demanda (não conecta até a primeira query). */
export function getPool(): Pool {
  if (!globalForDb.__pgPool) {
    const pool = new Pool({
      ...parseConnection(getEnv().DATABASE_URL),
      max: POOL_MAX,
      // Libera conexões paradas antes que o pooler as derrube e falha rápido se o banco não responder
      // (sem isso, uma conexão pendurada segura a requisição até o limite da função).
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // Sem um handler, o erro de uma conexão ociosa derrubada pelo servidor derruba o processo inteiro.
    pool.on("error", (error) => console.error("Erro numa conexão ociosa do PostgreSQL:", error.message));
    globalForDb.__pgPool = pool;
  }
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
