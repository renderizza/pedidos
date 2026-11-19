import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

function parseDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    throw new Error("DATABASE_URL não definida. Verifique o arquivo .env.test.");
  }
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return { url, databaseName };
}

async function connectWithRetry(connectionString: string, attempts = 15): Promise<Client> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    `Não foi possível conectar ao PostgreSQL. O container está rodando? Execute "npm run db:up".\n${String(lastError)}`,
  );
}

/**
 * Garante que o banco de testes existe e está com todas as migrações aplicadas.
 * É idempotente: pode ser chamada por Vitest e por Playwright sem efeitos colaterais.
 */
export async function prepareTestDatabase(rawUrl = process.env.DATABASE_URL): Promise<void> {
  const { url, databaseName } = parseDatabaseUrl(rawUrl);

  // Trava de segurança: nunca rodar testes contra o banco de desenvolvimento.
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Recusando preparar o banco "${databaseName}": o banco de testes deve terminar em "_test".`,
    );
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = await connectWithRetry(adminUrl.toString());
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [
      databaseName,
    ]);
    if (!rowCount) {
      await admin.query(`create database "${databaseName.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
