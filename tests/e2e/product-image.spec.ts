import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { TEST_USERS } from "../setup/test-users";
import { login, rowWith, uniqueId } from "./helpers";

/**
 * Imagem de produto vinda do Google Drive. O Google é interceptado (sem rede, resultado determinístico):
 * "arquivo público" devolve um PNG; "arquivo não compartilhado" recusa a requisição.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const GOOGLE_IMAGES = "https://lh3.googleusercontent.com/**";

async function serveGoogleImages(context: BrowserContext, mode: "public" | "denied", requested: string[] = []) {
  await context.route(GOOGLE_IMAGES, (route) => {
    requested.push(route.request().url());
    return mode === "public" ? route.fulfill({ contentType: "image/png", body: PNG_1X1 }) : route.abort("failed");
  });
  return requested;
}

/** A imagem terminou de carregar de verdade (não é só um <img> no HTML). */
async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
}

async function createProduct(page: Page, reference: string, imageUrl: string) {
  await page.goto("/admin/produtos/novo");
  await page.getByLabel("Referência").fill(reference);
  await page.getByLabel("Descrição").fill(`Produto com imagem ${reference}`);
  await page.getByLabel("Preço (R$)").fill("12,50");
  await page.getByLabel("URL da imagem (opcional)").fill(imageUrl);
}

test.describe("imagem do produto (Google Drive)", () => {
  test("cadastra com o link de compartilhamento do Drive e a imagem aparece na lista, na vitrine e no pedido", async ({
    page,
    browser,
  }, testInfo) => {
    const id = uniqueId();
    const reference = `IMG-${id}`;
    const fileId = `1${id}AbCdEfGhIjKl`;
    const shareLink = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    const direct = `https://lh3.googleusercontent.com/d/${fileId}`;
    await serveGoogleImages(page.context(), "public");

    await login(page, TEST_USERS.admin);
    await createProduct(page, reference, shareLink);

    // Prévia: aparece ao sair do campo e usa o endereço já convertido (e não a página HTML do link de compartilhamento).
    await page.getByLabel("Preço (R$)").click();
    await expectLoaded(page.getByTestId("image-preview").locator("img"));
    await expect(page.getByTestId("image-preview").locator("img")).toHaveAttribute("src", `${direct}=w80`);

    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page).toHaveURL(/\/admin\/produtos\?status=created$/);

    // Lista do admin: miniatura carregada.
    await page.goto(`/admin/produtos?q=${reference}`);
    await expectLoaded(rowWith(page, reference).getByTestId("product-image").locator("img"));

    // Edição: o campo mostra o endereço direto (já convertido) e a imagem cadastrada na prévia.
    await rowWith(page, reference).getByRole("link", { name: "Editar" }).click();
    await expect(page.getByLabel("URL da imagem (opcional)")).toHaveValue(direct);
    await expectLoaded(page.getByTestId("image-preview").locator("img"));

    // Vitrine e montagem de pedido, como VISITANTE (sem login).
    const guestContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    await serveGoogleImages(guestContext, "public");
    const guest = await guestContext.newPage();

    await guest.goto(`/?q=${reference}`);
    const card = guest.getByTestId("product-card").filter({ hasText: reference });
    const cardImage = card.getByTestId("product-image").locator("img");
    await expectLoaded(cardImage);
    await expect(cardImage).toHaveAttribute("src", `${direct}=w400`);
    await expect(cardImage).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(cardImage).toHaveAttribute("loading", "lazy");

    await guest.goto("/pedidos/novo");
    await guest.getByRole("combobox", { name: "Adicionar produto" }).fill(reference);
    await expectLoaded(guest.getByRole("option").first().locator("img"));
    await guest.getByRole("option").first().click();
    await expectLoaded(guest.getByRole("row", { name: new RegExp(reference) }).locator("img"));

    await guestContext.close();
  });

  test("arquivo não compartilhado: tenta a miniatura e o endereço puro, e mostra um espaço reservado (sem imagem quebrada)", async ({
    page,
    browser,
  }, testInfo) => {
    const id = uniqueId();
    const reference = `NOIMG-${id}`;
    const fileId = `1${id}ZyXwVuTsRqPo`;

    await login(page, TEST_USERS.admin);
    await createProduct(page, reference, `https://drive.google.com/open?id=${fileId}`);
    // Regressão: o link é preenchido e "Criar produto" clicado DIRETO, sem sair do campo antes. O blur que atualiza a
    // prévia acontece no mesmo instante do clique; se a prévia empurrasse o botão, o clique se perdia (o usuário
    // precisava clicar duas vezes). Esta é a ordem exata de quem cola o link e salva.
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page).toHaveURL(/\/admin\/produtos\?status=created$/);

    // Visitante, com o Google recusando a imagem (arquivo sem "Qualquer pessoa com o link", apagado ou sem cota).
    const guestContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const requested = await serveGoogleImages(guestContext, "denied");
    const guest = await guestContext.newPage();

    await guest.goto(`/?q=${reference}`);
    const card = guest.getByTestId("product-card").filter({ hasText: reference });
    await expect(card.getByTestId("product-image-fallback")).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0); // nada de ícone de imagem quebrada
    expect(requested).toContain(`https://lh3.googleusercontent.com/d/${fileId}=w400`);
    expect(requested).toContain(`https://lh3.googleusercontent.com/d/${fileId}`);

    // O pedido continua utilizável: o produto entra normalmente, só sem miniatura.
    await card.getByRole("button", { name: `Adicionar ${reference} ao pedido` }).click();
    await guest.goto("/pedidos/novo");
    await expect(guest.getByRole("row", { name: new RegExp(reference) })).toBeVisible();
    await expect(guest.getByRole("row", { name: new RegExp(reference) }).locator("img")).toHaveCount(0);

    await guestContext.close();
  });

  test("endereço inválido: mostra o motivo no campo, mantém o que foi digitado e não cadastra", async ({ page }) => {
    const reference = `BAD-${uniqueId()}`;
    await login(page, TEST_USERS.admin);

    await createProduct(page, reference, "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz");
    await page.getByLabel("Preço (R$)").click();
    await expect(page.getByTestId("image-preview-warning")).toContainText("pasta do Google Drive");

    await page.getByLabel("URL da imagem (opcional)").fill("http://exemplo.com/a.jpg");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page.locator("#field-imageUrl-error")).toHaveText("O endereço da imagem deve começar com https://");
    await expect(page.getByLabel("URL da imagem (opcional)")).toHaveValue("http://exemplo.com/a.jpg");
    await expect(page.getByLabel("Referência")).toHaveValue(reference);
    await expect(page).toHaveURL(/\/admin\/produtos\/novo$/);

    await page.goto(`/admin/produtos?q=${reference}`);
    await expect(page.getByTestId("empty-state")).toBeVisible();
  });

  test("a imagem é opcional: produto sem imagem não ganha espaço de imagem na vitrine", async ({ page }) => {
    const reference = `PLAIN-${uniqueId()}`;
    await login(page, TEST_USERS.admin);
    await createProduct(page, reference, "");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page).toHaveURL(/\/admin\/produtos\?status=created$/);

    await page.goto(`/?q=${reference}`);
    const card = page.getByTestId("product-card").filter({ hasText: reference });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("product-image")).toHaveCount(0);
    await expect(card.getByTestId("product-image-fallback")).toHaveCount(0);
  });
});
