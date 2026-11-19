import path from "node:path";
import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// O servidor E2E usa o banco de testes, nunca o de desenvolvimento.
config({ path: path.resolve(__dirname, ".env.test"), quiet: true });

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/setup/playwright-global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build de produção: sem compilação sob demanda (que deixava o 1º login lento e instável
    // com vários workers) e mais próximo do que vai para o ar.
    command: `npm run build && npx next start --port ${PORT}`,
    // O webServer sobe ANTES do globalSetup (que cria o banco E2E). Por isso o sinal de
    // "pronto" não pode depender do banco: /login responde 200 para visitantes sem consultá-lo.
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      // Número que recebe os pedidos: permite verificar o link "Enviar pelo WhatsApp" da loja.
      WHATSAPP_ORDERS_NUMBER: "5511999998888",
    },
  },
});
