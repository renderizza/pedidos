import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Rotas dentro do matcher que são PÚBLICAS: o visitante (sem cadastro) monta e finaliza o pedido
 * aqui. As Server Actions são POSTs na rota onde são usadas, então esta exceção vale para elas também —
 * por isso as ações que exigem login continuam conferindo a sessão por conta própria (`requirePermission`).
 */
const PUBLIC_PATHS = new Set(["/pedidos/novo"]);

/**
 * Checagem OTIMISTA: só olha se existe cookie de sessão, para mandar visitantes
 * direto ao login. A validação real (sessão no banco + perfil) acontece nos guards
 * de cada página/ação — o proxy nunca é a única barreira de segurança.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname.replace(/\/+$/, ""))) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/pedidos/:path*"],
};
