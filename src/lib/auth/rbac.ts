import type { UserRole } from "./roles";

export const PERMISSIONS = [
  "admin:access",
  "user:manage",
  "category:read",
  "category:manage",
  "product:read",
  "product:manage",
  "order:create",
  "order:read:own",
  "order:manage:own",
  "order:read:all",
  "order:manage:all",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  // ADMIN: acesso total ao gerenciamento (produtos, categorias e todos os pedidos).
  ADMIN: new Set(PERMISSIONS),
  // CONSULTOR: vitrine + lança, visualiza e gerencia apenas os SEUS pedidos.
  CONSULTOR: new Set<Permission>([
    "category:read",
    "product:read",
    "order:create",
    "order:read:own",
    "order:manage:own",
  ]),
  // CLIENTE: vitrine + fluxo básico de pedido (lança e acompanha os próprios).
  CLIENTE: new Set<Permission>(["category:read", "product:read", "order:create", "order:read:own"]),
};

/** Papel desconhecido (ex.: valor novo no banco ainda sem regra aqui) = nenhuma permissão. Falha fechado. */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsOf(role: UserRole): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}

type Actor = { id: string; role: UserRole };
/** `userId` nulo = pedido de visitante sem cadastro (não pertence a ninguém além do ADMIN). */
type OrderOwnership = { userId: string | null };

/**
 * Regra de posse: ADMIN acessa qualquer pedido; os demais, somente os que criaram.
 * Pedido de visitante (sem dono) nunca casa com `actor.id`, então só o ADMIN o acessa.
 */
export function canAccessOrder(actor: Actor, order: OrderOwnership): boolean {
  if (hasPermission(actor.role, "order:read:all")) return true;
  return hasPermission(actor.role, "order:read:own") && order.userId === actor.id;
}

export function canManageOrder(actor: Actor, order: OrderOwnership): boolean {
  if (hasPermission(actor.role, "order:manage:all")) return true;
  return hasPermission(actor.role, "order:manage:own") && order.userId === actor.id;
}

/**
 * Quem informa dados do cliente ao finalizar um pedido. O CONSULTOR lança pedidos internos:
 * sem cliente e sem envio por WhatsApp. Os demais perfis (e o visitante) sempre informam o cliente.
 */
export function collectsCustomerData(role: UserRole): boolean {
  return role !== "CONSULTOR";
}

/** Página inicial de cada perfil após o login. */
export function homePathFor(role: UserRole): string {
  return role === "ADMIN" ? "/admin" : "/";
}
