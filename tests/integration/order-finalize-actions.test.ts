import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeOrderAction } from "@/app/pedidos/novo/actions";
import { closeDb, getDb } from "@/db";
import { orders, products } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/roles";
import { getDraft, saveDraft } from "@/lib/orders/draft";
import { getOrderFor } from "@/lib/orders/history";
import { eq } from "drizzle-orm";
import { insertProduct } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";
import { cookieJar, resetNextMocks, revalidatedPaths } from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("../setup/next-mocks")).nextCacheMock);

async function loginAs(role: UserRole) {
  const session = await createUserWithSession(role);
  cookieJar.set(SESSION_COOKIE, session.token);
  return session.user;
}

const input = (overrides: Record<string, unknown> = {}) => ({
  customerName: "João da Loja",
  customerPhone: "(11) 98888-7777",
  notes: "Entregar cedo",
  expectedTotalCents: 3980,
  ...overrides,
});

const orderCount = async () => (await getDb().select().from(orders)).length;

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("finalizeOrderAction", () => {
  it("visitante é redirecionado ao login e nada é gravado", async () => {
    await expect(finalizeOrderAction(input())).rejects.toMatchObject({ url: "/login" });
    expect(await orderCount()).toBe(0);
    expect(revalidatedPaths).toEqual([]);
  });

  it.each(["ADMIN", "CLIENTE"] as const)("%s finaliza o próprio pedido, com os dados do cliente", async (role) => {
    const user = await loginAs(role);
    const product = await insertProduct({ reference: `P-${role}`, priceCents: 1990 });
    await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);

    const result = await finalizeOrderAction(input());

    expect(result).toMatchObject({ ok: true, orderNumber: 1 });
    const saved = await getOrderFor({ id: user.id, role }, result.ok ? result.orderId : "");
    expect(saved).toMatchObject({ userId: user.id, totalCents: 3980, customerName: "João da Loja", customerPhone: "11988887777", notes: "Entregar cedo" });
    expect(revalidatedPaths).toEqual(["/pedidos", "/pedidos/novo"]);
  });

  describe("CONSULTOR: pedido interno, sem cliente e sem WhatsApp", () => {
    async function consultorWithDraft() {
      const user = await loginAs("CONSULTOR");
      const product = await insertProduct({ reference: "P-CONS", priceCents: 1990 });
      await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);
      return user;
    }

    it("finaliza só com o total visto na tela: o pedido é gravado sem nome, telefone e observações", async () => {
      const user = await consultorWithDraft();

      const result = await finalizeOrderAction({ expectedTotalCents: 3980 });

      expect(result).toMatchObject({ ok: true, orderNumber: 1 });
      const saved = await getOrderFor({ id: user.id, role: "CONSULTOR" }, result.ok ? result.orderId : "");
      expect(saved).toMatchObject({
        userId: user.id,
        totalCents: 3980,
        status: "PENDENTE",
        customerName: null,
        customerPhone: null,
        notes: null,
        items: [expect.objectContaining({ reference: "P-CONS", quantity: 2, lineTotalCents: 3980 })],
      });
      expect((await getDraft(user.id)).lines).toHaveLength(0); // rascunho consumido
      expect(revalidatedPaths).toEqual(["/pedidos", "/pedidos/novo"]);
    });

    it("dados de cliente enviados pela requisição são DESCARTADOS (quem decide é o perfil, não o cliente HTTP)", async () => {
      await consultorWithDraft();

      const result = await finalizeOrderAction(input()); // input() traz nome, telefone e observações

      expect(result.ok).toBe(true);
      expect((await getDb().select().from(orders))[0]).toMatchObject({ customerName: null, customerPhone: null, notes: null });
    });

    it("não valida o que não coleta: nome vazio ou telefone inválido não impedem o pedido", async () => {
      await consultorWithDraft();
      const result = await finalizeOrderAction({ customerName: "", customerPhone: "123", expectedTotalCents: 3980 });
      expect(result.ok).toBe(true);
    });

    it("continua conferindo o total que a pessoa viu (preço alterado: recusa e mantém o rascunho)", async () => {
      const user = await consultorWithDraft();
      const result = await finalizeOrderAction({ expectedTotalCents: 100 });
      expect(result).toMatchObject({ ok: false, refresh: true });
      expect(await orderCount()).toBe(0);
      expect((await getDraft(user.id)).lines).toHaveLength(1);
    });

    it("sem o total esperado é erro de validação (nada é gravado)", async () => {
      await consultorWithDraft();
      expect(await finalizeOrderAction({})).toMatchObject({ ok: false, error: "Revise os campos destacados" });
      expect(await orderCount()).toBe(0);
    });
  });

  it("ADMIN também precisa informar o cliente (só o CONSULTOR é dispensado)", async () => {
    const user = await loginAs("ADMIN");
    const product = await insertProduct({ reference: "P-ADM", priceCents: 1990 });
    await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);

    const result = await finalizeOrderAction(input({ customerName: "" }));

    expect(result).toMatchObject({ ok: false, error: "Revise os campos destacados" });
    expect(await orderCount()).toBe(0);
  });

  it("o pedido é do usuário da sessão e o rascunho usado é o dele (userId forjado é ignorado)", async () => {
    const me = await loginAs("CONSULTOR");
    const victim = (await createUserWithSession("CLIENTE")).user;
    const mine = await insertProduct({ reference: "MINE", priceCents: 1990 });
    const theirs = await insertProduct({ reference: "THEIRS", priceCents: 5000 });
    await saveDraft(me.id, [{ productId: mine.id, quantity: 2 }]);
    await saveDraft(victim.id, [{ productId: theirs.id, quantity: 9 }]);

    const result = await finalizeOrderAction(input({ userId: victim.id, items: [{ productId: theirs.id, quantity: 9 }] }));

    expect(result.ok).toBe(true);
    const [order] = await getDb().select().from(orders);
    expect(order.userId).toBe(me.id);
    expect(order.totalCents).toBe(3980); // o item do cliente forjado foi ignorado
    expect((await getDraft(victim.id)).lines).toHaveLength(1); // rascunho da vítima intacto
  });

  it("erros de validação voltam por campo, sem criar pedido e sem apagar o rascunho", async () => {
    const user = await loginAs("CLIENTE");
    const product = await insertProduct({ reference: "P", priceCents: 1990 });
    await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);

    const result = await finalizeOrderAction(input({ customerName: "", customerPhone: "123" }));

    expect(result).toMatchObject({ ok: false, error: "Revise os campos destacados" });
    expect(!result.ok && result.fieldErrors).toMatchObject({
      customerName: ["Nome do cliente é obrigatório"],
      customerPhone: ["Telefone inválido (informe DDD + número)"],
    });
    expect(await orderCount()).toBe(0);
    expect((await getDraft(user.id)).lines).toHaveLength(1);
    expect(revalidatedPaths).toEqual([]);
  });

  it.each([null, undefined, "texto", 42, []])("payload %j inválido devolve erro de validação (sem lançar)", async (payload) => {
    await loginAs("CLIENTE");
    const result = await finalizeOrderAction(payload);
    expect(result.ok).toBe(false);
  });

  it("sem itens: mensagem clara", async () => {
    await loginAs("CLIENTE");
    expect(await finalizeOrderAction(input())).toEqual({ ok: false, error: "Não há itens no pedido para finalizar" });
  });

  it("preço alterado: recusa, pede para atualizar a tela (refresh) e mantém o rascunho", async () => {
    const user = await loginAs("CONSULTOR");
    const product = await insertProduct({ reference: "P", priceCents: 1990 });
    await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);
    await getDb().update(products).set({ priceCents: 2000 }).where(eq(products.id, product.id));

    const result = await finalizeOrderAction(input({ expectedTotalCents: 3980 }));

    expect(result).toMatchObject({ ok: false, refresh: true });
    expect(!result.ok && result.error).toContain("Os preços mudaram");
    expect(await orderCount()).toBe(0);
    expect((await getDraft(user.id)).lines).toHaveLength(1);
  });

  it("produto desativado: recusa e pede para atualizar a tela (refresh)", async () => {
    const user = await loginAs("CONSULTOR");
    const product = await insertProduct({ reference: "P", priceCents: 1990 });
    await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);
    await getDb().update(products).set({ active: false }).where(eq(products.id, product.id));

    const result = await finalizeOrderAction(input());
    expect(result).toMatchObject({ ok: false, refresh: true });
    expect(!result.ok && result.error).toContain("não estão mais disponíveis");
  });

  it("total acima do limite: erro sem refresh", async () => {
    const user = await loginAs("CONSULTOR");
    const caro = await insertProduct({ reference: "CARO", priceCents: 100_000_000 });
    await saveDraft(user.id, [{ productId: caro.id, quantity: 30 }]);
    const result = await finalizeOrderAction(input({ expectedTotalCents: 3_000_000_000 }));
    expect(result).toEqual({ ok: false, error: "O valor total do pedido excede o limite permitido" });
  });

  it("duas chamadas simultâneas (duplo clique): um pedido criado, a outra recebe erro amigável", async () => {
    const user = await loginAs("CONSULTOR");
    const product = await insertProduct({ reference: "P", priceCents: 1990 });
    await saveDraft(user.id, [{ productId: product.id, quantity: 2 }]);

    const results = await Promise.all([finalizeOrderAction(input()), finalizeOrderAction(input()), finalizeOrderAction(input())]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === "Não há itens no pedido para finalizar")).toBe(true);
    expect(await orderCount()).toBe(1);
  });
});
