/** Rótulo de quem lançou um pedido feito por visitante, direto da vitrine (sem cadastro no sistema). */
export const GUEST_REQUESTER_LABEL = "Cliente sem cadastro";

/** Nome de quem lançou o pedido para exibição: o usuário, ou o rótulo de visitante quando não há usuário. */
export function requesterLabel(requesterName: string | null): string {
  return requesterName ?? GUEST_REQUESTER_LABEL;
}
