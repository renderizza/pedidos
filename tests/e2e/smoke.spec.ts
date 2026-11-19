import { expect, test } from "@playwright/test";

test.describe("infraestrutura (Fase 1)", () => {
  test("a página inicial carrega com o título e o Tailwind aplicado", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Sistema de Pedidos");
    await expect(page.getByRole("heading", { level: 1, name: "Vitrine de produtos" })).toBeVisible();

    // `flex` só vira display:flex se o Tailwind foi compilado e carregado.
    const display = await page.getByTestId("home-header").evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("flex");
  });

  test("a API de health confirma a conexão com o banco", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", database: "up" });
  });

  test("rota inexistente devolve 404", async ({ page }) => {
    const response = await page.goto("/rota-que-nao-existe");
    expect(response?.status()).toBe(404);
  });
});
