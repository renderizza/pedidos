import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from "./session";

describe("tokens de sessão", () => {
  it("gera tokens longos, em base64url e únicos", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSessionToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64url
    }
  });

  it("o hash é um SHA-256 hexadecimal determinístico e diferente do token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
    expect(hashSessionToken(generateSessionToken())).not.toBe(hash);
  });

  it("a sessão dura 7 dias", () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
