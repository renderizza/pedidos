import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { getCurrentUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import type { UserRole } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "ADMIN",
  CONSULTOR: "CONSULTOR",
  CLIENTE: "CLIENTE",
};

/** Parte visual (sem acesso a cookies/banco): fácil de testar em unidade. */
export function SiteHeaderView({ user }: { user: SessionUser | null }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      {/*
        Celular: marca à esquerda e perfil + "Sair" à direita na primeira linha; os links, abaixo, quebrando
        linha se preciso. A partir de "sm" tudo fica numa linha só (o `contents` desfaz o agrupamento).
      */}
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
        <Link href="/" className="font-semibold">
          Sistema de Pedidos
        </Link>

        {user ? (
          <div className="contents text-sm sm:flex sm:items-center sm:gap-4">
            <div className="order-last flex basis-full flex-wrap gap-x-4 gap-y-1 sm:order-none sm:basis-auto">
              {hasPermission(user.role, "order:create") ? (
                <Link href="/pedidos/novo" className="text-emerald-700 hover:underline">
                  Montar pedido
                </Link>
              ) : null}
              {hasPermission(user.role, "order:read:own") ? (
                <Link href="/pedidos" className="text-emerald-700 hover:underline">
                  {hasPermission(user.role, "order:read:all") ? "Pedidos" : "Meus pedidos"}
                </Link>
              ) : null}
              {hasPermission(user.role, "admin:access") ? (
                <Link href="/admin" className="text-emerald-700 hover:underline">
                  Painel administrativo
                </Link>
              ) : null}
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <span data-testid="user-name" className="hidden max-w-48 truncate sm:inline">
                {user.name}
              </span>
              <span
                data-testid="user-role"
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold"
              >
                {ROLE_LABEL[user.role]}
              </span>
              <form action={logoutAction}>
                <button type="submit" className="py-1 text-slate-600 hover:underline">
                  Sair
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </nav>
    </header>
  );
}

export async function SiteHeader() {
  return <SiteHeaderView user={await getCurrentUser()} />;
}
