/**
 * Endereços de imagem de produto, com foco no Google Drive.
 *
 * O link que o Drive entrega em "Compartilhar → Copiar link" (`drive.google.com/file/d/ID/view`) é uma
 * PÁGINA HTML, não a imagem: colocado num <img>, nada aparece. Os formatos antigos de "link direto"
 * (`uc?export=view&id=ID`) redirecionam, sofrem limite de cota e já foram bloqueados em vários casos.
 * O endereço estável para exibir um arquivo público do Drive é `lh3.googleusercontent.com/d/ID`, que
 * ainda aceita um sufixo de tamanho (`=w400`) e devolve uma miniatura leve em vez da foto original.
 *
 * Por isso o cadastro converte QUALQUER formato de link do Drive para esse endereço (`normalizeImageUrl`)
 * e a renderização pede o tamanho certo (`imageSources`). Endereços de outros sites (https) passam como estão.
 *
 * Módulo puro (sem React nem banco): roda no servidor, no navegador e nos testes.
 */

/** Limite da coluna `products.image_url`. */
export const MAX_IMAGE_URL_LENGTH = 2048;

export type ImageUrlResult = { ok: true; url: string } | { ok: false; error: string };

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);
/** lh3 … lh6: servidores de imagem do Google (Drive e Fotos). */
const GOOGLE_IMAGE_HOST = /^lh\d\.googleusercontent\.com$/;
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,}$/;
/** Forma canônica gravada no banco: o ID é o único dado que importa. */
const CANONICAL_DRIVE_URL = /^https:\/\/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})$/;

export const driveImageUrl = (fileId: string) => `https://lh3.googleusercontent.com/d/${fileId}`;

const ERROR_FOLDER =
  "Esse link é de uma pasta do Google Drive. Abra a imagem e copie o link do arquivo (Compartilhar → Copiar link).";
const ERROR_DRIVE_UNKNOWN =
  "Link do Google Drive não reconhecido. Use o link do arquivo de imagem (Compartilhar → Copiar link), não de documentos ou pastas.";
const ERROR_INVALID = "Endereço de imagem inválido. Cole o link completo, começando com https://";
const ERROR_TOO_LONG = `O endereço da imagem deve ter no máximo ${MAX_IMAGE_URL_LENGTH} caracteres`;

/** Extrai o ID do arquivo dos formatos de link do Drive; `null` quando não há ID. */
function driveFileId(url: URL): string | null {
  const path = url.pathname;
  const fromQuery = url.searchParams.get("id");

  if (url.hostname === "docs.google.com") {
    // Só o link antigo de download (docs.google.com/uc?id=…) aponta para um arquivo; documentos e planilhas não.
    return path === "/uc" ? fromQuery : null;
  }
  // drive.google.com/file/d/ID/view · /file/u/0/d/ID/view · /u/0/file/d/ID/view
  const fromPath = /\/file\/(?:u\/\d+\/)?d\/([^/]+)/.exec(path) ?? /^\/u\/\d+\/file\/d\/([^/]+)/.exec(path);
  if (fromPath) return fromPath[1];
  // drive.google.com/open?id=ID · /uc?id=ID · /thumbnail?id=ID · drive.usercontent.google.com/download?id=ID
  if (/^(?:\/u\/\d+)?\/(?:open|uc|thumbnail|download)$/.test(path)) return fromQuery;
  return null;
}

/**
 * Valida o endereço digitado e devolve a forma que deve ser gravada:
 *  - links do Google Drive (qualquer formato) → `https://lh3.googleusercontent.com/d/ID`;
 *  - qualquer outro endereço https → na forma canônica da URL (sem espaços nas pontas, esquema/host em minúsculas);
 *  - recusa: texto que não é URL, http (bloqueado como "conteúdo misto" em site https), `javascript:`/`data:`,
 *    endereço com usuário/senha, pasta do Drive, link do Drive sem ID, endereço longo demais.
 * É idempotente: normalizar o resultado de uma normalização devolve o mesmo valor.
 */
export function normalizeImageUrl(input: string): ImageUrlResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "Informe o endereço da imagem" };
  if (text.length > MAX_IMAGE_URL_LENGTH) return { ok: false, error: ERROR_TOO_LONG };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: ERROR_INVALID };
  }
  if (url.protocol !== "https:") return { ok: false, error: "O endereço da imagem deve começar com https://" };
  if (url.username || url.password) return { ok: false, error: ERROR_INVALID };

  const host = url.hostname.toLowerCase();

  if (DRIVE_HOSTS.has(host)) {
    if (/\/folders\//.test(url.pathname) || url.pathname.startsWith("/drive/")) return { ok: false, error: ERROR_FOLDER };
    const id = driveFileId(url);
    if (!id || !DRIVE_FILE_ID.test(id)) return { ok: false, error: ERROR_DRIVE_UNKNOWN };
    return { ok: true, url: driveImageUrl(id) };
  }

  if (GOOGLE_IMAGE_HOST.test(host)) {
    // lh3.googleusercontent.com/d/ID, com ou sem sufixo de tamanho (=w400, =s220…): volta à forma canônica.
    const match = /^\/d\/([A-Za-z0-9_-]+)(?:=[^/]*)?$/.exec(url.pathname);
    if (match) {
      if (!DRIVE_FILE_ID.test(match[1])) return { ok: false, error: ERROR_DRIVE_UNKNOWN };
      return { ok: true, url: driveImageUrl(match[1]) };
    }
    // Outros caminhos (ex.: imagens do Google Fotos) já são links diretos: seguem como estão.
  }

  // Forma canônica da URL (esquema e host em minúsculas, espaços codificados): é o que a constraint do banco espera.
  const href = url.href;
  if (href.length > MAX_IMAGE_URL_LENGTH) return { ok: false, error: ERROR_TOO_LONG };
  return { ok: true, url: href };
}

export type ImageSources = {
  /** Lista de endereços a tentar, em ordem: a imagem pode falhar com o tamanho pedido e funcionar sem ele. */
  candidates: { src: string; srcSet?: string }[];
};

/**
 * Endereços para o <img> exibir a imagem com `width` pixels de largura CSS (e o dobro para telas 2x).
 * Para o Drive pede miniaturas (`=w400`) em vez da foto original, que pode ter vários MB;
 * se o Google recusar o tamanho, a segunda tentativa usa o endereço puro. `null` = endereço inválido.
 */
export function imageSources(url: string | null | undefined, width: number): ImageSources | null {
  if (!url) return null;
  const result = normalizeImageUrl(url);
  if (!result.ok) return null;

  if (CANONICAL_DRIVE_URL.test(result.url)) {
    const w = Math.max(1, Math.round(width));
    return {
      candidates: [
        { src: `${result.url}=w${w}`, srcSet: `${result.url}=w${w} 1x, ${result.url}=w${w * 2} 2x` },
        { src: result.url },
      ],
    };
  }
  return { candidates: [{ src: result.url }] };
}
