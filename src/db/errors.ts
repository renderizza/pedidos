/** Código SQLSTATE do erro do driver. O Drizzle embrulha o erro original em `cause`. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (error: unknown) => pgErrorCode(error) === "23505";
export const isForeignKeyViolation = (error: unknown) => pgErrorCode(error) === "23503";
