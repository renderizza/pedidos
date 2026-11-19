import { describe, expect, it } from "vitest";
import { escapeLike } from "./sql";

describe("escapeLike", () => {
  it("escapa os curingas do LIKE", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });

  it("não altera texto comum", () => {
    expect(escapeLike("camiseta azul")).toBe("camiseta azul");
    expect(escapeLike("")).toBe("");
  });
});
