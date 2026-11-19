import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import {
  createE2eUser,
  createOrderCatalog,
  seedProducts,
  setProductActive,
  setProductPrice,
} from "./e2e-db";
import { answerNextConfirm, login, rowWith, uniqueId } from "./helpers";

const picker = (page: Page) => page.getByRole("combobox", { name: "Adicionar produto" });
const qty = (page: Page, reference: string) => page.getByLabel(`Quantidade de ${reference}`);
const lineTotal = (page: Page, reference: string) => rowWith(page, reference).getByTestId("line-total");
const orderTotal = (page: Page) => page.getByTestId("order-total");
const saveStatus = (page: Page) => page.getByTestId("save-status");

async function addViaPicker(page: Page, reference: string) {
  await picker(page).fill(reference);
  await page.getByRole("option", { name: new RegExp(reference) }).click();
  await expect(qty(page, reference)).toBeFocused();
}

test.describe("vitrine (página inicial)", () => {
  test("visitante vê só os produtos ativos, filtra por busca e categoria, e já pode pedir sem entrar", async ({ page }) => {
    const prefix = `VIT${uniqueId()}`;
    const { category } = await createOrderCatalog(prefix);

    await page.goto(`/?q=${prefix}`);
    await expect(page.getByRole("heading", { level: 1, name: "Vitrine de produtos" })).toBeVisible();

    // 3 ativos; o desativado (OFF) não aparece
    await expect(page.getByTestId("product-card")).toHaveCount(3);
    await expect(page.getByText(`${prefix}-OFF`)).toHaveCount(0);
    const camiseta = page.getByTestId("product-card").filter({ hasText: `${prefix}-CAM` });
    await expect(camiseta).toContainText(`Camiseta azul ${prefix}`);
    await expect(camiseta).toContainText("R$ 19,90");
    await expect(page.getByTestId("product-card").filter({ hasText: `${prefix}-SUC` })).toContainText("Bebidas");

    // visitante: pode pedir sem login pelo botão de cada cartão; não há "Montar pedido" nem "Entrar" na tela
    await expect(page.getByRole("button", { name: /Adicionar .* ao pedido/ })).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Montar pedido" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Entrar" })).toHaveCount(0);
    await expect(page.getByRole("navigation").getByRole("link")).toHaveCount(1); // só a marca

    // busca pelo formulário
    await page.goto("/");
    await page.getByLabel("Buscar").fill(`${prefix}-SUC`);
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByTestId("product-card")).toHaveCount(1);
    await expect(page.getByTestId("result-count")).toHaveText("1 produto(s)");

    // filtro por categoria (combinado com a busca pelo prefixo)
    await page.goto(`/?q=${prefix}`);
    await page.getByLabel("Categoria").selectOption(category.id);
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByTestId("product-card")).toHaveCount(1);
    await expect(page.getByTestId("product-card")).toContainText(`${prefix}-SUC`);

    await page.getByRole("link", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL("/");

    // sem resultados
    await page.goto(`/?q=${prefix}-NAO-EXISTE`);
    await expect(page.getByTestId("empty-state")).toHaveText("Nenhum produto encontrado para esses filtros.");
  });

  test("pagina a vitrine (12 por página) preservando a busca", async ({ page }) => {
    const prefix = `VPG${uniqueId()}`;
    await seedProducts(prefix, 13);

    await page.goto(`/?q=${prefix}`);
    await expect(page.getByTestId("product-card")).toHaveCount(12);
    await expect(page.getByTestId("pagination-status")).toHaveText("Página 1 de 2");

    await page.getByRole("link", { name: "Próxima" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${prefix}.*pagina=2|pagina=2.*q=${prefix}`));
    await expect(page.getByTestId("product-card")).toHaveCount(1);
    await expect(page.getByTestId("result-count")).toHaveText("13 produto(s)");
  });

  test("a vitrine não exibe botão de pedir para quem não pode pedir, mas exibe para os 3 perfis logados", async ({ page }) => {
    const prefix = `PER${uniqueId()}`;
    await createOrderCatalog(prefix);
    for (const key of ["admin", "consultor", "cliente"] as const) {
      await page.context().clearCookies();
      await login(page, TEST_USERS[key], `/login?next=${encodeURIComponent(`/?q=${prefix}`)}`);
      await expect(page.getByRole("button", { name: /Adicionar .* ao pedido/ })).toHaveCount(3);
      // quem está logado mantém o botão "Montar pedido" no topo da vitrine
      await expect(page.getByTestId("home-header").getByRole("link", { name: "Montar pedido" })).toHaveAttribute("href", "/pedidos/novo");
    }
  });
});

test.describe("tabela de pedido (montagem direta, sem carrinho)", () => {
  test("monta o pedido na tabela com cálculo automático e mantém o rascunho ao recarregar", async ({ page }) => {
    const id = uniqueId();
    const prefix = `TAB${id}`;
    await createOrderCatalog(prefix);
    const user = await createE2eUser("CONSULTOR", id);

    // Da vitrine para a tabela
    await login(page, user);
    await expect(page).toHaveURL("/");
    await page.getByRole("link", { name: "Montar pedido" }).first().click();
    await expect(page).toHaveURL("/pedidos/novo");
    await expect(page.getByRole("heading", { level: 1, name: "Montar pedido" })).toBeVisible();

    // Estrutura: as 5 colunas pedidas
    for (const name of ["Referência", "Descrição do Produto", "Valor Unitário", "Quantidade", "Valor Total"]) {
      await expect(page.getByRole("columnheader", { name })).toBeVisible();
    }
    await expect(page.getByTestId("empty-order")).toBeVisible();
    await expect(orderTotal(page)).toHaveText("R$ 0,00");

    // 1ª linha: camiseta 19,90 × 3 = 59,70
    await addViaPicker(page, `${prefix}-CAM`);
    await expect(lineTotal(page, `${prefix}-CAM`)).toHaveText("R$ 19,90"); // quantidade inicial 1
    await qty(page, `${prefix}-CAM`).fill("3");
    await expect(lineTotal(page, `${prefix}-CAM`)).toHaveText("R$ 59,70");
    await expect(orderTotal(page)).toHaveText("R$ 59,70");

    // 2ª linha: suco 7,35 × 12 = 88,20 → total 147,90 (adicionada só pelo teclado)
    // (o prefixo único evita pegar produtos de outros testes: o banco E2E é compartilhado)
    await picker(page).fill(`suco de uva ${prefix}`);
    await picker(page).press("Enter");
    await expect(qty(page, `${prefix}-SUC`)).toBeFocused();
    await qty(page, `${prefix}-SUC`).fill("12");
    await expect(lineTotal(page, `${prefix}-SUC`)).toHaveText("R$ 88,20");
    await expect(orderTotal(page)).toHaveText("R$ 147,90");

    // 3ª linha: café 25,00 × 2 = 50,00 → total 197,90
    await addViaPicker(page, `${prefix}-CAF`);
    await qty(page, `${prefix}-CAF`).fill("2");
    await expect(lineTotal(page, `${prefix}-CAF`)).toHaveText("R$ 50,00");
    await expect(orderTotal(page)).toHaveText("R$ 197,90");
    await expect(page.getByTestId("order-summary")).toHaveText("3 produto(s) · 17 unidade(s)");

    // Remover a 3ª linha desconta do total
    await page.getByRole("button", { name: `Remover ${prefix}-CAF` }).click();
    await expect(rowWith(page, `${prefix}-CAF`)).toHaveCount(0);
    await expect(orderTotal(page)).toHaveText("R$ 147,90");

    // Salvamento automático
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");

    // ── Persistência: recarregar a página mantém linhas, quantidades e totais ──
    await page.reload();
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("3");
    await expect(qty(page, `${prefix}-SUC`)).toHaveValue("12");
    await expect(rowWith(page, `${prefix}-CAF`)).toHaveCount(0);
    await expect(lineTotal(page, `${prefix}-CAM`)).toHaveText("R$ 59,70");
    await expect(lineTotal(page, `${prefix}-SUC`)).toHaveText("R$ 88,20");
    await expect(orderTotal(page)).toHaveText("R$ 147,90");
    // a ordem de montagem foi preservada (camiseta antes do suco)
    const refs = await page.getByRole("row").filter({ has: page.getByTestId("line-total") }).locator("td:first-child").allTextContents();
    expect(refs).toEqual([`${prefix}-CAM`, `${prefix}-SUC`]);

    // ── Limpar o pedido (confirmação) e conferir que o rascunho foi apagado ──
    const confirmed = answerNextConfirm(page, true);
    await page.getByRole("button", { name: "Limpar pedido" }).click();
    expect(await confirmed).toBe("Remover todos os itens do pedido?");
    await expect(page.getByTestId("empty-order")).toBeVisible();
    await expect(orderTotal(page)).toHaveText("R$ 0,00");
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");
    await page.reload();
    await expect(page.getByTestId("empty-order")).toBeVisible();
  });

  test("busca ignora acentos, não oferece produto desativado nem produto já adicionado", async ({ page }) => {
    const id = uniqueId();
    const prefix = `BUS${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), "/login?next=%2Fpedidos%2Fnovo");
    await expect(page).toHaveURL("/pedidos/novo");

    await picker(page).fill(`cafe especial ${prefix}`); // sem acento
    await expect(page.getByRole("option", { name: new RegExp(`${prefix}-CAF`) })).toBeVisible();

    await picker(page).fill(`${prefix}-OFF`);
    await expect(page.getByTestId("no-results")).toHaveText("Nenhum produto disponível encontrado.");

    await addViaPicker(page, `${prefix}-CAM`);
    await picker(page).fill(`${prefix}-CAM`);
    await expect(page.getByTestId("no-results")).toBeVisible(); // já está na tabela
    await picker(page).press("Escape");
    await expect(picker(page)).toHaveValue("");
  });

  test("quantidade inválida é sinalizada, não entra no total e não sobrescreve o rascunho salvo", async ({ page }) => {
    const id = uniqueId();
    const prefix = `INV${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CONSULTOR", id), "/login?next=%2Fpedidos%2Fnovo");
    const ref = `${prefix}-CAM`;

    await addViaPicker(page, ref);
    await qty(page, ref).fill("2");
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");
    await expect(orderTotal(page)).toHaveText("R$ 39,80");

    for (const bad of ["0", "abc", "10000", "1,5", ""]) {
      await qty(page, ref).fill(bad);
      await expect(rowWith(page, ref).getByRole("alert")).toHaveText("Informe um número inteiro de 1 a 9999.");
      await expect(qty(page, ref)).toHaveAttribute("aria-invalid", "true");
      await expect(lineTotal(page, ref)).toHaveText("—");
      await expect(orderTotal(page)).toHaveText("R$ 0,00");
      await expect(saveStatus(page)).toHaveText("Corrija as quantidades para salvar o rascunho");
    }

    // Recarregar com a quantidade inválida na tela: vale o último estado VÁLIDO salvo (2)
    await page.reload();
    await expect(qty(page, ref)).toHaveValue("2");
    await expect(orderTotal(page)).toHaveText("R$ 39,80");

    // Limites aceitos
    await qty(page, ref).fill("9999");
    await expect(lineTotal(page, ref)).toHaveText("R$ 198.980,10");
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");
    await qty(page, ref).fill("1");
    await expect(orderTotal(page)).toHaveText("R$ 19,90");
  });

  test("o pedido passa do limite do banco: alerta e nada é salvo", async ({ page }) => {
    const id = uniqueId();
    const prefix = `LIM${id}`;
    const { camiseta } = await createOrderCatalog(prefix);
    await setProductPrice(camiseta.id, 100_000_000); // R$ 1.000.000,00
    await login(page, await createE2eUser("CONSULTOR", id), "/login?next=%2Fpedidos%2Fnovo");
    const ref = `${prefix}-CAM`;

    await addViaPicker(page, ref);
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");
    await qty(page, ref).fill("30"); // R$ 30.000.000,00 > R$ 21.474.836,47
    await expect(page.getByText("O valor total do pedido excede o limite permitido.")).toBeVisible();
    await expect(saveStatus(page)).toHaveText("O total excede o limite permitido; reduza as quantidades");

    await page.reload(); // o último estado salvo (quantidade 1) permanece
    await expect(qty(page, ref)).toHaveValue("1");
    await expect(orderTotal(page)).toHaveText("R$ 1.000.000,00");
  });

  test("preço e disponibilidade vêm sempre do cadastro atual", async ({ page }) => {
    const id = uniqueId();
    const prefix = `ATU${id}`;
    const { camiseta, suco } = await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CONSULTOR", id), "/login?next=%2Fpedidos%2Fnovo");

    await addViaPicker(page, `${prefix}-CAM`);
    await qty(page, `${prefix}-CAM`).fill("2");
    await addViaPicker(page, `${prefix}-SUC`);
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");
    await expect(orderTotal(page)).toHaveText("R$ 47,15"); // 39,80 + 7,35

    // O admin mexe no catálogo: novo preço para um e desativa o outro
    await setProductPrice(camiseta.id, 2000);
    await setProductActive(suco.id, false);

    await page.reload();
    await expect(lineTotal(page, `${prefix}-CAM`)).toHaveText("R$ 40,00"); // 20,00 × 2
    await expect(rowWith(page, `${prefix}-SUC`)).toHaveCount(0);
    await expect(page.getByTestId("unavailable-notice")).toHaveText(
      "1 item do seu rascunho não está mais disponível e foi removido.",
    );
    await expect(orderTotal(page)).toHaveText("R$ 40,00");

    // O rascunho é regravado já limpo: no próximo carregamento o aviso não volta
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");
    await page.reload();
    await expect(page.getByTestId("unavailable-notice")).toHaveCount(0);
    await expect(orderTotal(page)).toHaveText("R$ 40,00");
  });
});

test.describe("integração vitrine → tabela", () => {
  test("'Adicionar ao pedido' na vitrine soma na tabela", async ({ page }) => {
    const id = uniqueId();
    const prefix = `ADD${id}`;
    await createOrderCatalog(prefix);
    await login(page, await createE2eUser("CLIENTE", id), `/login?next=${encodeURIComponent(`/?q=${prefix}`)}`);

    const card = page.getByTestId("product-card").filter({ hasText: `${prefix}-CAM` });
    const add = card.getByRole("button", { name: `Adicionar ${prefix}-CAM ao pedido` });
    await add.click();
    await expect(card.getByRole("status")).toContainText("No pedido: 1 un.");
    await add.click();
    await expect(card.getByRole("status")).toContainText("No pedido: 2 un.");

    await page.getByTestId("product-card").filter({ hasText: `${prefix}-SUC` }).getByRole("button", { name: /Adicionar/ }).click();
    await expect(page.getByTestId("product-card").filter({ hasText: `${prefix}-SUC` }).getByRole("status")).toContainText("No pedido: 1 un.");

    await expect(card.getByRole("link")).toHaveCount(0); // sem link abaixo do produto: o acesso é o botão do topo
    await page.getByTestId("home-header").getByRole("link", { name: "Montar pedido" }).click();
    await expect(page).toHaveURL("/pedidos/novo");
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("2");
    await expect(qty(page, `${prefix}-SUC`)).toHaveValue("1");
    await expect(lineTotal(page, `${prefix}-CAM`)).toHaveText("R$ 39,80");
    await expect(orderTotal(page)).toHaveText("R$ 47,15");

    // e continua editável na tabela, somando por cima do que veio da vitrine
    await qty(page, `${prefix}-CAM`).fill("5");
    await expect(orderTotal(page)).toHaveText("R$ 106,85"); // 99,50 + 7,35
  });
});

test.describe("rascunho: isolamento e persistência entre sessões", () => {
  test("é do usuário (outro usuário não o vê), e acompanha o usuário em outro navegador", async ({ page, browser }) => {
    const id = uniqueId();
    const prefix = `ISO${id}`;
    await createOrderCatalog(prefix);
    const owner = await createE2eUser("CONSULTOR", `${id}A`);
    const stranger = await createE2eUser("CONSULTOR", `${id}B`);

    await login(page, owner, "/login?next=%2Fpedidos%2Fnovo");
    await addViaPicker(page, `${prefix}-CAM`);
    await qty(page, `${prefix}-CAM`).fill("4");
    await expect(saveStatus(page)).toHaveText("Rascunho salvo");

    // Outro dispositivo, mesma conta: o rascunho está lá
    const otherDevice = await browser.newContext();
    const devicePage = await otherDevice.newPage();
    await login(devicePage, owner, "/login?next=%2Fpedidos%2Fnovo");
    await expect(qty(devicePage, `${prefix}-CAM`)).toHaveValue("4");
    await expect(orderTotal(devicePage)).toHaveText("R$ 79,60");
    await otherDevice.close();

    // Outro usuário: tabela vazia
    const strangerCtx = await browser.newContext();
    const strangerPage = await strangerCtx.newPage();
    await login(strangerPage, stranger, "/login?next=%2Fpedidos%2Fnovo");
    await expect(strangerPage.getByTestId("empty-order")).toBeVisible();
    await expect(orderTotal(strangerPage)).toHaveText("R$ 0,00");
    await strangerCtx.close();

    // Sair e entrar de novo não perde o rascunho
    await page.getByRole("button", { name: "Sair" }).click();
    await login(page, owner, "/login?next=%2Fpedidos%2Fnovo");
    await expect(qty(page, `${prefix}-CAM`)).toHaveValue("4");
  });
});

test.describe("acesso à tabela de pedido", () => {
  test("visitante abre a tabela sem login; quem entra continua na mesma tela", async ({ page }) => {
    await page.goto("/pedidos/novo");
    await expect(page).toHaveURL("/pedidos/novo"); // sem redirecionar ao login
    await expect(page.getByRole("heading", { level: 1, name: "Montar pedido" })).toBeVisible();
    await expect(page.getByTestId("empty-order")).toBeVisible();

    await login(page, TEST_USERS.cliente, `/login?next=${encodeURIComponent("/pedidos/novo")}`);
    await expect(page).toHaveURL("/pedidos/novo");
    await expect(page.getByRole("heading", { level: 1, name: "Montar pedido" })).toBeVisible();
  });
});
