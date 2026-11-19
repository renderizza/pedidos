import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it.each(["/", "/admin", "/admin/produtos?page=2", "/pedidos#topo"])("mantém o caminho interno %s", (path) => {
    expect(safeRedirectPath(path, "/fallback")).toBe(path);
  });

  it.each([
    "https://evil.com",
    "http://evil.com/admin",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "admin",
    "",
    "/ok\nHeader: injetado",
    null,
    undefined,
    42,
    ["/admin"],
  ])("usa o fallback para %j", (candidate) => {
    expect(safeRedirectPath(candidate, "/fallback")).toBe("/fallback");
  });

  it("o fallback padrão é /", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
  });
});
