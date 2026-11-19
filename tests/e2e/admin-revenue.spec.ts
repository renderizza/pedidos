/**
 * Métricas de faturamento no painel administrativo (/admin).
 * O banco E2E é compartilhado entre testes em paralelo, então aqui se confere ESTRUTURA e COMPORTAMENTO;
 * os valores exatos (fuso, fronteiras de data, exclusão de cancelados) são provados nos testes de integração.
 */
import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import { createE2eUser, createOrderCatalog, placeOrderFor } from "./e2e-db";
import { login, uniqueId } from "./helpers";

const MONEY = /^R\$\s[\d.]+,\d{2}$/;

/** Garante pelo menos um pedido de hoje no banco E2E, para o painel não cair no estado vazio. */
async function ensureAnOrder() {
  const id = uniqueId();
  const { camiseta } = await createOrderCatalog(`REV${id}`);
  const consultor = await createE2eUser("CONSULTOR", id);
  await placeOrderFor(consultor.id, [{ productId: camiseta.id, priceCents: 1990, quantity: 3 }], { customerName: `Cliente ${id}` });
}

async function openDashboard(page: Page) {
  await ensureAnOrder();
  await login(page, TEST_USERS.admin);
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { level: 2, name: "Faturamento" })).toBeVisible();
}

test.describe("faturamento no painel administrativo", () => {
  test("mostra o mês em destaque, os cartões, o gráfico de 30 dias, os rankings e os pedidos por situação", async ({ page }) => {
    await openDashboard(page);

    // regra de cálculo explicada na tela
    await expect(page.getByText(/pendentes e confirmados; os cancelados ficam de fora/)).toBeVisible();

    // número em destaque + variação + cartões
    await expect(page.getByTestId("kpi-month-value")).toHaveText(MONEY);
    await expect(page.getByTestId("kpi-month-delta")).toContainText(/(▲|▼|■|Sem faturamento)/);
    for (const id of ["today", "week", "total", "ticket"]) {
      await expect(page.getByTestId(`kpi-${id}-value`)).toHaveText(MONEY);
    }
    await expect(page.getByTestId("kpi-today")).toContainText(/\d+ pedidos?/);

    // gráfico: 30 dias, descrição com o total do período
    const chart = page.getByTestId("revenue-chart");
    await expect(chart.getByRole("heading", { name: "Faturamento por dia (últimos 30 dias)" })).toBeVisible();
    await expect(chart.getByTestId("revenue-day")).toHaveCount(30);
    await expect(chart.getByTestId("revenue-bar").first()).toBeVisible(); // pelo menos o pedido de hoje

    // rankings: o pedido que criamos é de um consultor, lançado hoje
    await expect(page.getByRole("heading", { name: "Produtos que mais faturam" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Produtos que mais faturam" }).getByTestId("ranked-row").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Faturamento por origem" }).getByText("Consultores")).toBeVisible();

    // pedidos por situação: as três, e só o cancelado fica fora do faturamento
    const rows = page.getByTestId("revenue-status-table").getByRole("row");
    await expect(rows).toHaveCount(4); // cabeçalho + 3 situações
    await expect(rows.filter({ hasText: "Pendente" })).toContainText("Sim");
    await expect(rows.filter({ hasText: "Confirmado" })).toContainText("Sim");
    await expect(rows.filter({ hasText: "Cancelado" })).toContainText("Não");
  });

  test("o gráfico mostra o dia ao passar o mouse e pelo teclado, e também existe como tabela", async ({ page }) => {
    await openDashboard(page);
    const chart = page.getByTestId("revenue-chart");
    const days = chart.getByTestId("revenue-day");
    const tooltip = chart.getByTestId("revenue-tooltip");

    // mouse: o tooltip traz dia, valor e pedidos
    await expect(tooltip).toHaveCount(0);
    await days.last().hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/\d{2}\/\d{2}/);
    await expect(tooltip).toContainText(/R\$\s[\d.]+,\d{2}/);
    await expect(tooltip).toContainText(/\d+ pedidos?/);
    await page.mouse.move(2, 2);
    await expect(tooltip).toHaveCount(0);

    // teclado: Tab chega ao gráfico (parada em hoje); as setas percorrem os dias e mostram o mesmo tooltip
    await days.last().focus();
    const today = (await tooltip.textContent())!;
    await page.keyboard.press("ArrowLeft");
    await expect(days.nth(28)).toBeFocused();
    expect(await tooltip.textContent()).not.toBe(today);
    await page.keyboard.press("Home");
    await expect(days.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(days.last()).toBeFocused();

    // todo valor também está numa tabela: 30 dias + total
    const toggle = chart.getByRole("button", { name: "Ver como tabela" });
    await toggle.click();
    const table = chart.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(32); // cabeçalho + 30 dias + total
    await expect(table.getByRole("row").last()).toContainText("Total");
    await expect(chart.getByTestId("revenue-day")).toHaveCount(0);
    await chart.getByRole("button", { name: "Ver gráfico" }).click();
    await expect(chart.getByTestId("revenue-day")).toHaveCount(30);
  });

  test("no celular, o conteúdo do faturamento cabe na tela (sem rolagem horizontal)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openDashboard(page);
    // mede só o conteúdo: o cabeçalho do site, que já é largo para quem está logado, fica de fora
    await page.addStyleTag({ content: "header, nav { display: none !important }" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.getByTestId("revenue-chart")).toBeVisible();
  });
});
