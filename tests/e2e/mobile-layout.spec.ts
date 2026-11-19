/**
 * Layout em celular. Regressões que já aconteceram: cabeçalho de quem está logado estourando a tela,
 * tabelas mais largas que a tela e campos com fonte menor que 16px (o iOS dá zoom ao focar).
 * Abaixo de 640px (breakpoint "sm" do Tailwind) as tabelas viram cartões empilhados.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import { createE2eUser, createOrderCatalog, placeOrderFor } from "./e2e-db";
import { login, uniqueId } from "./helpers";

const WIDTHS = [320, 360];

/** Quantos pixels o conteúdo passa da largura da janela (0 = nada estoura). */
const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/*
 * Peso do teste: criar usuário e entrar usam scrypt (de propósito, é lento), e esta suíte roda ao lado de
 * outros 4 workers. Por isso os dados são criados UMA vez por worker e cada perfil entra UMA vez; os testes
 * só abrem contextos novos já autenticados, no tamanho de tela que precisam.
 */
let sharedData: Promise<{ prefix: string; consultor: Awaited<ReturnType<typeof createE2eUser>>; order: Awaited<ReturnType<typeof placeOrderFor>> }> | undefined;

function setup() {
  sharedData ??= (async () => {
    const id = uniqueId();
    const prefix = `MOB${id}`;
    const { camiseta } = await createOrderCatalog(prefix);
    const consultor = await createE2eUser("CONSULTOR", id);
    const order = await placeOrderFor(consultor.id, [{ productId: camiseta.id, priceCents: 1990, quantity: 3 }], {
      customerName: `Cliente Com Nome Bem Comprido Para Testar Quebra ${id}`,
    });
    return { prefix, consultor, order };
  })();
  return sharedData;
}

const sessions = new Map<string, Promise<Awaited<ReturnType<BrowserContext["storageState"]>>>>();

/** Abre uma página já logada como `who` (login feito uma vez por worker), com o tamanho de tela pedido. */
async function openAs(browser: Browser, who: "admin" | "consultor", width: number) {
  const { consultor } = await setup();
  const credentials = who === "admin" ? TEST_USERS.admin : consultor;
  if (!sessions.has(who)) {
    sessions.set(
      who,
      (async () => {
        const context = await browser.newContext();
        await login(await context.newPage(), credentials);
        const state = await context.storageState();
        await context.close();
        return state;
      })(),
    );
  }
  const context = await browser.newContext({ storageState: await sessions.get(who)!, viewport: { width, height: 800 } });
  return { context, page: await context.newPage() };
}

test.describe("celular: nada passa da largura da tela", () => {
  for (const width of WIDTHS) {
    test(`visitante, a ${width}px: vitrine, login e montagem do pedido com itens`, async ({ page }) => {
      const { prefix } = await setup();
      await page.setViewportSize({ width, height: 800 });

      await page.goto(`/?q=${prefix}`);
      await expect(page.getByTestId("product-card").first()).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);

      await page.getByRole("button", { name: `Adicionar ${prefix}-CAM ao pedido` }).click();
      await expect(page.getByTestId("home-header").getByRole("link", { name: "Ver pedido" })).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);

      await page.goto("/pedidos/novo");
      await expect(page.getByLabel(`Quantidade de ${prefix}-CAM`)).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);

      await page.goto("/login");
      expect(await horizontalOverflow(page)).toBe(0);
    });

    test(`consultor, a ${width}px: cabeçalho, lista, detalhe e montagem do pedido`, async ({ browser }) => {
      const { prefix, order } = await setup();
      const { context, page } = await openAs(browser, "consultor", width);
      try {
        for (const path of ["/", "/pedidos", `/pedidos/${order.orderId}`, "/pedidos/novo"]) {
          await page.goto(path);
          expect(await horizontalOverflow(page), path).toBe(0);
        }

        await page.goto("/pedidos/novo");
        await page.getByRole("combobox", { name: "Adicionar produto" }).fill(`${prefix}-CAM`);
        await page.getByRole("option", { name: new RegExp(`${prefix}-CAM`) }).click();
        await expect(page.getByLabel(`Quantidade de ${prefix}-CAM`)).toBeVisible();
        expect(await horizontalOverflow(page)).toBe(0);
      } finally {
        await context.close();
      }
    });

    test(`admin, a ${width}px: painel, produtos, categorias e todos os pedidos`, async ({ browser }) => {
      const { context, page } = await openAs(browser, "admin", width);
      try {
        for (const path of ["/admin", "/admin/produtos", "/admin/produtos/novo", "/admin/categorias", "/admin/categorias/nova", "/pedidos"]) {
          await page.goto(path);
          expect(await horizontalOverflow(page), path).toBe(0);
        }
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("celular: cabeçalho", () => {
  test("marca e 'Sair' ficam na primeira linha, os links logo abaixo, e tudo cabe na tela", async ({ browser }) => {
    const { context, page } = await openAs(browser, "admin", 320);
    await page.goto("/admin");

    const viewport = page.viewportSize()!;
    const header = page.locator("header").first();
    const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;

    const brand = await box(header.getByRole("link", { name: "Sistema de Pedidos" }));
    const logout = await box(header.getByRole("button", { name: "Sair" }));
    const role = await box(header.getByTestId("user-role"));
    const links = await box(header.getByRole("link", { name: "Painel administrativo" }));

    for (const element of [brand, logout, role, links]) expect(element.x + element.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(brand.y - logout.y)).toBeLessThan(30); //  mesma linha
    expect(links.y).toBeGreaterThan(brand.y + brand.height - 1); //  links abaixo
    await expect(header.getByTestId("user-name")).toBeHidden(); //  o nome só aparece a partir de "sm"

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(header.getByTestId("user-name")).toBeVisible(); //  no desktop volta tudo numa linha
    const desktopBrand = await box(header.getByRole("link", { name: "Sistema de Pedidos" }));
    const desktopLogout = await box(header.getByRole("button", { name: "Sair" }));
    const desktopLinks = await box(header.getByRole("link", { name: "Painel administrativo" }));
    expect(Math.abs(desktopBrand.y - desktopLogout.y)).toBeLessThan(10);
    expect(Math.abs(desktopBrand.y - desktopLinks.y)).toBeLessThan(10);
    await context.close();
  });
});

test.describe("celular: tabelas viram cartões empilhados", () => {
  test("a lista de pedidos vira cartões com rótulo por campo e volta a ser tabela no desktop", async ({ browser }) => {
    const { order } = await setup();
    const { context, page } = await openAs(browser, "admin", 1280);

    const orderRow = () => page.getByRole("row", { name: new RegExp(`#${order.orderNumber}\\b`) });
    const display = (locator: ReturnType<Page["locator"]>, pseudo?: string) =>
      locator.evaluate((el, p) => getComputedStyle(el, p ?? null).getPropertyValue(p ? "content" : "display"), pseudo);

    // desktop: tabela de verdade
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/pedidos");
    expect(await display(orderRow())).toBe("table-row");
    await expect(page.getByRole("columnheader", { name: "Cliente" })).toBeVisible();

    // celular: cartão (grade), cabeçalho escondido de quem enxerga mas ainda na árvore de acessibilidade
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/pedidos");
    expect(await display(orderRow())).toBe("grid");
    const headerBox = (await page.locator("table[aria-label='Pedidos'] thead").boundingBox())!;
    expect(headerBox.width).toBeLessThanOrEqual(1);
    await expect(page.getByRole("columnheader", { name: "Cliente" })).toHaveCount(1); // semântica preservada

    // rótulo de cada campo vem do CSS (data-label), acima do valor
    const customerCell = orderRow().getByRole("cell").nth(2);
    expect(await display(customerCell, "::before")).toBe('"Cliente"');
    expect(await orderRow().getByRole("cell").first().getAttribute("data-label")).toBe("Nº");

    // nome de cliente bem comprido quebra linha dentro do cartão, sem estourar
    const card = (await orderRow().boundingBox())!;
    const cell = (await customerCell.boundingBox())!;
    expect(cell.x + cell.width).toBeLessThanOrEqual(card.x + card.width);
    await context.close();
  });

  test("a montagem do pedido vira cartões: quantidade editável, campo com 16px e total do pedido visível", async ({ browser }) => {
    const { prefix } = await setup();
    const { context, page } = await openAs(browser, "consultor", 360);
    await page.goto("/pedidos/novo");

    await page.getByRole("combobox", { name: "Adicionar produto" }).fill(`${prefix}-CAM`);
    await page.getByRole("option", { name: new RegExp(`${prefix}-CAM`) }).click();

    const qty = page.getByLabel(`Quantidade de ${prefix}-CAM`);
    await qty.fill("4");
    await expect(page.getByTestId("line-total")).toHaveText("R$ 79,60");
    await expect(page.getByTestId("order-total")).toHaveText("R$ 79,60");

    // campos com no mínimo 16px: abaixo disso o iOS dá zoom na página ao focar
    expect(await qty.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.getByRole("combobox", { name: "Adicionar produto" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

    // a quantidade e o botão de remover ficam dentro da janela (nada exige rolar para os lados)
    const viewport = page.viewportSize()!;
    for (const locator of [qty, page.getByRole("button", { name: `Remover ${prefix}-CAM` })]) {
      const box = (await locator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await context.close();
  });
});

test.describe("celular: áreas de toque", () => {
  test("'Adicionar ao pedido' tem pelo menos 40px de altura no celular e o compacto no desktop", async ({ page }) => {
    const { prefix } = await setup();
    const button = () => page.getByRole("button", { name: `Adicionar ${prefix}-CAM ao pedido` });

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/?q=${prefix}`);
    expect((await button().boundingBox())!.height).toBeGreaterThanOrEqual(40);

    await page.setViewportSize({ width: 1280, height: 800 });
    expect((await button().boundingBox())!.height).toBeLessThan(40);
  });

  test("os filtros ocupam a largura toda no celular", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    const search = (await page.getByLabel("Buscar").boundingBox())!;
    expect(search.width).toBeGreaterThan(360 - 2 * 16 - 4); // 360 − margens de 16px de cada lado
  });
});
