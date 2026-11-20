/**
 * Conexão com o PostgreSQL (local, Docker ou Supabase), num só lugar para o app (`src/db/index.ts`)
 * e para o `drizzle.config.ts`. Sem imports do projeto (nada de `@/`): o drizzle-kit carrega este arquivo.
 *
 * Por que não deixar o `pg` interpretar `?sslmode=` sozinho: na versão atual, `sslmode=require`
 * vira `verify-full` (e avisa que está obsoleto). O Supabase não usa uma CA pública, então o handshake
 * falharia com "self-signed certificate in certificate chain". Aqui o `sslmode` da URL é lido,
 * mas o TLS é decidido explicitamente.
 */

export type SslOptions = { rejectUnauthorized: boolean; ca?: string };

export type PgConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** `false` = sem TLS. */
  ssl: false | SslOptions;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/**
 * Decide o TLS:
 * - `sslmode=disable` na URL, ou host local sem `sslmode`: sem TLS (o container do Docker não tem TLS);
 * - `DATABASE_SSL_CA` definida: TLS validando o certificado do servidor contra essa CA;
 * - host remoto, nos demais casos: TLS **sem** validar a cadeia (é o que o Supabase documenta para
 *   o `pg`; o tráfego vai criptografado, mas não protege contra um servidor falso).
 */
function resolveSsl(host: string, sslmode: string | null, env: Record<string, string | undefined>) {
  if (sslmode === "disable") return false as const;
  if (isLocalHost(host) && !sslmode) return false as const;

  // Variáveis de ambiente multilinha costumam chegar com "\n" literal (arquivo .env).
  const ca = env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();
  if (ca) return { rejectUnauthorized: true, ca } satisfies SslOptions;

  return { rejectUnauthorized: false } satisfies SslOptions;
}

/** Quebra a URL do banco em campos (a senha pode ter caracteres codificados, como %40). */
export function parseConnection(
  rawUrl: string,
  env: Record<string, string | undefined> = process.env,
): PgConnection {
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^\[(.+)\]$/, "$1"); // IPv6 vem entre colchetes
  if (!host) {
    throw new Error("A URL do banco precisa ter o host (postgresql://usuario:senha@host:porta/banco).");
  }
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl: resolveSsl(host, url.searchParams.get("sslmode"), env),
  };
}
