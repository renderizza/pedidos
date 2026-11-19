import { describe, expect, it } from "vitest";
import {
  canAccessOrder,
  canManageOrder,
  collectsCustomerData,
  hasPermission,
  homePathFor,
  PERMISSIONS,
  permissionsOf,
  type Permission,
} from "./rbac";
import { isUserRole, USER_ROLES, type UserRole } from "./roles";

describe("papéis", () => {
  it("define exatamente os três níveis de acesso", () => {
    expect([...USER_ROLES]).toEqual(["ADMIN", "CONSULTOR", "CLIENTE"]);
  });

  it("isUserRole reconhece só valores válidos", () => {
    expect(isUserRole("ADMIN")).toBe(true);
    expect(isUserRole("admin")).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
  });
});

describe("matriz de permissões", () => {
  it("ADMIN possui todas as permissões", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission("ADMIN", permission)).toBe(true);
    }
  });

  it("CONSULTOR vê a vitrine, cria pedidos e só gerencia os próprios", () => {
    const allowed: Permission[] = ["category:read", "product:read", "order:create", "order:read:own", "order:manage:own"];
    expect(permissionsOf("CONSULTOR")).toEqual(PERMISSIONS.filter((p) => allowed.includes(p)));
  });

  it("CLIENTE vê a vitrine, cria e acompanha os próprios pedidos (sem gerenciar)", () => {
    expect(hasPermission("CLIENTE", "product:read")).toBe(true);
    expect(hasPermission("CLIENTE", "order:create")).toBe(true);
    expect(hasPermission("CLIENTE", "order:read:own")).toBe(true);
    expect(hasPermission("CLIENTE", "order:manage:own")).toBe(false);
  });

  it.each(["CONSULTOR", "CLIENTE"] as const)("%s NÃO acessa nada administrativo", (role) => {
    for (const permission of [
      "admin:access",
      "user:manage",
      "category:manage",
      "product:manage",
      "order:read:all",
      "order:manage:all",
    ] as const) {
      expect(hasPermission(role, permission)).toBe(false);
    }
  });
});

describe("papel desconhecido (falha fechado)", () => {
  const ghost = "FANTASMA" as unknown as UserRole;

  it("não tem nenhuma permissão e não lança erro", () => {
    for (const permission of PERMISSIONS) expect(hasPermission(ghost, permission)).toBe(false);
    expect(permissionsOf(ghost)).toEqual([]);
  });

  it("não acessa nem gerencia pedido nenhum, nem o próprio", () => {
    expect(canAccessOrder({ id: "x", role: ghost }, { userId: "x" })).toBe(false);
    expect(canManageOrder({ id: "x", role: ghost }, { userId: "x" })).toBe(false);
  });
});

describe("collectsCustomerData", () => {
  it("só o CONSULTOR é dispensado de informar o cliente (pedido interno, sem WhatsApp)", () => {
    expect(collectsCustomerData("CONSULTOR")).toBe(false);
    expect(collectsCustomerData("ADMIN")).toBe(true);
    expect(collectsCustomerData("CLIENTE")).toBe(true);
  });
});

describe("posse de pedidos", () => {
  const admin = { id: "admin-1", role: "ADMIN" } as const;
  const consultorA = { id: "cons-a", role: "CONSULTOR" } as const;
  const consultorB = { id: "cons-b", role: "CONSULTOR" } as const;
  const cliente = { id: "cli-1", role: "CLIENTE" } as const;

  it("ADMIN acessa e gerencia qualquer pedido", () => {
    expect(canAccessOrder(admin, { userId: "outra-pessoa" })).toBe(true);
    expect(canManageOrder(admin, { userId: "outra-pessoa" })).toBe(true);
  });

  it("CONSULTOR acessa e gerencia apenas os seus pedidos", () => {
    expect(canAccessOrder(consultorA, { userId: consultorA.id })).toBe(true);
    expect(canManageOrder(consultorA, { userId: consultorA.id })).toBe(true);
    expect(canAccessOrder(consultorA, { userId: consultorB.id })).toBe(false);
    expect(canManageOrder(consultorA, { userId: consultorB.id })).toBe(false);
  });

  it("pedido de visitante (sem dono): só o ADMIN acessa e gerencia", () => {
    const guestOrder = { userId: null };
    expect(canAccessOrder(admin, guestOrder)).toBe(true);
    expect(canManageOrder(admin, guestOrder)).toBe(true);
    for (const actor of [consultorA, consultorB, cliente]) {
      expect(canAccessOrder(actor, guestOrder)).toBe(false);
      expect(canManageOrder(actor, guestOrder)).toBe(false);
    }
  });

  it("CLIENTE vê só os próprios pedidos e não os gerencia", () => {
    expect(canAccessOrder(cliente, { userId: cliente.id })).toBe(true);
    expect(canAccessOrder(cliente, { userId: consultorA.id })).toBe(false);
    expect(canManageOrder(cliente, { userId: cliente.id })).toBe(false);
  });
});

describe("homePathFor", () => {
  it("ADMIN vai para o painel; os demais para a vitrine", () => {
    expect(homePathFor("ADMIN")).toBe("/admin");
    expect(homePathFor("CONSULTOR")).toBe("/");
    expect(homePathFor("CLIENTE")).toBe("/");
  });
});
