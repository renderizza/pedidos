import { describe, expect, it } from "vitest";
import { categoryInputSchema } from "./category";

describe("categoryInputSchema", () => {
  it("aceita e apara o nome", () => {
    expect(categoryInputSchema.parse({ name: "  Bebidas " })).toEqual({ name: "Bebidas" });
  });

  it.each([{ name: "" }, { name: " " }, { name: "A" }, { name: "x".repeat(61) }, {}])(
    "rejeita %j",
    (input) => {
      expect(categoryInputSchema.safeParse(input).success).toBe(false);
    },
  );

  it("aceita exatamente 60 caracteres", () => {
    expect(categoryInputSchema.safeParse({ name: "x".repeat(60) }).success).toBe(true);
  });
});
