import { describe, expect, it } from "vitest";
import { fieldErrors, priceInputSchema, requiredText } from "./common";

describe("priceInputSchema", () => {
  it.each([
    ["12,50", 1250],
    ["1.234,56", 123456],
    ["R$ 0,01", 1],
    ["21474836,47", 2_147_483_647],
  ])("%j → %i centavos", (input, cents) => {
    expect(priceInputSchema.parse(input)).toBe(cents);
  });

  it("rejeita texto inválido com mensagem de formato", () => {
    const result = priceInputSchema.safeParse("doze");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Preço inválido. Use o formato 12,50");
  });

  it("rejeita vazio, zero e acima do limite do banco", () => {
    expect(priceInputSchema.safeParse("").error?.issues[0].message).toBe("Preço é obrigatório");
    expect(priceInputSchema.safeParse("0,00").error?.issues[0].message).toBe("Preço deve ser maior que zero");
    expect(priceInputSchema.safeParse("21474836,48").error?.issues[0].message).toBe("Preço acima do limite permitido");
  });
});

describe("requiredText", () => {
  it("aparar, validar mínimo e máximo", () => {
    const schema = requiredText("Campo", 2, 5);
    expect(schema.parse("  ab ")).toBe("ab");
    expect(schema.safeParse("a").error?.issues[0].message).toBe("Campo deve ter ao menos 2 caracteres");
    expect(schema.safeParse("abcdef").error?.issues[0].message).toBe("Campo deve ter no máximo 5 caracteres");
    expect(requiredText("Campo", 1, 5).safeParse(" ").error?.issues[0].message).toBe("Campo é obrigatório");
  });

  it("texto vazio mostra só 'é obrigatório' (uma única mensagem), mesmo com mínimo maior que 1", () => {
    const result = requiredText("Campo", 3, 10).safeParse("   ");
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["Campo é obrigatório"]);
  });
});

describe("fieldErrors", () => {
  it("agrupa mensagens por campo", () => {
    const result = requiredText("Nome", 3, 10).safeParse("a");
    expect(fieldErrors(result.error!)).toEqual({ _form: ["Nome deve ter ao menos 3 caracteres"] });
  });
});
