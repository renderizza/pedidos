import path from "node:path";
import { config } from "dotenv";
import { prepareTestDatabase } from "./database";

export default async function setup() {
  // `test.env` só vale dentro dos workers; o globalSetup roda no processo principal.
  config({ path: path.resolve(__dirname, "../../.env.test"), quiet: true });
  await prepareTestDatabase();
}
