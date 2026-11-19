import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guards";
import { countAllOrders } from "@/lib/orders/history";
import { getRevenueMetrics } from "@/lib/orders/revenue";
import { getCatalogStats } from "@/lib/products/service";
import { RevenueSection } from "./revenue-section";

export const metadata: Metadata = { title: "Painel administrativo — Sistema de Pedidos" };

export default async function AdminPage() {
  const user = await requirePermission("admin:access");
  const [stats, orderCount, revenue] = await Promise.all([getCatalogStats(), countAllOrders(), getRevenueMetrics()]);

  const cards = [
    { id: "categories", label: "Categorias", value: stats.categories, href: "/admin/categorias" },
    { id: "products", label: "Produtos", value: stats.products, href: "/admin/produtos" },
    { id: "active-products", label: "Produtos ativos", value: stats.activeProducts, href: "/admin/produtos?status=ativos" },
    { id: "orders", label: "Pedidos", value: orderCount, href: "/pedidos" },
  ];

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-3xl font-bold">Painel Administrativo</h1>
      <p className="mt-2 text-slate-600">Bem-vindo, {user.name}.</p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <li key={card.id}>
            <Link
              href={card.href}
              data-testid={`stat-${card.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-500"
            >
              <span className="block text-sm text-slate-500">{card.label}</span>
              <span className="text-3xl font-semibold">{card.value}</span>
            </Link>
          </li>
        ))}
      </ul>

      <RevenueSection metrics={revenue} />
    </main>
  );
}
