/**
 * Rascunho do pedido de quem NÃO tem cadastro: fica só neste navegador (localStorage), porque
 * não existe usuário para guardá-lo no banco. Guarda só produto + quantidade (o preço mostrado
 * vem sempre do cadastro atual) e usa os mesmos limites do rascunho do banco.
 *
 * Tudo aqui é tolerante a falhas: armazenamento bloqueado (modo privado, política do navegador),
 * JSON corrompido ou adulterado são tratados como "carrinho vazio", nunca como erro.
 */
import { uuidSchema } from "@/lib/validation/common";
import { draftItemsSchema, MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS } from "@/lib/validation/order";

export const GUEST_CART_KEY = "pedidos:carrinho:v1";
/** Disparado na própria aba sempre que o carrinho muda (o evento nativo "storage" só chega às OUTRAS abas). */
export const GUEST_CART_EVENT = "pedidos:carrinho:mudou";

export type GuestCartItem = { productId: string; quantity: number };
export type GuestAddResult = { ok: true; quantity: number } | { ok: false; error: string };

const STORAGE_ERROR = "Não foi possível guardar o pedido neste navegador.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // acessar localStorage pode lançar erro (cookies/site data bloqueados)
  }
}

/** Itens guardados. Qualquer coisa fora do formato esperado vale como carrinho vazio. */
export function readGuestCart(): GuestCartItem[] {
  try {
    const raw = storage()?.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed = draftItemsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Substitui o carrinho. Lista vazia apaga a chave. Devolve `false` se o navegador não deixou gravar. */
export function writeGuestCart(items: readonly GuestCartItem[]): boolean {
  try {
    const store = storage();
    if (!store) return false;
    if (items.length === 0) store.removeItem(GUEST_CART_KEY);
    else store.setItem(GUEST_CART_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(GUEST_CART_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Há algum produto no pedido guardado? */
export function guestCartHasItems(): boolean {
  return readGuestCart().length > 0;
}

/**
 * Avisa quando o carrinho muda, nesta aba (GUEST_CART_EVENT) ou em outra (evento "storage").
 * Compatível com `useSyncExternalStore`: devolve a função que cancela a inscrição.
 */
export function subscribeToGuestCart(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GUEST_CART_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(GUEST_CART_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function clearGuestCart(): void {
  writeGuestCart([]);
}

/** Soma 1 unidade do produto (cria a linha se ainda não existir), respeitando os limites do pedido. */
export function addToGuestCart(productId: string): GuestAddResult {
  if (!uuidSchema.safeParse(productId).success) return { ok: false, error: "Produto inválido." };

  const items = readGuestCart();
  const existing = items.find((item) => item.productId === productId);
  let quantity: number;
  let next: GuestCartItem[];

  if (existing) {
    if (existing.quantity >= MAX_ITEM_QUANTITY) {
      return { ok: false, error: `A quantidade máxima por produto é ${MAX_ITEM_QUANTITY}` };
    }
    quantity = existing.quantity + 1;
    next = items.map((item) => (item === existing ? { ...item, quantity } : item));
  } else {
    if (items.length >= MAX_ORDER_ITEMS) {
      return { ok: false, error: `O pedido pode ter no máximo ${MAX_ORDER_ITEMS} produtos` };
    }
    quantity = 1;
    next = [...items, { productId, quantity }];
  }

  return writeGuestCart(next) ? { ok: true, quantity } : { ok: false, error: STORAGE_ERROR };
}
