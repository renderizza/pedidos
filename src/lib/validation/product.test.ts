import { describe, expect, it } from "vitest";
import { productFormSchema, productInputSchema, productReferenceSchema } from "./product";

const DRIVE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

const valid = {
  reference: "ab-123",
  description: "Camiseta básica algodão",
  priceCents: 4990,
  categoryId: "3f0c1b3e-8c3b-4f4e-9a57-0a5d0f6f1c11",
};

describe("productInputSchema", () => {
  it("aceita um produto válido e normaliza a referência para maiúsculas", () => {
    const result = productInputSchema.parse(valid);
    expect(result.reference).toBe("AB-123");
    expect(result.active).toBe(true);
  });

  it("categoria é opcional e vira null", () => {
    const { categoryId: _c, ...semCategoria } = valid;
    expect(productInputSchema.parse(semCategoria).categoryId).toBeNull();
    expect(productInputSchema.parse({ ...valid, categoryId: null }).categoryId).toBeNull();
  });

  it("exige Referência, Descrição e Preço (campos obrigatórios)", () => {
    const result = productInputSchema.safeParse({});
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["reference", "description", "priceCents"]));
  });

  it.each([0, -1, 10.5, Number.NaN, 2_147_483_648, "100"])("rejeita preço %j", (priceCents) => {
    expect(productInputSchema.safeParse({ ...valid, priceCents }).success).toBe(false);
  });

  it("aceita o menor e o maior preço válidos", () => {
    expect(productInputSchema.safeParse({ ...valid, priceCents: 1 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...valid, priceCents: 2_147_483_647 }).success).toBe(true);
  });

  it("rejeita descrição curta, vazia ou longa demais", () => {
    expect(productInputSchema.safeParse({ ...valid, description: "ab" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...valid, description: "   " }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...valid, description: "x".repeat(501) }).success).toBe(false);
  });

  it("rejeita categoryId que não é UUID", () => {
    expect(productInputSchema.safeParse({ ...valid, categoryId: "123" }).success).toBe(false);
  });

  describe("imageUrl (opcional)", () => {
    it("ausente, nula ou vazia vira null", () => {
      expect(productInputSchema.parse(valid).imageUrl).toBeNull();
      expect(productInputSchema.parse({ ...valid, imageUrl: null }).imageUrl).toBeNull();
      expect(productInputSchema.parse({ ...valid, imageUrl: "" }).imageUrl).toBeNull();
      expect(productInputSchema.parse({ ...valid, imageUrl: "   " }).imageUrl).toBeNull();
    });

    it("converte o link de compartilhamento do Drive no endereço direto da imagem", () => {
      const result = productInputSchema.parse({
        ...valid,
        imageUrl: ` https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing `,
      });
      expect(result.imageUrl).toBe(`https://lh3.googleusercontent.com/d/${DRIVE_ID}`);
    });

    it("aceita endereço https de outro site", () => {
      expect(productInputSchema.parse({ ...valid, imageUrl: "https://exemplo.com/a.jpg" }).imageUrl).toBe(
        "https://exemplo.com/a.jpg",
      );
    });

    it.each([
      ["http", "http://exemplo.com/a.jpg", "https://"],
      ["javascript:", "javascript:alert(1)", "https://"],
      ["texto solto", "foto azul", "inválido"],
      ["pasta do Drive", "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz", "pasta"],
    ])("rejeita %s, com mensagem que explica o problema", (_label, imageUrl, fragment) => {
      const result = productInputSchema.safeParse({ ...valid, imageUrl });
      expect(result.success).toBe(false);
      const issue = result.error?.issues.find((i) => i.path[0] === "imageUrl");
      expect(issue?.message).toContain(fragment);
    });
  });
});

describe("productReferenceSchema", () => {
  it.each(["abc", "A-1", "x.y_z/9", "123"])("aceita %s", (reference) => {
    expect(productReferenceSchema.safeParse(reference).success).toBe(true);
  });

  it.each(["", "  ", "-abc", "a b", "ação", "a;drop", "x".repeat(41)])("rejeita %j", (reference) => {
    expect(productReferenceSchema.safeParse(reference).success).toBe(false);
  });
});

describe("productFormSchema (dados de formulário HTML)", () => {
  const form = {
    reference: " ab-1 ",
    description: "Camiseta básica",
    price: "49,90",
    categoryId: "3f0c1b3e-8c3b-4f4e-9a57-0a5d0f6f1c11",
    active: "on",
  };

  it("converte preço em centavos, normaliza a referência e lê o checkbox", () => {
    expect(productFormSchema.parse(form)).toEqual({
      reference: "AB-1",
      description: "Camiseta básica",
      priceCents: 4990,
      imageUrl: null,
      categoryId: "3f0c1b3e-8c3b-4f4e-9a57-0a5d0f6f1c11",
      active: true,
    });
  });

  it("imagem: campo vazio vira null e o link do Drive vira o endereço direto", () => {
    expect(productFormSchema.parse({ ...form, imageUrl: "" }).imageUrl).toBeNull();
    expect(productFormSchema.parse({ ...form, imageUrl: `https://drive.google.com/open?id=${DRIVE_ID}` }).imageUrl).toBe(
      `https://lh3.googleusercontent.com/d/${DRIVE_ID}`,
    );
  });

  it("imagem inválida é reportada no campo 'imageUrl' (junto dos demais erros)", () => {
    const result = productFormSchema.safeParse({ ...form, reference: "", imageUrl: "http://exemplo.com/a.jpg" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["reference", "imageUrl"]));
  });

  it("checkbox ausente significa inativo; categoria vazia vira null", () => {
    const { active: _active, ...semAtivo } = form;
    const result = productFormSchema.parse({ ...semAtivo, categoryId: "" });
    expect(result.active).toBe(false);
    expect(result.categoryId).toBeNull();
  });

  it("o resultado também satisfaz o schema de domínio", () => {
    expect(productInputSchema.safeParse(productFormSchema.parse(form)).success).toBe(true);
  });

  it("reporta erros nos nomes dos campos do formulário (price, não priceCents)", () => {
    const result = productFormSchema.safeParse({ reference: "", description: "", price: "abc", categoryId: "xyz" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["reference", "description", "price", "categoryId"]));
  });
});
