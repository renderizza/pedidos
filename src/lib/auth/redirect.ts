/**
 * Aceita apenas caminhos internos ("/algo"). Bloqueia URLs externas, "//host",
 * "/\host" e esquemas como "javascript:" para evitar open redirect no parâmetro `next`.
 */
export function safeRedirectPath(candidate: unknown, fallback = "/"): string {
  if (typeof candidate !== "string") return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(candidate)) return fallback;
  return candidate;
}
