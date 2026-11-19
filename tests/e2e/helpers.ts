import { expect, type Page } from "@playwright/test";
import type { TestUser } from "../setup/test-users";

export async function login(page: Page, user: Pick<TestUser, "email" | "password">, path = "/login") {
  await page.goto(path);
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Sem esta espera, o próximo page.goto() corre contra a Server Action de login ainda em andamento
  // (o cookie de sessão pode não ter sido gravado) e cai de volta em /login.
  await page.waitForURL((url) => url.pathname !== "/login");
}

/** Sufixo único por execução: o banco E2E é compartilhado entre workers e entre rodadas. */
export function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

/** Linha da tabela que contém o texto (referência, nome de categoria...). */
export function rowWith(page: Page, text: string) {
  return page.getByRole("row", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
}

/** Aceita (ou recusa) o próximo `window.confirm`. */
export function answerNextConfirm(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await (accept ? dialog.accept() : dialog.dismiss());
    });
  });
}

export async function expectForbidden(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `GET ${path}`).toBe(403);
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
}
