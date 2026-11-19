import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Visão geral" },
  { href: "/admin/categorias", label: "Categorias" },
  { href: "/admin/produtos", label: "Produtos" },
  { href: "/pedidos", label: "Pedidos" },
] as const;

/** Navegação estática do painel; a proteção de acesso fica em cada página e ação. */
export function AdminNav() {
  return (
    <nav aria-label="Administração" className="border-b border-slate-200 bg-slate-100">
      <ul className="mx-auto flex max-w-5xl flex-wrap gap-x-5 gap-y-1 px-4 py-2 text-sm sm:gap-x-6 sm:px-8">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="inline-block py-1 font-medium text-slate-700 hover:text-emerald-700 hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
