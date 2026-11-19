/** Escapa os curingas do LIKE/ILIKE (% _ \) para que o texto digitado seja literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
