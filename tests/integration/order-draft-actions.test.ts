import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addToDraftAction, saveDraftAction } from "@/app/pedidos/novo/actions";
import { closeDb } from "@/db";
import { SESSION_COOKIE } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/roles";
import { getDraft } from "@/lib/orders/draft";
import { insertProduct } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";
import { cookieJar, resetNextMocks, revalidatedPaths } from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("../setup/next-mocks")).nextCacheMock);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function loginAs(role: UserRole) {
  const session = await createUserWithSession(role);
  cookieJar.set(SESSION_COOKIE, session.token);
  return session.user;
}

const refsOf = async (userId: string) => (await getDraft(userId)).lines.map((l) => [l.reference, l.quantity]);

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("autorização", () => {
  it("visitante é redirecionado ao login e nada é gravado", async () => {
    const product = await insertProduct({ reference: "A" });
    await expect(saveDraftAction([{ productId: product.id, quantity: 1 }])).rejects.toMatchObject({ url: "/login" });
    await expect(addToDraftAction(product.id)).rejects.toMatchObject({ url: "/login" });
    expect(revalidatedPaths).toEqual([]);
  });

  it.each(["ADMIN", "CONSULTOR", "CLIENTE"] as const)("%s pode montar o próprio rascunho", async (role) => {
    const user = await loginAs(role);
    const product = await insertProduct({ reference: `P-${role}` });

    await expect(saveDraftAction([{ productId: product.id, quantity: 2 }])).resolves.toEqual({ ok: true });
    expect(await refsOf(user.id)).toEqual([[`P-${role}`, 2]]);

    await expect(addToDraftAction(product.id)).resolves.toEqual({ ok: true, quantity: 3 });
  });
});

describe("saveDraftAction", () => {
  it("o dono do rascunho é SEMPRE o usuário da sessão (um userId forjado no corpo é ignorado)", async () => {
    const me = await loginAs("CONSULTOR");
    const victim = (await createUserWithSession("CLIENTE")).user;
    const product = await insertProduct({ reference: "A" });

    const forged = [{ productId: product.id, quantity: 5, userId: victim.id }];
    await expect(saveDraftAction(forged)).resolves.toEqual({ ok: true });

    expect(await refsOf(me.id)).toEqual([["A", 5]]);
    expect(await refsOf(victim.id)).toEqual([]);
  });

  it("substitui o rascunho e lista vazia o apaga", async () => {
    const user = await loginAs("CLIENTE");
    const a = await insertProduct({ reference: "A" });
    const b = await insertProduct({ reference: "B" });
    await saveDraftAction([{ productId: a.id, quantity: 1 }]);
    await saveDraftAction([{ productId: b.id, quantity: 2 }]);
    expect(await refsOf(user.id)).toEqual([["B", 2]]);

    await expect(saveDraftAction([])).resolves.toEqual({ ok: true });
    expect(await refsOf(user.id)).toEqual([]);
  });

  it.each([
    ["quantidade zero", (id: string) => [{ productId: id, quantity: 0 }], "Quantidade deve ser ao menos 1"],
    ["quantidade acima do limite", (id: string) => [{ productId: id, quantity: 10_000 }], "no máximo 9999"],
    ["produto repetido", (id: string) => [{ productId: id, quantity: 1 }, { productId: id, quantity: 1 }], "mais de uma linha"],
    ["productId inválido", () => [{ productId: "xyz", quantity: 1 }], "Identificador inválido"],
  ])("%s: devolve erro legível (sem lançar) e preserva o rascunho", async (_label, build, fragment) => {
    const user = await loginAs("CLIENTE");
    const product = await insertProduct({ reference: "A" });
    await saveDraftAction([{ productId: product.id, quantity: 3 }]);

    const result = await saveDraftAction(build(product.id));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(fragment);
    expect(await refsOf(user.id)).toEqual([["A", 3]]);
  });

  it.each([null, undefined, "texto", 42, { productId: "x" }])("payload %j que não é lista devolve erro", async (payload) => {
    await loginAs("CLIENTE");
    expect((await saveDraftAction(payload)).ok).toBe(false);
  });

  it("produto desativado ou inexistente: erro com mensagem clara", async () => {
    await loginAs("CLIENTE");
    const off = await insertProduct({ reference: "OFF", active: false });
    const inactive = await saveDraftAction([{ productId: off.id, quantity: 1 }]);
    expect(inactive).toEqual({ ok: false, error: "Um dos produtos não está mais disponível" });

    const missing = await saveDraftAction([{ productId: MISSING_ID, quantity: 1 }]);
    expect(missing.ok).toBe(false);
  });

  it("não revalida páginas (o estado da tabela está no cliente)", async () => {
    await loginAs("CLIENTE");
    const a = await insertProduct({ reference: "A" });
    await saveDraftAction([{ productId: a.id, quantity: 1 }]);
    expect(revalidatedPaths).toEqual([]);
  });
});

describe("addToDraftAction", () => {
  it("soma 1 a cada chamada e revalida a tabela de pedido", async () => {
    const user = await loginAs("CONSULTOR");
    const a = await insertProduct({ reference: "A" });

    expect(await addToDraftAction(a.id)).toEqual({ ok: true, quantity: 1 });
    expect(await addToDraftAction(a.id)).toEqual({ ok: true, quantity: 2 });

    expect(await refsOf(user.id)).toEqual([["A", 2]]);
    expect(revalidatedPaths).toEqual(["/pedidos/novo", "/pedidos/novo"]);
  });

  it("devolve erro (sem lançar) para produto desativado, inexistente ou id malformado", async () => {
    await loginAs("CLIENTE");
    const off = await insertProduct({ reference: "OFF", active: false });
    for (const id of [off.id, MISSING_ID, "xyz"]) {
      const result = await addToDraftAction(id);
      expect(result).toEqual({ ok: false, error: "Um dos produtos não está mais disponível" });
    }
  });

  it("devolve erro ao passar da quantidade máxima", async () => {
    const user = await loginAs("CLIENTE");
    const a = await insertProduct({ reference: "A" });
    await saveDraftAction([{ productId: a.id, quantity: 9999 }]);
    const result = await addToDraftAction(a.id);
    expect(result).toEqual({ ok: false, error: "A quantidade máxima por produto é 9999" });
    expect(await refsOf(user.id)).toEqual([["A", 9999]]);
  });
});
