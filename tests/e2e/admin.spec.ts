import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import { seedProducts } from "./e2e-db";
import { answerNextConfirm, expectForbidden, login, rowWith, uniqueId } from "./helpers";

test.describe("fluxo do ADMIN: categorias e produtos", () => {
  test("cadastra categoria e produto, edita, filtra e exclui", async ({ page }) => {
    const id = uniqueId();
    const categoryName = `Bebidas ${id}`;
    const reference = `E2E-${id}`;

    await login(page, TEST_USERS.admin);
    await expect(page).toHaveURL("/admin");
    await expect(page.getByTestId("stat-categories")).toBeVisible();
    await expect(page.getByTestId("stat-products")).toBeVisible();

    // ── Categoria ──────────────────────────────────────────────────────────
    await page.getByRole("navigation", { name: "Administração" }).getByRole("link", { name: "Categorias" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Categorias" })).toBeVisible();
    await page.getByRole("link", { name: "Nova categoria" }).click();
    await page.getByLabel("Nome da categoria").fill(categoryName);
    await page.getByRole("button", { name: "Criar categoria" }).click();

    await expect(page).toHaveURL(/\/admin\/categorias\?status=created$/);
    await expect(page.getByTestId("flash-message")).toHaveText("Cadastro realizado com sucesso.");
    await expect(rowWith(page, categoryName)).toContainText("0"); // nenhum produto ainda

    // ── Produto ────────────────────────────────────────────────────────────
    await page.getByRole("navigation", { name: "Administração" }).getByRole("link", { name: "Produtos" }).click();
    await page.getByRole("link", { name: "Novo produto" }).click();
    await page.getByLabel("Referência").fill(reference.toLowerCase()); // será gravada em maiúsculas
    await page.getByLabel("Descrição").fill("Suco de uva integral 1L");
    await page.getByLabel("Preço (R$)").fill("1.234,56");
    await page.getByLabel("Categoria").selectOption({ label: categoryName });
    await expect(page.getByRole("checkbox", { name: /produto ativo/i })).toBeChecked();
    await page.getByRole("button", { name: "Criar produto" }).click();

    await expect(page).toHaveURL(/\/admin\/produtos\?status=created$/);
    await expect(page.getByTestId("flash-message")).toBeVisible();
    // A lista sem filtro é paginada e o banco E2E acumula produtos de outros testes:
    // filtramos pela referência para achar a linha independentemente da página.
    await page.goto(`/admin/produtos?q=${reference}`);
    const productRow = rowWith(page, reference);
    await expect(productRow).toContainText(reference);
    await expect(productRow).toContainText("Suco de uva integral 1L");
    await expect(productRow).toContainText("R$ 1.234,56");
    await expect(productRow).toContainText(categoryName);
    await expect(productRow).toContainText("Ativo");

    // ── Categoria em uso não pode ser excluída ─────────────────────────────
    await page.goto("/admin/categorias");
    await expect(rowWith(page, categoryName)).toContainText("1");
    const confirmMessage = answerNextConfirm(page, true);
    await rowWith(page, categoryName).getByRole("button", { name: "Excluir" }).click();
    expect(await confirmMessage).toContain(categoryName);
    await expect(rowWith(page, categoryName).getByRole("alert")).toContainText("possui 1 produto(s)");
    await expect(rowWith(page, categoryName)).toHaveCount(1);

    // ── Editar produto ─────────────────────────────────────────────────────
    await page.goto(`/admin/produtos?q=${reference}`);
    await rowWith(page, reference).getByRole("link", { name: "Editar" }).click();
    await expect(page.getByRole("heading", { name: "Editar produto" })).toBeVisible();
    await expect(page.getByLabel("Referência")).toHaveValue(reference);
    await expect(page.getByLabel("Preço (R$)")).toHaveValue("1234,56");
    await expect(page.getByLabel("Categoria")).toHaveValue(/.+/);
    await page.getByLabel("Preço (R$)").fill("20");
    await page.getByRole("checkbox", { name: /produto ativo/i }).uncheck();
    await page.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(page).toHaveURL(/\/admin\/produtos\?status=updated$/);
    await expect(page.getByTestId("flash-message")).toHaveText("Alterações salvas com sucesso.");

    // ── Filtros ────────────────────────────────────────────────────────────
    await page.goto("/admin/produtos");
    await page.getByLabel("Buscar").fill(reference);
    await page.getByLabel("Situação").selectOption("inativos");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(rowWith(page, reference)).toContainText("R$ 20,00");
    await expect(rowWith(page, reference)).toContainText("Inativo");
    await expect(page.getByTestId("result-count")).toHaveText("1 produto(s)");

    await page.getByLabel("Situação").selectOption("ativos");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByTestId("empty-state")).toHaveText("Nenhum produto encontrado para esses filtros.");
    await page.getByRole("link", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL("/admin/produtos");

    // ── Excluir produto e depois a categoria ───────────────────────────────
    await page.goto(`/admin/produtos?q=${reference}`);
    void answerNextConfirm(page, true);
    await rowWith(page, reference).getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByTestId("empty-state")).toBeVisible();

    await page.goto("/admin/categorias");
    void answerNextConfirm(page, true);
    await rowWith(page, categoryName).getByRole("button", { name: "Excluir" }).click();
    await expect(rowWith(page, categoryName)).toHaveCount(0);
  });

  test("editar categoria e cancelar uma exclusão", async ({ page }) => {
    const id = uniqueId();
    const original = `Roupas ${id}`;
    const renamed = `Vestuário ${id}`;
    await login(page, TEST_USERS.admin);

    await page.goto("/admin/categorias/nova");
    await page.getByLabel("Nome da categoria").fill(original);
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(rowWith(page, original)).toBeVisible();

    await rowWith(page, original).getByRole("link", { name: "Editar" }).click();
    await expect(page.getByLabel("Nome da categoria")).toHaveValue(original);
    await page.getByLabel("Nome da categoria").fill(renamed);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByTestId("flash-message")).toHaveText("Alterações salvas com sucesso.");
    await expect(rowWith(page, renamed)).toBeVisible();
    await expect(rowWith(page, original)).toHaveCount(0);

    // Cancelar a confirmação NÃO exclui.
    const dismissed = answerNextConfirm(page, false);
    await rowWith(page, renamed).getByRole("button", { name: "Excluir" }).click();
    expect(await dismissed).toContain(renamed); // o diálogo apareceu e foi recusado
    await expect(rowWith(page, renamed)).toHaveCount(1);

    // limpeza
    void answerNextConfirm(page, true);
    await rowWith(page, renamed).getByRole("button", { name: "Excluir" }).click();
    await expect(rowWith(page, renamed)).toHaveCount(0);
  });
});

test.describe("validação nos formulários (Zod)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.admin);
  });

  test("categoria: vazia, curta e duplicada", async ({ page }) => {
    const name = `Duplicada ${uniqueId()}`;
    await page.goto("/admin/categorias/nova");

    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page.getByText("Nome da categoria é obrigatório")).toBeVisible();
    await expect(page.getByLabel("Nome da categoria")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Nome da categoria").fill("A");
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page.getByText("deve ter ao menos 2 caracteres")).toBeVisible();
    await expect(page.getByLabel("Nome da categoria")).toHaveValue("A"); // mantém o digitado

    await page.getByLabel("Nome da categoria").fill(name);
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page).toHaveURL(/status=created/);

    await page.goto("/admin/categorias/nova");
    await page.getByLabel("Nome da categoria").fill(name.toLowerCase());
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page.getByText(/Já existe uma categoria/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/categorias\/nova$/);

    // limpeza
    await page.goto("/admin/categorias");
    void answerNextConfirm(page, true);
    await rowWith(page, name).getByRole("button", { name: "Excluir" }).click();
    await expect(rowWith(page, name)).toHaveCount(0);
  });

  test("produto: obrigatórios, preço inválido e referência duplicada preservam o digitado", async ({ page }) => {
    const id = uniqueId();
    const categoryName = `Cat ${id}`;
    const reference = `DUP-${id}`;

    await page.goto("/admin/categorias/nova");
    await page.getByLabel("Nome da categoria").fill(categoryName);
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(rowWith(page, categoryName)).toBeVisible();

    // campos obrigatórios (Referência, Descrição e Preço)
    await page.goto("/admin/produtos/novo");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page.getByText("Referência é obrigatório")).toBeVisible();
    await expect(page.getByText("Descrição é obrigatório")).toBeVisible();
    await expect(page.getByText("Preço é obrigatório")).toBeVisible();

    // preço inválido: demais campos (inclusive a categoria escolhida) continuam preenchidos
    await page.getByLabel("Referência").fill(reference);
    await page.getByLabel("Descrição").fill("Produto para teste de validação");
    await page.getByLabel("Preço (R$)").fill("doze reais");
    await page.getByLabel("Categoria").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page.getByText("Preço inválido. Use o formato 12,50")).toBeVisible();
    await expect(page.getByLabel("Referência")).toHaveValue(reference);
    await expect(page.getByLabel("Descrição")).toHaveValue("Produto para teste de validação");
    await expect(page.getByLabel("Preço (R$)")).toHaveValue("doze reais");
    await expect(page.getByLabel("Categoria").locator("option:checked")).toHaveText(categoryName);

    await page.getByLabel("Preço (R$)").fill("0");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page.getByText("Preço deve ser maior que zero")).toBeVisible();

    // sucesso e, em seguida, referência duplicada
    await page.getByLabel("Preço (R$)").fill("9,90");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page).toHaveURL(/status=created/);

    await page.goto("/admin/produtos/novo");
    await page.getByLabel("Referência").fill(reference.toLowerCase());
    await page.getByLabel("Descrição").fill("Outro produto, mesma referência");
    await page.getByLabel("Preço (R$)").fill("5,00");
    await page.getByRole("checkbox", { name: /produto ativo/i }).uncheck();
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page.getByText(`Já existe um produto com a referência ${reference}`)).toBeVisible();
    await expect(page.getByLabel("Descrição")).toHaveValue("Outro produto, mesma referência");
    await expect(page.getByRole("checkbox", { name: /produto ativo/i })).not.toBeChecked();

    // limpeza: produto e categoria
    await page.goto(`/admin/produtos?q=${reference}`);
    void answerNextConfirm(page, true);
    await rowWith(page, reference).getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.goto("/admin/categorias");
    void answerNextConfirm(page, true);
    await rowWith(page, categoryName).getByRole("button", { name: "Excluir" }).click();
    await expect(rowWith(page, categoryName)).toHaveCount(0);
  });

  test("ids inexistentes ou malformados nas telas de edição respondem 404", async ({ page }) => {
    for (const path of [
      `/admin/produtos/${randomUUID()}/editar`,
      "/admin/produtos/nao-e-uuid/editar",
      `/admin/categorias/${randomUUID()}/editar`,
      "/admin/categorias/nao-e-uuid/editar",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe("lista de produtos: busca e paginação", () => {
  test("pagina 12 resultados em 2 páginas preservando a busca", async ({ page }) => {
    const prefix = `PAG${uniqueId()}`;
    await seedProducts(prefix, 12);
    await login(page, TEST_USERS.admin);

    await page.goto("/admin/produtos");
    await page.getByLabel("Buscar").fill(prefix);
    await page.getByRole("button", { name: "Filtrar" }).click();

    await expect(page.getByTestId("result-count")).toHaveText("12 produto(s)");
    await expect(page.getByTestId("pagination-status")).toHaveText("Página 1 de 2");
    await expect(page.getByRole("row")).toHaveCount(11); // cabeçalho + 10 itens
    await expect(rowWith(page, `${prefix}-01`)).toBeVisible();
    await expect(rowWith(page, `${prefix}-11`)).toHaveCount(0);

    await page.getByRole("link", { name: "Próxima" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${prefix}.*pagina=2|pagina=2.*q=${prefix}`));
    await expect(page.getByTestId("pagination-status")).toHaveText("Página 2 de 2");
    await expect(page.getByRole("row")).toHaveCount(3); // cabeçalho + 2 itens
    await expect(rowWith(page, `${prefix}-12`)).toBeVisible();

    await page.getByRole("link", { name: "Anterior" }).click();
    await expect(page.getByTestId("pagination-status")).toHaveText("Página 1 de 2");
  });

  test("página fora do intervalo é ajustada e busca com % é literal", async ({ page }) => {
    const prefix = `LIT${uniqueId()}`;
    await seedProducts(prefix, 2);
    await login(page, TEST_USERS.admin);

    await page.goto(`/admin/produtos?q=${prefix}&pagina=99`);
    await expect(page.getByTestId("pagination-status")).toHaveCount(0); // 1 página só
    await expect(page.getByTestId("result-count")).toHaveText("2 produto(s)");

    await page.goto(`/admin/produtos?q=${encodeURIComponent(`${prefix}%`)}`);
    await expect(page.getByTestId("empty-state")).toBeVisible(); // "%" não vira curinga
  });
});

test.describe("controle de acesso às telas administrativas", () => {
  const PROTECTED = ["/admin/categorias", "/admin/categorias/nova", "/admin/produtos", "/admin/produtos/novo"];

  for (const key of ["consultor", "cliente"] as const) {
    test(`${TEST_USERS[key].role} recebe 403 em todas as telas do painel`, async ({ page }) => {
      await login(page, TEST_USERS[key]);
      await expect(page).toHaveURL("/");
      for (const path of PROTECTED) await expectForbidden(page, path);
      await expect(page.getByRole("link", { name: "Novo produto" })).toHaveCount(0);
    });
  }

  test("visitante é enviado ao login e volta à tela pedida depois de entrar", async ({ page }) => {
    for (const path of PROTECTED) {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    }

    await login(page, TEST_USERS.admin, `/login?next=${encodeURIComponent("/admin/produtos")}`);
    await expect(page).toHaveURL("/admin/produtos");
    await expect(page.getByRole("heading", { level: 1, name: "Produtos" })).toBeVisible();
  });
});
