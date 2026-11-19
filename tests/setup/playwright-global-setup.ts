import path from "node:path";
import { config } from "dotenv";
import { prepareTestDatabase } from "./database";
import { seedTestUsers } from "./test-users";

export default async function globalSetup() {
  config({ path: path.resolve(__dirname, "../../.env.test"), quiet: true });

  const e2eUrl = process.env.E2E_DATABASE_URL;
  if (!e2eUrl) throw new Error("E2E_DATABASE_URL não definida. Verifique o arquivo .env.test.");

  // As funções de seed usam getDb(), que lê DATABASE_URL.
  process.env.DATABASE_URL = e2eUrl;
  await prepareTestDatabase(e2eUrl);
  await seedTestUsers();
}
