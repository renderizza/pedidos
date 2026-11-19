import { describe, expect, it } from "vitest";
import {
  createOrderInputSchema,
  draftItemsSchema,
  finalizeOrderSchema,
  orderItemInputSchema,
  orderStatusSchema,
  phoneSchema,
} from "./order";

const p1 = "3f0c1b3e-8c3b-4f4e-9a57-0a5d0f6f1c11";
const p2 = "0b9c7e0a-52c1-4b0f-8f4e-6d8a1d2f9a77";

const valid = {
  customerName: "João da Loja",
  customerPhone: "(11) 98888-7777",
  notes: "Entregar pela manhã",
  items: [
    { productId: p1, quantity: 2 },
    { productId: p2, quantity: 1 },
  ],
};

describe("createOrderInputSchema", () => {
  it("aceita um pedido válido e deixa só os dígitos do telefone", () => {
    const result = createOrderInputSchema.parse(valid);
    expect(result.customerPhone).toBe("11988887777");
    expect(result.items).toHaveLength(2);
  });

  it("telefone e observações são opcionais (viram null)", () => {
    const result = createOrderInputSchema.parse({ customerName: "João", items: valid.items });
    expect(result.customerPhone).toBeNull();
    expect(result.notes).toBeNull();
    const empty = createOrderInputSchema.parse({ customerName: "João", customerPhone: "", notes: "  ", items: valid.items });
    expect(empty.customerPhone).toBeNull();
    expect(empty.notes).toBeNull();
  });

  it("rejeita pedido sem itens", () => {
    const result = createOrderInputSchema.safeParse({ ...valid, items: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("O pedido deve ter ao menos um item");
  });

  it("rejeita o mesmo produto em duas linhas", () => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      items: [
        { productId: p1, quantity: 1 },
        { productId: p1, quantity: 2 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/mais de uma linha/);
  });

  it("rejeita mais de 200 itens", () => {
    const items = Array.from({ length: 201 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      quantity: 1,
    }));
    expect(createOrderInputSchema.safeParse({ ...valid, items }).success).toBe(false);
  });

  it("não aceita preço vindo do cliente: o campo é descartado", () => {
    const result = createOrderInputSchema.parse({
      ...valid,
      items: [{ productId: p1, quantity: 1, unitPriceCents: 1 }],
    });
    expect(result.items[0]).toEqual({ productId: p1, quantity: 1 });
  });

  it("rejeita nome do cliente vazio", () => {
    expect(createOrderInputSchema.safeParse({ ...valid, customerName: " " }).success).toBe(false);
  });

  it("rejeita observações com mais de 500 caracteres", () => {
    expect(createOrderInputSchema.safeParse({ ...valid, notes: "x".repeat(501) }).success).toBe(false);
  });
});

describe("orderItemInputSchema", () => {
  it.each([0, -3, 1.5, 10_000, Number.NaN, "2"])("rejeita quantidade %j", (quantity) => {
    expect(orderItemInputSchema.safeParse({ productId: p1, quantity }).success).toBe(false);
  });

  it.each([1, 9999])("aceita quantidade %i", (quantity) => {
    expect(orderItemInputSchema.safeParse({ productId: p1, quantity }).success).toBe(true);
  });

  it("rejeita productId que não é UUID", () => {
    expect(orderItemInputSchema.safeParse({ productId: "abc", quantity: 1 }).success).toBe(false);
  });
});

describe("phoneSchema", () => {
  it.each(["11988887777", "(11) 98888-7777", "+55 11 98888-7777", "1133334444"])("aceita %s", (phone) => {
    expect(phoneSchema.safeParse(phone).success).toBe(true);
  });

  it.each(["123", "abc", "119888877770000"])("rejeita %s", (phone) => {
    expect(phoneSchema.safeParse(phone).success).toBe(false);
  });
});

describe("orderStatusSchema", () => {
  it.each(["PENDENTE", "CONFIRMADO", "CANCELADO"])("aceita %s", (status) => {
    expect(orderStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejeita status desconhecido", () => {
    expect(orderStatusSchema.safeParse("ENVIADO").success).toBe(false);
  });
});

describe("draftItemsSchema", () => {
  it("aceita lista vazia (rascunho sem produtos) e linhas válidas", () => {
    expect(draftItemsSchema.parse([])).toEqual([]);
    expect(
      draftItemsSchema.parse([
        { productId: p1, quantity: 2 },
        { productId: p2, quantity: 9999 },
      ]),
    ).toHaveLength(2);
  });

  it("rejeita produto repetido, quantidade fora de 1–9999 e mais de 200 linhas", () => {
    expect(
      draftItemsSchema.safeParse([
        { productId: p1, quantity: 1 },
        { productId: p1, quantity: 1 },
      ]).success,
    ).toBe(false);
    expect(draftItemsSchema.safeParse([{ productId: p1, quantity: 0 }]).success).toBe(false);
    expect(draftItemsSchema.safeParse([{ productId: p1, quantity: 10_000 }]).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      quantity: 1,
    }));
    expect(draftItemsSchema.safeParse(many).success).toBe(false);
  });

  it("descarta qualquer preço enviado junto (o servidor nunca confia no valor do cliente)", () => {
    const [item] = draftItemsSchema.parse([{ productId: p1, quantity: 1, priceCents: 1, unitPriceCents: 1 }]);
    expect(item).toEqual({ productId: p1, quantity: 1 });
  });

  it("não aceita algo que não seja lista", () => {
    for (const bad of [null, undefined, "x", {}, 5]) expect(draftItemsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("finalizeOrderSchema", () => {
  const valid = { customerName: "João da Loja", customerPhone: "(11) 98888-7777", notes: "Entregar cedo", expectedTotalCents: 5970 };

  it("aceita e normaliza (telefone só com dígitos, textos aparados)", () => {
    expect(finalizeOrderSchema.parse({ ...valid, customerName: "  João da Loja  " })).toEqual({
      customerName: "João da Loja",
      customerPhone: "11988887777",
      notes: "Entregar cedo",
      expectedTotalCents: 5970,
    });
  });

  it("telefone e observações vazios viram null (campos do formulário chegam como texto)", () => {
    const result = finalizeOrderSchema.parse({ customerName: "João", customerPhone: "", notes: "", expectedTotalCents: 0 });
    expect(result.customerPhone).toBeNull();
    expect(result.notes).toBeNull();
  });

  it("nome do cliente é obrigatório", () => {
    for (const customerName of ["", "   ", "A"]) {
      expect(finalizeOrderSchema.safeParse({ ...valid, customerName }).success).toBe(false);
    }
    expect(finalizeOrderSchema.safeParse({ ...valid, customerName: "" }).error?.issues[0].message).toBe(
      "Nome do cliente é obrigatório",
    );
  });

  it("rejeita telefone inválido e observações longas demais", () => {
    expect(finalizeOrderSchema.safeParse({ ...valid, customerPhone: "123" }).success).toBe(false);
    expect(finalizeOrderSchema.safeParse({ ...valid, notes: "x".repeat(501) }).success).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, "100", null, undefined])("rejeita total esperado %j", (expectedTotalCents) => {
    expect(finalizeOrderSchema.safeParse({ ...valid, expectedTotalCents }).success).toBe(false);
  });

  it("descarta campos extras (ex.: itens ou userId enviados pelo cliente)", () => {
    const result = finalizeOrderSchema.parse({ ...valid, userId: "outro", items: [{ productId: "x", quantity: 1 }] });
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("items");
  });
});
