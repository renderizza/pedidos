import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS, type TestUser } from "../setup/test-users";

async function login(page: Page, user: Pick<TestUser, "email" | "password">, path = "/login") {
  await page.goto(path);
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("login por perfil", () => {
  test("ADMIN entra e cai no painel administrativo", async ({ page }) => {
    await login(page, TEST_USERS.admin);

    await expect(page).toHaveURL("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Painel Administrativo" })).toBeVisible();
    await expect(page.getByTestId("user-name")).toHaveText(TEST_USERS.admin.name);
    await expect(page.getByTestId("user-role")).toHaveText("ADMIN");
    await expect(page.getByRole("link", { name: "Painel administrativo" })).toBeVisible();
  });

  for (const key of ["consultor", "cliente"] as const) {
    const user = TEST_USERS[key];

    test(`${user.role} entra, cai na vitrine e não vê o painel administrativo`, async ({ page }) => {
      await login(page, user);

      await expect(page).toHaveURL("/");
      await expect(page.getByTestId("user-name")).toHaveText(user.name);
      await expect(page.getByTestId("user-role")).toHaveText(user.role);
      await expect(page.getByRole("link", { name: "Painel administrativo" })).toHaveCount(0);
    });

    test(`${user.role} recebe 403 ao tentar abrir /admin`, async ({ page }) => {
      await login(page, user);
      await expect(page).toHaveURL("/");

      const response = await page.goto("/admin");
      expect(response?.status()).toBe(403);
      await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toHaveCount(0);
    });
  }
});

test.describe("credenciais e validação", () => {
  test("senha incorreta mostra erro genérico e mantém o usuário no login", async ({ page }) => {
    await login(page, { email: TEST_USERS.admin.email, password: "senha-errada-123" });

    await expect(page.getByTestId("login-error")).toHaveText("E-mail ou senha incorretos");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("E-mail")).toHaveValue(TEST_USERS.admin.email);
    await expect(page.getByLabel("Senha")).toHaveValue("");
    await expect(page.getByTestId("user-role")).toHaveCount(0);
  });

  test("e-mail inexistente mostra a mesma mensagem", async ({ page }) => {
    await login(page, { email: "ninguem@teste.com", password: "qualquer-senha" });
    await expect(page.getByTestId("login-error")).toHaveText("E-mail ou senha incorretos");
  });

  test("campos vazios mostram erros de validação (Zod)", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText("E-mail é obrigatório")).toBeVisible();
    await expect(page.getByText("Senha é obrigatória")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("proteção de rotas", () => {
  test("visitante em /admin vai ao login e volta ao /admin depois de entrar", async ({ page }) => {
    await page.goto("/admin");

    await expect(page).toHaveURL("/login?next=%2Fadmin");
    await page.getByLabel("E-mail").fill(TEST_USERS.admin.email);
    await page.getByLabel("Senha").fill(TEST_USERS.admin.password);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL("/admin");
    await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
  });

  test("cookie de sessão forjado não dá acesso (a validação real é no servidor)", async ({ page, context }) => {
    await context.addCookies([{ name: "pedidos_session", value: "forjado", url: "http://localhost:3100" }]);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toHaveCount(0);
  });

  test("usuário já logado que abre /login é levado à sua página inicial", async ({ page }) => {
    await login(page, TEST_USERS.admin);
    await expect(page).toHaveURL("/admin");

    await page.goto("/login");
    await expect(page).toHaveURL("/admin");
  });

  test("parâmetro next externo é ignorado (sem open redirect)", async ({ page }) => {
    await login(page, TEST_USERS.consultor, "/login?next=https%3A%2F%2Fevil.example");

    await expect(page).toHaveURL("/");
    expect(new URL(page.url()).hostname).toBe("localhost");
  });
});

test.describe("sessão", () => {
  test("o cookie de sessão é httpOnly, Secure (build de produção) e SameSite=Lax", async ({ page, context }) => {
    await login(page, TEST_USERS.cliente);
    await expect(page).toHaveURL("/");

    const cookie = (await context.cookies()).find((c) => c.name === "pedidos_session");
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");
    expect(await page.evaluate(() => document.cookie)).not.toContain("pedidos_session");
  });

  test("sair encerra a sessão: header volta ao visitante e /admin exige novo login", async ({ page }) => {
    await login(page, TEST_USERS.admin);
    await expect(page).toHaveURL("/admin");

    await page.getByRole("button", { name: "Sair" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible(); // formulário de login
    await expect(page.getByTestId("user-role")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(0);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a sessão antiga deixa de valer após o logout (token revogado no banco)", async ({ page, context }) => {
    await login(page, TEST_USERS.admin);
    await expect(page).toHaveURL("/admin");
    const [oldCookie] = (await context.cookies()).filter((c) => c.name === "pedidos_session");

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Reapresenta o cookie antigo, como faria quem o tivesse copiado.
    await context.addCookies([oldCookie]);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });
});
