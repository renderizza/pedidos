import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS } from "@/lib/validation/order";
import {
  addToGuestCart,
  clearGuestCart,
  GUEST_CART_KEY,
  guestCartHasItems,
  readGuestCart,
  subscribeToGuestCart,
  writeGuestCart,
} from "./guest-cart";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("readGuestCart / writeGuestCart", () => {
  it("começa vazio", () => {
    expect(readGuestCart()).toEqual([]);
  });

  it("guarda e devolve os itens, na mesma ordem", () => {
    const items = [{ productId: B, quantity: 2 }, { productId: A, quantity: 5 }];
    expect(writeGuestCart(items)).toBe(true);
    expect(readGuestCart()).toEqual(items);
  });

  it("lista vazia apaga a chave (não deixa lixo no navegador)", () => {
    writeGuestCart([{ productId: A, quantity: 1 }]);
    writeGuestCart([]);
    expect(window.localStorage.getItem(GUEST_CART_KEY)).toBeNull();
  });

  it("clearGuestCart esvazia o carrinho", () => {
    writeGuestCart([{ productId: A, quantity: 1 }]);
    clearGuestCart();
    expect(readGuestCart()).toEqual([]);
  });

  it.each([
    ["JSON corrompido", "{nao-e-json"],
    ["não é lista", JSON.stringify({ productId: A, quantity: 1 })],
    ["id que não é UUID", JSON.stringify([{ productId: "abc", quantity: 1 }])],
    ["quantidade zero", JSON.stringify([{ productId: A, quantity: 0 }])],
    ["quantidade acima do limite", JSON.stringify([{ productId: A, quantity: MAX_ITEM_QUANTITY + 1 }])],
    ["quantidade decimal", JSON.stringify([{ productId: A, quantity: 1.5 }])],
    ["produto repetido", JSON.stringify([{ productId: A, quantity: 1 }, { productId: A, quantity: 2 }])],
  ])("conteúdo inválido (%s) vale como carrinho vazio, sem lançar erro", (_label, raw) => {
    window.localStorage.setItem(GUEST_CART_KEY, raw);
    expect(readGuestCart()).toEqual([]);
  });

  it("armazenamento bloqueado: lê como vazio e write devolve false, sem lançar erro", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readGuestCart()).toEqual([]);
    expect(writeGuestCart([{ productId: A, quantity: 1 }])).toBe(false);
  });
});

describe("addToGuestCart", () => {
  it("cria a linha com 1 unidade e depois soma 1 a cada chamada", () => {
    expect(addToGuestCart(A)).toEqual({ ok: true, quantity: 1 });
    expect(addToGuestCart(A)).toEqual({ ok: true, quantity: 2 });
    expect(addToGuestCart(B)).toEqual({ ok: true, quantity: 1 });
    expect(readGuestCart()).toEqual([{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }]);
  });

  it("recusa id que não é UUID e não grava nada", () => {
    expect(addToGuestCart("abc")).toMatchObject({ ok: false });
    expect(readGuestCart()).toEqual([]);
  });

  it("respeita a quantidade máxima por produto", () => {
    writeGuestCart([{ productId: A, quantity: MAX_ITEM_QUANTITY }]);
    expect(addToGuestCart(A)).toMatchObject({ ok: false, error: expect.stringContaining(String(MAX_ITEM_QUANTITY)) });
    expect(readGuestCart()).toEqual([{ productId: A, quantity: MAX_ITEM_QUANTITY }]);
  });

  it("respeita o máximo de produtos por pedido", () => {
    writeGuestCart(Array.from({ length: MAX_ORDER_ITEMS }, () => ({ productId: crypto.randomUUID(), quantity: 1 })));
    expect(addToGuestCart(A)).toMatchObject({ ok: false, error: expect.stringContaining(String(MAX_ORDER_ITEMS)) });
    expect(readGuestCart()).toHaveLength(MAX_ORDER_ITEMS);
  });

  it("se o navegador não deixa gravar, avisa em vez de fingir que adicionou", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(addToGuestCart(A)).toMatchObject({ ok: false, error: expect.stringContaining("neste navegador") });
  });
});

describe("guestCartHasItems / subscribeToGuestCart", () => {
  it("diz se há algum produto no pedido", () => {
    expect(guestCartHasItems()).toBe(false);
    addToGuestCart(A);
    expect(guestCartHasItems()).toBe(true);
    clearGuestCart();
    expect(guestCartHasItems()).toBe(false);
  });

  it("avisa nesta aba a cada mudança: adicionar, gravar e limpar", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToGuestCart(onChange);

    addToGuestCart(A);
    expect(onChange).toHaveBeenCalledTimes(1);
    writeGuestCart([{ productId: B, quantity: 2 }]);
    expect(onChange).toHaveBeenCalledTimes(2);
    clearGuestCart();
    expect(onChange).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("avisa quando OUTRA aba muda o carrinho (evento nativo 'storage')", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToGuestCart(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: GUEST_CART_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("depois de cancelar a inscrição, não avisa mais", () => {
    const onChange = vi.fn();
    subscribeToGuestCart(onChange)();
    addToGuestCart(A);
    window.dispatchEvent(new StorageEvent("storage"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("não avisa quando o navegador não deixou gravar (nada mudou)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const onChange = vi.fn();
    const unsubscribe = subscribeToGuestCart(onChange);
    addToGuestCart(A);
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });
});
