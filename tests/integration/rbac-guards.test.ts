import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/db";
import { orders } from "@/db/schema";
import { getCurrentUser, requirePermission, requireRole, requireUser } from "@/lib/auth/guards";
import { canAccessOrder, canManageOrder } from "@/lib/auth/rbac";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";
import { cookieJar, ForbiddenError, RedirectError, resetNextMocks } from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);

const asLoggedIn = (token: string) => cookieJar.set(SESSION_COOKIE, token);

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("getCurrentUser / requireUser", () => {
  it("visitante (sem cookie): getCurrentUser devolve null e requireUser redireciona ao login", async () => {
    expect(await getCurrentUser()).toBeNull();
    await expect(requireUser()).rejects.toMatchObject({ url: "/login" });
  });

  it("requireUser guarda o destino para voltar após o login", async () => {
    await expect(requireUser("/admin/produtos?x=1")).rejects.toMatchObject({
      url: "/login?next=%2Fadmin%2Fprodutos%3Fx%3D1",
    });
  });

  it("cookie com token inválido é tratado como visitante", async () => {
    cookieJar.set(SESSION_COOKIE, "token-forjado");
    expect(await getCurrentUser()).toBeNull();
    await expect(requireUser()).rejects.toBeInstanceOf(RedirectError);
  });

  it("sessão válida devolve o usuário", async () => {
    const { user, token } = await createUserWithSession("CONSULTOR");
    asLoggedIn(token);
    expect(await requireUser()).toEqual(user);
  });

  it("usuário desativado perde o acesso imediatamente", async () => {
    const { token } = await createUserWithSession("ADMIN", { active: false });
    asLoggedIn(token);
    await expect(requireUser()).rejects.toBeInstanceOf(RedirectError);
  });
});

describe("requireRole", () => {
  it("ADMIN passa na área administrativa", async () => {
    const { user, token } = await createUserWithSession("ADMIN");
    asLoggedIn(token);
    expect(await requireRole("ADMIN")).toEqual(user);
  });

  it.each(["CONSULTOR", "CLIENTE"] as const)("%s recebe 403 na área administrativa", async (role) => {
    const { token } = await createUserWithSession(role);
    asLoggedIn(token);
    await expect(requireRole("ADMIN")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("visitante é redirecionado ao login (e não recebe 403)", async () => {
    await expect(requireRole("ADMIN")).rejects.toBeInstanceOf(RedirectError);
  });

  it("aceita vários perfis", async () => {
    const consultor = await createUserWithSession("CONSULTOR");
    asLoggedIn(consultor.token);
    expect(await requireRole("ADMIN", "CONSULTOR")).toEqual(consultor.user);

    const cliente = await createUserWithSession("CLIENTE");
    asLoggedIn(cliente.token);
    await expect(requireRole("ADMIN", "CONSULTOR")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requirePermission", () => {
  it.each([
    ["ADMIN", "admin:access", true],
    ["CONSULTOR", "admin:access", false],
    ["CLIENTE", "admin:access", false],
    ["ADMIN", "product:manage", true],
    ["CONSULTOR", "product:manage", false],
    ["CLIENTE", "product:manage", false],
    ["ADMIN", "order:read:all", true],
    ["CONSULTOR", "order:read:all", false],
    ["CLIENTE", "order:read:all", false],
    ["ADMIN", "order:create", true],
    ["CONSULTOR", "order:create", true],
    ["CLIENTE", "order:create", true],
    ["CONSULTOR", "order:read:own", true],
    ["CLIENTE", "product:read", true],
  ] as const)("%s + %s → permitido=%s", async (role, permission, allowed) => {
    const { user, token } = await createUserWithSession(role);
    asLoggedIn(token);
    if (allowed) {
      expect(await requirePermission(permission)).toEqual(user);
    } else {
      await expect(requirePermission(permission)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("posse de pedidos aplicada a dados reais", () => {
  it("cada perfil enxerga apenas os pedidos permitidos", async () => {
    const admin = await createUserWithSession("ADMIN");
    const consultorA = await createUserWithSession("CONSULTOR");
    const consultorB = await createUserWithSession("CONSULTOR");
    const cliente = await createUserWithSession("CLIENTE");

    const db = getDb();
    await db.insert(orders).values([
      { userId: consultorA.user.id, customerName: "A1", totalCents: 100 },
      { userId: consultorA.user.id, customerName: "A2", totalCents: 200 },
      { userId: consultorB.user.id, customerName: "B1", totalCents: 300 },
      { userId: cliente.user.id, customerName: "C1", totalCents: 400 },
    ]);
    const all = await db.select().from(orders).orderBy(orders.orderNumber);

    const visibleTo = (actor: { id: string; role: "ADMIN" | "CONSULTOR" | "CLIENTE" }) =>
      all.filter((order) => canAccessOrder(actor, order)).map((order) => order.customerName);

    expect(visibleTo(admin.user)).toEqual(["A1", "A2", "B1", "C1"]);
    expect(visibleTo(consultorA.user)).toEqual(["A1", "A2"]);
    expect(visibleTo(consultorB.user)).toEqual(["B1"]);
    expect(visibleTo(cliente.user)).toEqual(["C1"]);

    const [b1] = await db.select().from(orders).where(eq(orders.customerName, "B1"));
    expect(canManageOrder(consultorA.user, b1)).toBe(false);
    expect(canManageOrder(consultorB.user, b1)).toBe(true);
    expect(canManageOrder(admin.user, b1)).toBe(true);
  });
});
