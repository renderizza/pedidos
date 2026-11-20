import type { ReactNode } from "react";
import { formatCents } from "@/lib/money";
import { ProductImage } from "./product-image";

export type CatalogProduct = {
  id: string;
  reference: string;
  description: string;
  priceCents: number;
  categoryName: string | null;
  /** Endereço da imagem (opcional). Sem ele, o cartão não reserva espaço de imagem. */
  imageUrl?: string | null;
};

/** Cartão da vitrine. `action` é o espaço do botão de pedir (ou do convite ao login). */
export function ProductCard({ product, action }: { product: CatalogProduct; action?: ReactNode }) {
  return (
    <li data-testid="product-card" className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4">
      <div>
        {/* Decorativa (alt vazio): o título logo abaixo já descreve o produto. Largura 400px: o cartão tem no máximo ~330px; o dobro (2x) é pedido para telas de alta densidade. */}
        <ProductImage url={product.imageUrl} width={400} className="mb-3 aspect-[4/3] w-full rounded-md" />
        <p className="font-mono text-xs text-slate-500">{product.reference}</p>
        <h2 className="mt-1 text-base font-semibold">{product.description}</h2>
        {product.categoryName ? (
          <p className="mt-1 text-xs text-slate-500">{product.categoryName}</p>
        ) : null}
      </div>
      <div className="mt-4">
        <p className="text-lg font-bold tabular-nums">{formatCents(product.priceCents)}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </li>
  );
}
