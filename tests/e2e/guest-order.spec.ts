/**
 * Pedido de visitante: quem NÃO tem cadastro monta o pedido na vitrine, finaliza, o pedido é gravado
 * no banco (sem dono) e a mensagem do WhatsApp é gerada na própria tela.
 */
import { expect, test, type Page } from "@playwright/test";
import { createE2eUser, createOrderCatalog, ordersByCustomer, setProductPrice } from "./e2e-db";
import { login, rowWith, uniqueId } from "./helpers";

const STORE_NUMBER = "5511999998888"; // WHATSAPP_ORDERS_NUMBER do servidor E2E (playwright.config.ts)

const qty = (page: Page, reference: string) => page.getByLabel(`Quantidade de ${reference}`);
const orderTotal = (page: Page) => page.getByTestId("order-total");
const saveStatus = (page: Page) => page.getByTestId("save-status");
const finalizeButton = (page: Page) => page.getByRole("button", { name: /Finalizar pedido|Finalizando/ });
const addButton = (page: Page, reference: string) => page.getByRole("button", { name: `Adicionar ${reference} ao pedido` });

async function fillCustomer(page: Page, name: string, phone = "", notes = "") {
  await page.getByLabel("Nome do cliente").fill(name);
  if (phone) await page.getByLabel("Telefone do cliente (opcional)").fill(phone);
  if (notes) await page.getByLabel("Observações (opcional)").fill(notes);
}

test.describe("pedido de visitante (sem cadastro)", () => {
  test("da vitrine ao WhatsApp: monta, finaliza sem login, grava sem dono e gera a mensagem", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = uniqueId();
    const prefix = `GST${id}`;
    const customerName = `Maria Visitante ${id}`;
    await createOrderCatalog(prefix);

    // ── Vitrine: adiciona produtos sem estar logado ─────────────────────────
    const viewOrder = (p: Page) => p.getByTestId("home-header").getByRole("link", { name: "Ver pedido" });
    const camCard = page.getByTestId("product-card").filter({ hasText: `${prefix}-CAM` });
    await page.goto(`/?q=${prefix}`);
    await expect(page.getByRole("link", { name: "Sair" })).toHaveCount(0); // ninguém logado
    await expect(viewOrder(page)).toHaveCount(0); // pedido vazio: sem botão "Ver pedido"

    await addButton(page, `${prefix}-CAM`).click();
    await expect(camCard.getByRole("status")).toContainText("No pedido: 1 un.");
    await expect(viewOrder(page)).toBeVisible(); // aparece na hora, no topo da vitrine
    await expect(camCard.getByRole("link")).toHaveCount(0); // e não há link abaixo do produto
    await addButton(page, `${prefix}-CAM`).click();
    await expect(camCard.getByRole("status")).toContainText("No pedido: 2 un.");
    await addButton(page, `${prefix}-SUC`).click();
    await expect(page.getByTestId("product-card").filter({ hasText: `${prefix}-SUC` }).getByRole("status")).toContainText("No pedido: 1 un.");

    await page.reload(); // o pedido está guardado no navegador: o botão continua lá
    await expect(viewOrder(page)).toBeVisible();
    await viewOrder(page).click();

    // ── Tabela: o pedido montado na vitrine está lá (2 × 19,90 + 1 × 7,35) ───
    await expect(page).toHaveURL("/pedidos/novo");
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("2");
    await expect(qty(page, `${prefix}-SUC`)).toHaveValue("1");
    await expect(orderTotal(page)).toHaveText("R$ 47,15");

    // O pedido fica guardado no navegador: sobrevive a recarregar a página
    await page.reload();
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("2");
    await qty(page, `${prefix}-SUC`).fill("3"); // 2 × 19,90 + 3 × 7,35 = 61,85
    await expect(orderTotal(page)).toHaveText("R$ 61,85");
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");

    // ── Finaliza sem login ──────────────────────────────────────────────────
    await fillCustomer(page, customerName, "(11) 98888-7777", "Entregar pela manhã");
    await finalizeButton(page).click();

    await expect(page).toHaveURL("/pedidos/novo"); // não foi mandada ao login nem a outra página
    await expect(page.getByTestId("order-created-banner")).toContainText("registrado com sucesso");
    const orderNumber = (await page.getByTestId("order-created-banner").textContent())!.match(/#(\d+)/)![1];

    // ── Mensagem do WhatsApp ────────────────────────────────────────────────
    const message = (await page.getByTestId("whatsapp-message").textContent())!;
    expect(message.split("\n")).toEqual([
      `*PEDIDO #${orderNumber}*`,
      expect.stringMatching(/^Data: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/), // sem "Lançado por": não há quem lançou
      `Cliente: ${customerName}`,
      "Telefone: (11) 98888-7777",
      "",
      "*ITENS*",
      `1) ${prefix}-CAM - Camiseta azul ${prefix}`,
      "    2 x R$ 19,90 = R$ 39,80",
      `2) ${prefix}-SUC - Suco de uva ${prefix}`,
      "    3 x R$ 7,35 = R$ 22,05",
      "",
      "*TOTAL: R$ 61,85*",
      "2 produto(s) | 5 unidade(s)",
      "",
      "Observações:",
      "Entregar pela manhã",
    ]);

    const storeUrl = new URL((await page.getByTestId("whatsapp-link").getAttribute("href"))!);
    expect(storeUrl.origin + storeUrl.pathname).toBe(`https://wa.me/${STORE_NUMBER}`);
    expect(storeUrl.searchParams.get("text")).toBe(message);
    const customerUrl = new URL((await page.getByTestId("whatsapp-customer-link").getAttribute("href"))!);
    expect(customerUrl.pathname).toBe("/5511988887777");

    await page.getByRole("button", { name: "Copiar mensagem" }).click();
    await expect(page.getByTestId("copy-status")).toHaveText("Mensagem copiada!");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);

    // ── Gravado no banco, sem dono, com preços do cadastro ──────────────────
    const [saved, ...others] = await ordersByCustomer(customerName);
    expect(others).toHaveLength(0);
    expect(saved).toMatchObject({ userId: null, totalCents: 6185, status: "PENDENTE", customerPhone: "11988887777", notes: "Entregar pela manhã" });
    expect(saved.orderNumber).toBe(Number(orderNumber));
    expect(saved.items.map((item) => [item.reference, item.unitPriceCents, item.quantity, item.lineTotalCents]).sort()).toEqual([
      [`${prefix}-CAM`, 1990, 2, 3980],
      [`${prefix}-SUC`, 735, 3, 2205],
    ]);

    // O pedido guardado no navegador foi limpo: a tabela volta vazia e a vitrine não mostra "Ver pedido"
    await page.goto("/pedidos/novo");
    await expect(page.getByTestId("empty-order")).toBeVisible();
    await expect(orderTotal(page)).toHaveText("R$ 0,00");
    await page.goto(`/?q=${prefix}`);
    await expect(page.getByTestId("product-card")).toHaveCount(3);
    await expect(viewOrder(page)).toHaveCount(0);

    // ── Só o ADMIN enxerga o pedido do visitante ────────────────────────────
    const cliente = await createE2eUser("CLIENTE", id);
    await login(page, cliente, "/login?next=%2Fpedidos");
    await page.goto(`/pedidos?q=${encodeURIComponent(customerName)}`);
    await expect(page.getByTestId("empty-state")).toBeVisible();
    expect((await page.goto(`/pedidos/${saved.id}`))?.status()).toBe(404);

    const admin = await createE2eUser("ADMIN", id);
    await context.clearCookies();
    await login(page, admin, "/login?next=%2Fpedidos");
    await page.goto(`/pedidos?q=${encodeURIComponent(customerName)}`);
    const row = rowWith(page, customerName);
    await expect(row).toContainText(`#${orderNumber}`);
    await expect(row).toContainText("Cliente sem cadastro");
    await expect(row).toContainText("R$ 61,85");

    await page.goto(`/pedidos/${saved.id}`);
    await expect(page.getByTestId("order-requester")).toHaveText("Cliente sem cadastro");
    await expect(page.getByTestId("order-total")).toHaveText("R$ 61,85");
    await expect(page.getByTestId("whatsapp-message")).not.toContainText("Lançado por");
  });

  test("monta direto na tabela, sem passar pela vitrine, e o nome do cliente é obrigatório", async ({ page }) => {
    const id = uniqueId();
    const prefix = `GSN${id}`;
    await createOrderCatalog(prefix);

    await page.goto("/pedidos/novo");
    await page.getByRole("combobox", { name: "Adicionar produto" }).fill(`${prefix}-CAF`);
    await page.getByRole("option", { name: new RegExp(`${prefix}-CAF`) }).click();
    await qty(page, `${prefix}-CAF`).fill("2"); // 2 × 25,00
    await expect(orderTotal(page)).toHaveText("R$ 50,00");

    // sem nome: o servidor recusa, mostra o erro no campo e nada é gravado
    await finalizeButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /obrigatório/i }).first()).toBeVisible();
    await expect(page.getByTestId("finalize-error")).toHaveText("Revise os campos destacados");
    await expect(page.getByTestId("order-created-banner")).toHaveCount(0);

    // corrige e finaliza: sem telefone, não há atalho para o cliente
    const name = `Cliente Sem Telefone ${id}`;
    await fillCustomer(page, name);
    await finalizeButton(page).click();
    await expect(page.getByTestId("order-created-banner")).toBeVisible();
    await expect(page.getByTestId("whatsapp-link")).toBeVisible();
    await expect(page.getByTestId("whatsapp-customer-link")).toHaveCount(0);
    expect(await ordersByCustomer(name)).toHaveLength(1);
  });

  test("se o preço mudou enquanto montava, mostra o aviso, atualiza a tela e finaliza com o valor atual", async ({ page }) => {
    const id = uniqueId();
    const prefix = `GSP${id}`;
    const { camiseta } = await createOrderCatalog(prefix);
    const name = `Cliente Preço ${id}`;

    await page.goto(`/?q=${prefix}`);
    await addButton(page, `${prefix}-CAM`).click();
    await expect(page.getByTestId("product-card").filter({ hasText: `${prefix}-CAM` }).getByRole("status")).toContainText("No pedido: 1 un.");
    await page.goto("/pedidos/novo");
    await expect(orderTotal(page)).toHaveText("R$ 19,90");
    await fillCustomer(page, name);

    await setProductPrice(camiseta.id, 2000); // o preço sobe antes de finalizar
    await finalizeButton(page).click();
    await expect(page.getByTestId("finalize-error")).toContainText("preços mudaram");
    await expect(orderTotal(page)).toHaveText("R$ 20,00"); // a tela foi atualizada
    expect(await ordersByCustomer(name)).toHaveLength(0);

    await finalizeButton(page).click();
    await expect(page.getByTestId("order-created-banner")).toBeVisible();
    const [saved] = await ordersByCustomer(name);
    expect(saved).toMatchObject({ userId: null, totalCents: 2000 });
  });

  test("quem entra depois continua com o rascunho no banco: o pedido dele tem dono", async ({ page }) => {
    const id = uniqueId();
    const prefix = `GSU${id}`;
    await createOrderCatalog(prefix);
    const user = await createE2eUser("CLIENTE", id);
    const name = `Cliente Logado ${id}`;

    await login(page, user, "/login?next=%2Fpedidos%2Fnovo");
    await page.getByRole("combobox", { name: "Adicionar produto" }).fill(`${prefix}-CAF`);
    await page.getByRole("option", { name: new RegExp(`${prefix}-CAF`) }).click();
    await fillCustomer(page, name);
    await finalizeButton(page).click();

    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/); // fluxo de quem tem conta: página de detalhe
    const [saved] = await ordersByCustomer(name);
    expect(saved.userId).toBe(user.id);
  });
});
