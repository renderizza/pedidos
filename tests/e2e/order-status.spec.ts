import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import { createE2eUser, createOrderCatalog, ordersByCustomer, placeOrderFor } from "./e2e-db";
import { login, rowWith, uniqueId } from "./helpers";

/** Um pedido PENDENTE de um dono qualquer, com cliente de nome único (para achar a linha na lista). */
async function createOrder(role: "CLIENTE" | "CONSULTOR", id: string, label = "") {
  const catalog = await createOrderCatalog(`ST${id}${label}`);
  const owner = await createE2eUser(role, `${id}${label}`);
  const customerName = `Cliente ST ${id}${label}`;
  const placed = await placeOrderFor(owner.id, [{ productId: catalog.camiseta.id, priceCents: 1990, quantity: 1 }], { customerName });
  return { owner, customerName, orderNumber: placed.orderNumber, orderId: placed.orderId };
}

const findOrder = (page: Page, customerName: string) => page.goto(`/pedidos?q=${encodeURIComponent(customerName)}`);
const statusSelect = (page: Page, orderNumber: number) => page.getByRole("combobox", { name: `Situação do pedido #${orderNumber}` });
const savedStatus = async (customerName: string) => (await ordersByCustomer(customerName))[0].status;

/**
 * Espera o servidor confirmar a alteração. O seletor mostra a escolha NA HORA (é otimista), então olhar só o valor
 * dele não prova que gravou; o aviso "Situação alterada para X." só aparece depois que o servidor respondeu.
 * É o ponto de sincronização antes de conferir o banco ou outra tela.
 */
const expectSaved = (page: Page, customerName: string, label: "Pendente" | "Confirmado" | "Cancelado") =>
  expect(rowWith(page, customerName).getByTestId("order-status-feedback")).toHaveText(`Situação alterada para ${label}.`);

test.describe("alterar a situação do pedido na lista", () => {
  test("ADMIN altera a situação no seletor (a lista não tem selo colorido): o banco grava, resiste a recarregar e aparece no detalhe", async ({ page }) => {
    const id = uniqueId();
    const order = await createOrder("CLIENTE", id);

    await login(page, TEST_USERS.admin);
    await findOrder(page, order.customerName);
    const select = statusSelect(page, order.orderNumber);
    await expect(select).toHaveValue("PENDENTE"); // o seletor já mostra a situação atual
    await expect(page.getByTestId("order-status")).toHaveCount(0); // e não há selo colorido na lista

    await select.selectOption("CONFIRMADO");
    await expectSaved(page, order.customerName, "Confirmado");
    await expect(select).toHaveValue("CONFIRMADO");
    await expect(select).toBeEnabled();
    expect(await savedStatus(order.customerName)).toBe("CONFIRMADO");

    await page.reload();
    await expect(select).toHaveValue("CONFIRMADO"); // agora vindo do servidor

    await rowWith(page, order.customerName).getByRole("link", { name: `#${order.orderNumber}` }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmado"); // o detalhe do pedido mantém o selo
  });

  test("cancelar pede confirmação: recusar não muda nada; aceitar cancela; reabrir não pergunta nada", async ({ page }) => {
    const id = uniqueId();
    const order = await createOrder("CLIENTE", id);
    await login(page, TEST_USERS.admin);
    await findOrder(page, order.customerName);
    const select = statusSelect(page, order.orderNumber);

    // Recusa
    const asked: string[] = [];
    page.once("dialog", async (dialog) => {
      asked.push(dialog.message());
      await dialog.dismiss();
    });
    await select.selectOption("CANCELADO");
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain(`#${order.orderNumber}`);
    await expect(select).toHaveValue("PENDENTE"); // o seletor volta à situação real
    await expect(rowWith(page, order.customerName).getByTestId("order-status-feedback")).toHaveCount(0); // nada foi enviado
    expect(await savedStatus(order.customerName)).toBe("PENDENTE");

    // Aceita
    page.once("dialog", (dialog) => dialog.accept());
    await select.selectOption("CANCELADO");
    await expectSaved(page, order.customerName, "Cancelado");
    await expect(select).toHaveValue("CANCELADO");
    expect(await savedStatus(order.customerName)).toBe("CANCELADO");

    // Reabrir um cancelado: nada se perde, então não há confirmação.
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await select.selectOption("PENDENTE");
    await expectSaved(page, order.customerName, "Pendente");
    await expect(select).toHaveValue("PENDENTE");
    expect(dialogs).toBe(0);
    expect(await savedStatus(order.customerName)).toBe("PENDENTE");
  });

  test("com o filtro de situação ativo, o pedido sai da lista assim que muda de situação", async ({ page }) => {
    const id = uniqueId();
    const order = await createOrder("CLIENTE", id);
    await login(page, TEST_USERS.admin);
    await page.goto(`/pedidos?status=pendente&q=${encodeURIComponent(order.customerName)}`);
    await expect(page.getByTestId("result-count")).toHaveText("1 pedido(s)");

    await statusSelect(page, order.orderNumber).selectOption("CONFIRMADO");

    await expect(page.getByTestId("empty-state")).toHaveText("Nenhum pedido encontrado para esses filtros.");
    await expect(page.getByTestId("result-count")).toHaveText("0 pedido(s)");
    await page.goto(`/pedidos?status=confirmado&q=${encodeURIComponent(order.customerName)}`);
    await expect(rowWith(page, order.customerName)).toBeVisible();
  });

  test("CONSULTOR altera os SEUS pedidos e não enxerga os de outras pessoas", async ({ page }) => {
    const id = uniqueId();
    const mine = await createOrder("CONSULTOR", id, "A");
    const other = await createOrder("CONSULTOR", id, "B");

    await login(page, mine.owner);
    await page.goto("/pedidos");
    await expect(statusSelect(page, mine.orderNumber)).toBeVisible();
    await expect(statusSelect(page, other.orderNumber)).toHaveCount(0); // o pedido do outro nem aparece
    await expect(rowWith(page, other.customerName)).toHaveCount(0);

    await statusSelect(page, mine.orderNumber).selectOption("CONFIRMADO");
    await expectSaved(page, mine.customerName, "Confirmado");
    expect(await savedStatus(mine.customerName)).toBe("CONFIRMADO");
    expect(await savedStatus(other.customerName)).toBe("PENDENTE");
  });

  test("CLIENTE só acompanha: a lista não tem seletor nem coluna de situação; a situação fica na página do pedido", async ({ page }) => {
    const id = uniqueId();
    const order = await createOrder("CLIENTE", id);
    await login(page, order.owner);
    await page.goto("/pedidos");
    await expect(rowWith(page, order.customerName)).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveCount(0); // a lista não mostra selo de situação
    await expect(page.getByTestId("order-status-select")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /Situação do pedido/ })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Situação" })).toHaveCount(0);

    await rowWith(page, order.customerName).getByRole("link", { name: `#${order.orderNumber}` }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Pendente");
  });

  test("a mudança vale para todos: o consultor altera e o ADMIN vê a nova situação (e vice-versa)", async ({ page, browser }, testInfo) => {
    const id = uniqueId();
    const order = await createOrder("CONSULTOR", id);

    const adminContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const admin = await adminContext.newPage();
    await login(admin, TEST_USERS.admin);

    await login(page, order.owner);
    await page.goto("/pedidos");
    await statusSelect(page, order.orderNumber).selectOption("CONFIRMADO");
    await expectSaved(page, order.customerName, "Confirmado"); // só depois de gravado o ADMIN pode enxergar

    await findOrder(admin, order.customerName);
    await expect(statusSelect(admin, order.orderNumber)).toHaveValue("CONFIRMADO");
    await statusSelect(admin, order.orderNumber).selectOption("PENDENTE");
    await expectSaved(admin, order.customerName, "Pendente");

    await page.reload();
    await expect(statusSelect(page, order.orderNumber)).toHaveValue("PENDENTE");
    await adminContext.close();
  });

  test("no celular (360px) o seletor cabe na tela, tem área de toque de 40px e funciona", async ({ page }) => {
    const id = uniqueId();
    const order = await createOrder("CLIENTE", id);
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, TEST_USERS.admin);
    await findOrder(page, order.customerName);

    const select = statusSelect(page, order.orderNumber);
    await expect(select).toBeVisible();
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await select.selectOption("CONFIRMADO");
    await expectSaved(page, order.customerName, "Confirmado");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
