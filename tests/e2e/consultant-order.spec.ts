/**
 * Pedido do CONSULTOR: interno. A tela de montagem não pede dados do cliente (só o botão
 * "Finalizar pedido"), o pedido é gravado sem cliente e não há mensagem de WhatsApp.
 */
import { expect, test, type Page } from "@playwright/test";
import { createE2eUser, createOrderCatalog, ordersOfUser } from "./e2e-db";
import { login, rowWith, uniqueId } from "./helpers";

const picker = (page: Page) => page.getByRole("combobox", { name: "Adicionar produto" });
const qty = (page: Page, reference: string) => page.getByLabel(`Quantidade de ${reference}`);
const orderTotal = (page: Page) => page.getByTestId("order-total");
const finalizeButton = (page: Page) => page.getByRole("button", { name: /Finalizar pedido|Finalizando/ });

async function addProduct(page: Page, reference: string, quantity: number) {
  await picker(page).fill(reference);
  await page.getByRole("option", { name: new RegExp(reference) }).click();
  await qty(page, reference).fill(String(quantity));
}

test.describe("pedido do CONSULTOR (interno, sem cliente e sem WhatsApp)", () => {
  test("a tela não mostra dados do pedido, só o botão; o pedido é gravado sem cliente e sem WhatsApp", async ({ page }) => {
    const id = uniqueId();
    const prefix = `CNS${id}`;
    await createOrderCatalog(prefix);
    const consultor = await createE2eUser("CONSULTOR", id);

    await login(page, consultor, "/login?next=%2Fpedidos%2Fnovo");

    // ── Tela de montagem: sem formulário de dados do pedido ────────────────
    await expect(page.getByRole("heading", { level: 1, name: "Montar pedido" })).toBeVisible();
    await expect(page.getByLabel("Nome do cliente")).toHaveCount(0);
    await expect(page.getByLabel("Telefone do cliente (opcional)")).toHaveCount(0);
    await expect(page.getByLabel("Observações (opcional)")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Dados do pedido" })).toHaveCount(0);
    await expect(finalizeButton(page)).toBeVisible();
    await expect(finalizeButton(page)).toBeDisabled(); // sem itens

    await addProduct(page, `${prefix}-CAM`, 3); // 3 × 19,90 = 59,70
    await addProduct(page, `${prefix}-SUC`, 12); // 12 × 7,35 = 88,20
    await expect(orderTotal(page)).toHaveText("R$ 147,90");
    await expect(finalizeButton(page)).toBeEnabled();

    // ── Finaliza sem informar nada ──────────────────────────────────────────
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);

    // ── Detalhe: pedido registrado, sem cliente e sem WhatsApp ──────────────
    const banner = page.getByTestId("order-created-banner");
    await expect(banner).toContainText("registrado com sucesso");
    await expect(banner).not.toContainText("WhatsApp");
    await expect(page.getByTestId("order-requester")).toHaveText(consultor.name);
    await expect(page.getByTestId("order-status")).toHaveText("Pendente");
    await expect(page.getByTestId("order-customer")).toHaveCount(0);
    await expect(page.getByTestId("order-phone")).toHaveCount(0);
    await expect(page.getByTestId("whatsapp-message")).toHaveCount(0);
    await expect(page.getByTestId("whatsapp-link")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Enviar pelo WhatsApp" })).toHaveCount(0);
    await expect(rowWith(page, `${prefix}-CAM`).getByTestId("line-total")).toHaveText("R$ 59,70");
    await expect(rowWith(page, `${prefix}-SUC`).getByTestId("line-total")).toHaveText("R$ 88,20");
    await expect(page.getByTestId("order-total")).toHaveText("R$ 147,90");

    // ── Gravado sem cliente, com os preços do cadastro ──────────────────────
    const [saved, ...others] = await ordersOfUser(consultor.id);
    expect(others).toHaveLength(0);
    expect(saved).toMatchObject({ customerName: null, customerPhone: null, notes: null, totalCents: 14790, status: "PENDENTE" });
    expect(saved.items.map((item) => [item.reference, item.unitPriceCents, item.quantity]).sort()).toEqual([
      [`${prefix}-CAM`, 1990, 3],
      [`${prefix}-SUC`, 735, 12],
    ]);

    // ── Rascunho consumido; histórico mostra o pedido sem cliente ───────────
    await page.goto("/pedidos/novo");
    await expect(page.getByTestId("empty-order")).toBeVisible();
    await page.goto("/pedidos");
    await expect(page.getByRole("heading", { level: 1, name: "Meus pedidos" })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(`#${saved.orderNumber}\\b`) });
    await expect(row).toContainText("R$ 147,90");
    await expect(row.getByRole("cell").nth(2)).toHaveText("—"); // coluna Cliente
  });

  test("o ADMIN vê o pedido do consultor sem cliente e sem WhatsApp; o consultor continua sem ver os de outros", async ({ page, context }) => {
    const id = uniqueId();
    const prefix = `CNA${id}`;
    await createOrderCatalog(prefix);
    const consultor = await createE2eUser("CONSULTOR", id);
    const outro = await createE2eUser("CONSULTOR", `${id}X`);

    await login(page, consultor, "/login?next=%2Fpedidos%2Fnovo");
    await addProduct(page, `${prefix}-CAF`, 2); // 2 × 25,00
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);
    const detailPath = new URL(page.url()).pathname;
    const orderNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.match(/#(\d+)/)![1];

    await context.clearCookies();
    await login(page, await createE2eUser("ADMIN", id), "/login?next=%2Fpedidos");
    const row = page.getByRole("row", { name: new RegExp(`#${orderNumber}\\b`) });
    await page.goto(`/pedidos?q=${orderNumber}`);
    await expect(row).toContainText(consultor.name); // "Lançado por"
    await expect(row).toContainText("R$ 50,00");
    await page.goto(detailPath);
    await expect(page.getByTestId("order-requester")).toHaveText(consultor.name);
    await expect(page.getByTestId("order-customer")).toHaveCount(0);
    await expect(page.getByTestId("whatsapp-message")).toHaveCount(0);

    await context.clearCookies();
    await login(page, outro, "/login?next=%2Fpedidos");
    expect((await page.goto(detailPath))?.status()).toBe(404);
  });

  test("o consultor monta pelo botão da vitrine e finaliza sem dados do cliente", async ({ page }) => {
    const id = uniqueId();
    const prefix = `CNV${id}`;
    await createOrderCatalog(prefix);
    const consultor = await createE2eUser("CONSULTOR", id);

    await login(page, consultor, `/login?next=${encodeURIComponent(`/?q=${prefix}`)}`);
    await page.getByRole("button", { name: `Adicionar ${prefix}-CAM ao pedido` }).click();
    await expect(page.getByTestId("product-card").filter({ hasText: `${prefix}-CAM` }).getByRole("status")).toContainText("No pedido: 1 un.");
    await page.getByTestId("home-header").getByRole("link", { name: "Montar pedido" }).click();

    await expect(page).toHaveURL("/pedidos/novo");
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("1");
    await expect(page.getByLabel("Nome do cliente")).toHaveCount(0);
    await finalizeButton(page).click();
    await expect(page.getByTestId("order-created-banner")).toBeVisible();
    expect((await ordersOfUser(consultor.id))[0]).toMatchObject({ customerName: null, totalCents: 1990 });
  });
});
