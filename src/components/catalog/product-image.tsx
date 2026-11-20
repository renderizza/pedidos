"use client";

import { useState } from "react";
import { imageSources } from "@/lib/images/image-url";

/**
 * Imagem de produto. É um <img> comum (e não `next/image`) de propósito: as imagens vêm do Google Drive,
 * que já devolve miniaturas redimensionadas (`=w400`), então o otimizador do Next só acrescentaria uma
 * viagem do servidor ao Google (e, vinda sempre do mesmo IP, a cota do Drive estouraria mais fácil).
 *
 * Cuidados para a imagem aparecer de forma confiável:
 *  - `referrerPolicy="no-referrer"`: o Google recusa algumas requisições conforme o site de origem;
 *  - `loading="lazy"` + caixa de proporção fixa: a lista não "pula" quando as imagens chegam;
 *  - se a miniatura falhar, tenta o endereço puro; se tudo falhar (arquivo não público, apagado, cota),
 *    mostra um espaço reservado em vez do ícone de imagem quebrada;
 *  - o erro pode acontecer ANTES de o React hidratar a página (o evento se perde): o `ref` confere isso.
 */
export function ProductImage({
  url,
  alt = "",
  width,
  className = "",
  onFailure = "placeholder",
}: {
  url: string | null | undefined;
  /** Vazio (padrão) para imagem decorativa, quando o texto ao lado já descreve o produto. */
  alt?: string;
  /** Largura, em pixels CSS, com que a imagem aparece. Telas 2x pedem o dobro automaticamente. */
  width: number;
  /** Tamanho e forma da caixa (ex.: `aspect-[4/3] w-full rounded-md`). */
  className?: string;
  /** Se a imagem não carregar: "placeholder" (caixa cinza com ícone) ou "hidden" (some). */
  onFailure?: "placeholder" | "hidden";
}) {
  // Quantas tentativas já falharam PARA ESTA url (trocar a url recomeça sozinho, sem efeito).
  const [failures, setFailures] = useState<{ url: string; count: number }>();

  const sources = imageSources(url, width);
  if (!sources) return null; // sem imagem (ou endereço inválido): nada a mostrar

  const count = failures && failures.url === url ? failures.count : 0;
  const current = sources.candidates[count];

  if (!current) {
    if (onFailure === "hidden") return null;
    return (
      <div
        data-testid="product-image-fallback"
        aria-hidden="true"
        className={`flex items-center justify-center overflow-hidden bg-slate-100 text-slate-300 ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-1/3 max-h-10 w-1/3 max-w-10">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }

  const fail = () => setFailures({ url: url ?? "", count: count + 1 });

  return (
    <div data-testid="product-image" className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <img
        key={current.src}
        ref={(img) => {
          // Falhou antes de o React ligar o onError (página renderizada no servidor): `complete` sem largura = quebrada.
          if (img?.complete && img.naturalWidth === 0) fail();
        }}
        src={current.src}
        srcSet={current.srcSet}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={fail}
        className="absolute inset-0 h-full w-full object-contain"
      />
    </div>
  );
}
