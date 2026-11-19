import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// Parâmetros do scrypt (OWASP: N=2^17 é o ideal em produção; 2^15 equilibra custo e latência).
// Só sob NODE_ENV=test o custo cai (2^10) para a suíte não gastar ~100 ms por hash;
// como os parâmetros viajam junto do hash, ele continua verificável em qualquer ambiente.
const PARAMS = { N: process.env.NODE_ENV === "test" ? 2 ** 10 : 2 ** 15, r: 8, p: 1 } as const;
const MAX_MEM = 128 * 2 ** 15 * PARAMS.r * 2;

function deriveKey(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...params, maxmem: MAX_MEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Formato armazenado: `scrypt$N$r$p$saltBase64$hashBase64` (parâmetros viajam com o hash). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return false;

  const expected = Buffer.from(hashB64, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await deriveKey(password, Buffer.from(saltB64, "base64"), params);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
