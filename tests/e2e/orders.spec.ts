import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import { createE2eUser, createOrderCatalog, placeOrderFor, setProductActive, setProductPrice } from "./e2e-db";
import { login, rowWith, uniqueId } from "./helpers";

const STORE_NUMBER = "5511999998888"; // WHATSAPP_ORDERS_NUMBER do servidor E2E (playwright.config.ts)

const picker = (page: Page) => page.getByRole("combobox", { name: "Adicionar produto" });
const qty = (page: Page, reference: string) => page.getByLabel(`Quantidade de ${reference}`);
const lineTotal = (page: Page, reference: string) => rowWith(page, reference).getByTestId("line-total");
const orderTotal = (page: Page) => page.getByTestId("order-total");
const saveStatus = (page: Page) => page.getByTestId("save-status");
const finalizeButton = (page: Page) => page.getByRole("button", { name: /Finalizar pedido|Finalizando/ });
const finalizeError = (page: Page) => page.getByTestId("finalize-error");

async function addProduct(page: Page, reference: string, quantity: number) {
  await picker(page).fill(reference);
  await page.getByRole("option", { name: new RegExp(reference) }).click();
  await qty(page, reference).fill(String(quantity));
}

async function fillCustomer(page: Page, name: string, phone = "", notes = "") {
  await page.getByLabel("Nome do cliente").fill(name);
  if (phone) await page.getByLabel("Telefone do cliente (opcional)").fill(phone);
  if (notes) await page.getByLabel("Observações (opcional)").fill(notes);
}

/** Id do pedido a partir da URL /pedidos/<uuid>. */
const orderIdFrom = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

test.describe("finalizar pedido e gerar a mensagem do WhatsApp", () => {
  test("da tabela ao WhatsApp: grava o pedido, mostra o resumo e a mensagem com os dados certos", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = uniqueId();
    const prefix = `FIN${id}`;
    await createOrderCatalog(prefix);
    const user = await createE2eUser("CLIENTE", id);

    await login(page, user, "/login?next=%2Fpedidos%2Fnovo");
    await addProduct(page, `${prefix}-CAM`, 3); // 3 × 19,90 = 59,70
    await addProduct(page, `${prefix}-SUC`, 12); // 12 × 7,35 = 88,20
    await expect(orderTotal(page)).toHaveText("R$ 147,90");
    await fillCustomer(page, "João da Loja", "(11) 98888-7777", "Entregar pela manhã");

    // Finaliza (sem esperar o autosave: o botão espera a gravação sozinho)
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);

    // ── Banner e resumo do pedido gravado ───────────────────────────────────
    await expect(page.getByTestId("order-created-banner")).toContainText("registrado com sucesso");
    await expect(page.getByTestId("order-status")).toHaveText("Pendente");
    await expect(page.getByTestId("order-customer")).toHaveText("João da Loja");
    await expect(page.getByTestId("order-phone")).toHaveText("(11) 98888-7777");
    await expect(page.getByTestId("order-requester")).toHaveText(user.name);
    await expect(page.getByTestId("order-notes")).toHaveText("Entregar pela manhã");
    await expect(page.getByTestId("order-date")).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    for (const column of ["Referência", "Descrição do Produto", "Valor Unitário", "Quantidade", "Valor Total"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
    await expect(rowWith(page, `${prefix}-CAM`)).toContainText("R$ 19,90");
    await expect(rowWith(page, `${prefix}-CAM`).getByTestId("line-total")).toHaveText("R$ 59,70");
    await expect(rowWith(page, `${prefix}-SUC`).getByTestId("line-total")).toHaveText("R$ 88,20");
    await expect(page.getByTestId("order-total")).toHaveText("R$ 147,90");

    // ── Mensagem do WhatsApp ────────────────────────────────────────────────
    const message = (await page.getByTestId("whatsapp-message").textContent())!;
    const orderNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.match(/#(\d+)/)![1];
    expect(message.split("\n")).toEqual([
      `*PEDIDO #${orderNumber}*`,
      expect.stringMatching(/^Data: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/),
      `Lançado por: ${user.name}`,
      "Cliente: João da Loja",
      "Telefone: (11) 98888-7777",
      "",
      "*ITENS*",
      `1) ${prefix}-CAM - Camiseta azul ${prefix}`,
      "    3 x R$ 19,90 = R$ 59,70",
      `2) ${prefix}-SUC - Suco de uva ${prefix}`,
      "    12 x R$ 7,35 = R$ 88,20",
      "",
      "*TOTAL: R$ 147,90*",
      "2 produto(s) | 15 unidade(s)",
      "",
      "Observações:",
      "Entregar pela manhã",
    ]);

    // Link para o número da loja, com a MESMA mensagem
    const storeLink = page.getByTestId("whatsapp-link");
    const storeUrl = new URL((await storeLink.getAttribute("href"))!);
    expect(storeUrl.origin).toBe("https://wa.me");
    expect(storeUrl.pathname).toBe(`/${STORE_NUMBER}`);
    expect(storeUrl.searchParams.get("text")).toBe(message);
    await expect(storeLink).toHaveAttribute("target", "_blank");
    await expect(storeLink).toHaveAttribute("rel", /noopener/);

    // Atalho para o cliente (telefone informado)
    const customerUrl = new URL((await page.getByTestId("whatsapp-customer-link").getAttribute("href"))!);
    expect(customerUrl.pathname).toBe("/5511988887777");
    expect(customerUrl.searchParams.get("text")).toBe(message);

    // Copiar mensagem
    await page.getByRole("button", { name: "Copiar mensagem" }).click();
    await expect(page.getByTestId("copy-status")).toHaveText("Mensagem copiada!");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);

    // ── Rascunho consumido e pedido no histórico ────────────────────────────
    await page.goto("/pedidos/novo");
    await expect(page.getByTestId("empty-order")).toBeVisible();
    await expect(orderTotal(page)).toHaveText("R$ 0,00");

    await page.goto("/pedidos");
    await expect(page.getByRole("heading", { level: 1, name: "Meus pedidos" })).toBeVisible();
    const row = rowWith(page, "João da Loja");
    await expect(row).toContainText(`#${orderNumber}`);
    await expect(row).toContainText("R$ 147,90");
    await expect(row).toContainText("2 produto(s) · 15 un.");
    await row.getByRole("link", { name: `#${orderNumber}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Pedido #${orderNumber}`);
  });

  test("sem telefone do cliente não há atalho 'Enviar ao cliente'; sem observações a mensagem as omite", async ({ page }) => {
    const id = uniqueId();
    const prefix = `SEM${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await addProduct(page, `${prefix}-CAF`, 2);
    await fillCustomer(page, "Maria Souza");
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);

    await expect(page.getByTestId("order-phone")).toHaveText("—");
    await expect(page.getByTestId("order-notes")).toHaveCount(0);
    await expect(page.getByTestId("whatsapp-customer-link")).toHaveCount(0);
    const message = (await page.getByTestId("whatsapp-message").textContent())!;
    expect(message).not.toContain("Telefone:");
    expect(message).not.toContain("Observações");
    expect(message).toContain("2 x R$ 25,00 = R$ 50,00");
  });

  test("validações: nome obrigatório e telefone inválido aparecem sem perder o pedido; depois grava", async ({ page }) => {
    const id = uniqueId();
    const prefix = `VAL${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await expect(finalizeButton(page)).toBeDisabled(); // sem itens

    await addProduct(page, `${prefix}-CAM`, 2);
    await finalizeButton(page).click();
    await expect(page.getByText("Nome do cliente é obrigatório")).toBeVisible();
    await expect(page.getByLabel("Nome do cliente")).toHaveAttribute("aria-invalid", "true");
    await expect(finalizeError(page)).toHaveText("Revise os campos destacados");
    await expect(page).toHaveURL("/pedidos/novo");
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("2"); // tabela intacta

    await fillCustomer(page, "Joana", "123");
    await finalizeButton(page).click();
    await expect(page.getByText("Telefone inválido (informe DDD + número)")).toBeVisible();
    await expect(page.getByLabel("Nome do cliente")).not.toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Telefone do cliente (opcional)").fill("(11) 3333-4444"); // fixo, 10 dígitos
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);
    await expect(page.getByTestId("order-phone")).toHaveText("(11) 3333-4444");
    const customerUrl = new URL((await page.getByTestId("whatsapp-customer-link").getAttribute("href"))!);
    expect(customerUrl.pathname).toBe("/551133334444");
  });

  test("quantidade inválida impede a finalização", async ({ page }) => {
    const id = uniqueId();
    const prefix = `QTD${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await addProduct(page, `${prefix}-CAM`, 1);
    await qty(page, `${prefix}-CAM`).fill("abc");
    await fillCustomer(page, "Joana");
    await finalizeButton(page).click();

    await expect(finalizeError(page)).toHaveText("Corrija as quantidades antes de finalizar o pedido.");
    await expect(page).toHaveURL("/pedidos/novo");
  });

  test("clique duplo em 'Finalizar' cria um único pedido", async ({ page }) => {
    const id = uniqueId();
    const prefix = `DUP${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await addProduct(page, `${prefix}-CAM`, 2);
    await fillCustomer(page, "Cliente Duplo");
    await finalizeButton(page).dblclick();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);

    await page.goto("/pedidos");
    await expect(page.getByTestId("result-count")).toHaveText("1 pedido(s)");
    await expect(finalizeError(page)).toHaveCount(0);
  });
});

test.describe("o catálogo muda enquanto o pedido está aberto", () => {
  test("preço alterado: recusa, atualiza a tabela com o preço novo e permite finalizar de novo", async ({ page }) => {
    const id = uniqueId();
    const prefix = `PRC${id}`;
    const { camiseta } = await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await addProduct(page, `${prefix}-CAM`, 2);
    await expect(orderTotal(page)).toHaveText("R$ 39,80");
    await fillCustomer(page, "Cliente Preço");

    await setProductPrice(camiseta.id, 2000); // o admin reajusta o preço com a tela aberta

    await finalizeButton(page).click();
    await expect(finalizeError(page)).toContainText("Os preços mudaram");
    await expect(page).toHaveURL("/pedidos/novo");
    // a tela foi atualizada com o preço novo (sem recarregar manualmente)
    await expect(lineTotal(page, `${prefix}-CAM`)).toHaveText("R$ 40,00");
    await expect(orderTotal(page)).toHaveText("R$ 40,00");

    await page.goto("/pedidos");
    await expect(page.getByTestId("empty-state")).toBeVisible(); // nenhum pedido foi criado

    await page.goto("/pedidos/novo");
    await fillCustomer(page, "Cliente Preço");
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);
    await expect(rowWith(page, `${prefix}-CAM`)).toContainText("R$ 20,00");
    await expect(page.getByTestId("order-total")).toHaveText("R$ 40,00");
  });

  test("produto desativado: recusa, remove a linha da tabela e finaliza só com o que resta", async ({ page }) => {
    const id = uniqueId();
    const prefix = `OFF${id}`;
    const { suco } = await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await addProduct(page, `${prefix}-CAM`, 2);
    await addProduct(page, `${prefix}-SUC`, 1);
    await expect(orderTotal(page)).toHaveText("R$ 47,15");
    await fillCustomer(page, "Cliente Off");
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");

    await setProductActive(suco.id, false);

    await finalizeButton(page).click();
    await expect(finalizeError(page)).toContainText("não estão mais disponíveis");
    await expect(rowWith(page, `${prefix}-SUC`)).toHaveCount(0);
    await expect(orderTotal(page)).toHaveText("R$ 39,80");

    await expect(saveStatus(page)).toHaveText("Rascunho salvo"); // rascunho regravado sem o item
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);
    await expect(page.getByTestId("order-total")).toHaveText("R$ 39,80");
    await expect(page.getByTestId("line-total")).toHaveCount(1);
  });

  test("o pedido gravado é uma foto: mudar preço depois não altera o histórico nem a mensagem", async ({ page }) => {
    const id = uniqueId();
    const prefix = `FOT${id}`;
    const { camiseta } = await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");

    await addProduct(page, `${prefix}-CAM`, 3);
    await fillCustomer(page, "Cliente Foto");
    await finalizeButton(page).click();
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}\?novo=1$/);
    const messageBefore = await page.getByTestId("whatsapp-message").textContent();
    const detailPath = new URL(page.url()).pathname;

    await setProductPrice(camiseta.id, 99999);

    await page.goto(detailPath);
    await expect(rowWith(page, `${prefix}-CAM`)).toContainText("R$ 19,90");
    await expect(page.getByTestId("order-total")).toHaveText("R$ 59,70");
    expect(await page.getByTestId("whatsapp-message").textContent()).toBe(messageBefore);
  });
});

test.describe("histórico: quem vê o quê", () => {
  async function setup() {
    const id = uniqueId();
    const prefix = `HIS${id}`;
    const { camiseta, suco } = await createOrderCatalog(prefix);
    const consultorA = await createE2eUser("CONSULTOR", `${id}A`);
    const consultorB = await createE2eUser("CONSULTOR", `${id}B`);
    const cliente = await createE2eUser("CLIENTE", `${id}C`);
    const lines = (product: { id: string }, priceCents: number) => [{ productId: product.id, priceCents, quantity: 2 }];

    const a1 = await placeOrderFor(consultorA.id, lines(camiseta, 1990), { customerName: `${prefix} Cliente-de-A` });
    const b1 = await placeOrderFor(consultorB.id, lines(suco, 735), { customerName: `${prefix} Cliente-de-B` });
    const c1 = await placeOrderFor(cliente.id, lines(camiseta, 1990), { customerName: `${prefix} Cliente-do-Cliente` });
    return { prefix, consultorA, consultorB, cliente, a1, b1, c1 };
  }

  test("CONSULTOR vê só os seus pedidos e recebe 404 no pedido de outro", async ({ page }) => {
    const { prefix, consultorA, b1, c1, a1 } = await setup();
    await login(page, consultorA, `/login?next=${encodeURIComponent(`/pedidos?q=${prefix}`)}`);

    await expect(page.getByRole("heading", { level: 1, name: "Meus pedidos" })).toBeVisible();
    await expect(page.getByTestId("result-count")).toHaveText("1 pedido(s)");
    await expect(rowWith(page, "Cliente-de-A")).toBeVisible();
    await expect(page.getByText("Cliente-de-B")).toHaveCount(0);
    await expect(page.getByText("Cliente-do-Cliente")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Lançado por" })).toHaveCount(0);

    // buscar pelo nome de outro cliente não vaza nada
    await page.goto(`/pedidos?q=${prefix}%20Cliente-de-B`);
    await expect(page.getByTestId("empty-state")).toHaveText("Nenhum pedido encontrado para esses filtros.");

    // o próprio pedido abre; o de outro responde 404 (nem revela que existe)
    expect((await page.goto(`/pedidos/${a1.orderId}`))?.status()).toBe(200);
    expect((await page.goto(`/pedidos/${b1.orderId}`))?.status()).toBe(404);
    expect((await page.goto(`/pedidos/${c1.orderId}`))?.status()).toBe(404);
    await expect(page.getByText("Cliente-de-B")).toHaveCount(0);
  });

  test("CLIENTE vê só o próprio pedido", async ({ page }) => {
    const { prefix, cliente, a1 } = await setup();
    await login(page, cliente, `/login?next=${encodeURIComponent(`/pedidos?q=${prefix}`)}`);

    await expect(page.getByTestId("result-count")).toHaveText("1 pedido(s)");
    await expect(rowWith(page, "Cliente-do-Cliente")).toBeVisible();
    expect((await page.goto(`/pedidos/${a1.orderId}`))?.status()).toBe(404);
  });

  test("ADMIN vê TODOS os pedidos, com quem lançou cada um, e abre qualquer detalhe", async ({ page }) => {
    const { prefix, consultorA, consultorB, cliente, b1 } = await setup();
    await login(page, TEST_USERS.admin, `/login?next=${encodeURIComponent(`/pedidos?q=${prefix}`)}`);

    await expect(page.getByRole("heading", { level: 1, name: "Todos os pedidos" })).toBeVisible();
    await expect(page.getByTestId("result-count")).toHaveText("3 pedido(s)");
    await expect(page.getByRole("columnheader", { name: "Lançado por" })).toBeVisible();
    await expect(rowWith(page, "Cliente-de-A")).toContainText(consultorA.name);
    await expect(rowWith(page, "Cliente-de-B")).toContainText(consultorB.name);
    await expect(rowWith(page, "Cliente-do-Cliente")).toContainText(cliente.name);

    expect((await page.goto(`/pedidos/${b1.orderId}`))?.status()).toBe(200);
    await expect(page.getByTestId("order-customer")).toHaveText(`${prefix} Cliente-de-B`);
    await expect(page.getByTestId("order-requester")).toHaveText(consultorB.name);

    // painel administrativo: card de pedidos e link na navegação
    await page.goto("/admin");
    await expect(page.getByTestId("stat-orders")).toBeVisible();
    await page.getByRole("navigation", { name: "Administração" }).getByRole("link", { name: "Pedidos" }).click();
    await expect(page).toHaveURL("/pedidos");
  });

  test("visitante é enviado ao login; id inválido ou inexistente dá 404", async ({ page }) => {
    const { b1 } = await setup();
    await page.goto("/pedidos");
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/pedidos")}`);
    await page.goto(`/pedidos/${b1.orderId}`);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/pedidos/${b1.orderId}`)}`);

    await login(page, TEST_USERS.admin);
    expect((await page.goto("/pedidos/nao-e-uuid"))?.status()).toBe(404);
    expect((await page.goto(`/pedidos/${randomUUID()}`))?.status()).toBe(404);
  });

  test("busca por cliente ou número, filtro por situação e paginação (10 por página)", async ({ page }) => {
    const id = uniqueId();
    const prefix = `PAG${id}`;
    const { camiseta } = await createOrderCatalog(prefix);
    const user = await createE2eUser("CONSULTOR", id);
    const placed = [];
    for (let i = 1; i <= 11; i++) {
      placed.push(
        await placeOrderFor(user.id, [{ productId: camiseta.id, priceCents: 1990, quantity: i }], {
          customerName: `${prefix} Cliente ${String(i).padStart(2, "0")}`,
        }),
      );
    }
    await login(page, user, "/login?next=%2Fpedidos");

    await expect(page.getByTestId("result-count")).toHaveText("11 pedido(s)");
    await expect(page.getByTestId("pagination-status")).toHaveText("Página 1 de 2");
    await expect(page.getByRole("row")).toHaveCount(11); // cabeçalho + 10
    // mais recentes primeiro: o 11º aparece na página 1 e o 1º só na 2
    await expect(rowWith(page, "Cliente 11")).toBeVisible();
    await expect(rowWith(page, "Cliente 01")).toHaveCount(0);
    await page.getByRole("link", { name: "Próxima" }).click();
    await expect(page.getByTestId("pagination-status")).toHaveText("Página 2 de 2");
    await expect(rowWith(page, "Cliente 01")).toBeVisible();

    // busca por nome
    await page.goto("/pedidos");
    await page.getByLabel("Buscar").fill("Cliente 07");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("1 pedido(s)");

    // busca por número do pedido
    await page.goto(`/pedidos?q=${placed[2].orderNumber}`);
    await expect(rowWith(page, "Cliente 03")).toBeVisible();

    // filtro por situação: todos estão pendentes
    await page.goto("/pedidos?status=confirmado");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.goto("/pedidos?status=pendente");
    await expect(page.getByTestId("result-count")).toHaveText("11 pedido(s)");
  });
});
