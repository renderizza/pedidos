import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { categories, orderItems, orders, products, sessions, users } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth/session";
import { resetDatabase } from "../setup/db-helpers";

/** Erros do driver chegam embrulhados pelo Drizzle em `cause`. */
async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { constraint?: string; cause?: { constraint?: string; code?: string } };
    return e.cause?.constraint ?? e.constraint ?? `erro-sem-constraint:${e.cause?.code}`;
  }
  return undefined;
}

const db = () => getDb();

async function newUser(email = "u@teste.com") {
  const [user] = await db()
    .insert(users)
    .values({ name: "Usuário", email, passwordHash: "hash" })
    .returning();
  return user;
}

async function newProduct(reference = "REF-1", priceCents = 1000) {
  const [product] = await db()
    .insert(products)
    .values({ reference, description: "Produto de teste", priceCents })
    .returning();
  return product;
}

async function newOrder(userId: string, totalCents = 0) {
  const [order] = await db().insert(orders).values({ userId, customerName: "Cliente", totalCents }).returning();
  return order;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("users", () => {
  it("usa CLIENTE e ativo como padrões", async () => {
    const user = await newUser();
    expect(user.role).toBe("CLIENTE");
    expect(user.active).toBe(true);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejeita e-mail duplicado ignorando maiúsculas/minúsculas", async () => {
    await newUser("Maria@Teste.com");
    expect(await constraintOf(newUser("maria@teste.COM"))).toBe("users_email_lower_idx");
  });

  it("rejeita papel fora do enum (ADMIN | CONSULTOR | CLIENTE)", async () => {
    const result = await constraintOf(
      db().execute(sql`insert into users (name, email, password_hash, role) values ('x', 'x@x.com', 'h', 'ROOT')`),
    );
    expect(result).toBe("erro-sem-constraint:22P02"); // invalid_text_representation
  });

  it.each(["ADMIN", "CONSULTOR", "CLIENTE"] as const)("aceita o papel %s", async (role) => {
    const [user] = await db()
      .insert(users)
      .values({ name: "x", email: `${role}@x.com`, passwordHash: "h", role })
      .returning();
    expect(user.role).toBe(role);
  });

  it("atualiza updated_at ao alterar o registro", async () => {
    const user = await newUser();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [updated] = await db().update(users).set({ name: "Novo nome" }).where(eq(users.id, user.id)).returning();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(user.updatedAt.getTime());
  });
});

describe("categories", () => {
  it("rejeita nome duplicado ignorando maiúsculas/minúsculas", async () => {
    await db().insert(categories).values({ name: "Bebidas" });
    expect(await constraintOf(db().insert(categories).values({ name: "bebidas" }))).toBe("categories_name_lower_idx");
  });
});

describe("products", () => {
  it("exige referência, descrição e preço (NOT NULL)", async () => {
    for (const column of ["reference", "description", "price_cents"]) {
      const values = { reference: "'R'", description: "'D'", price_cents: "1" } as Record<string, string>;
      delete values[column];
      const cols = Object.keys(values).join(", ");
      const vals = Object.values(values).join(", ");
      const result = await constraintOf(db().execute(sql.raw(`insert into products (${cols}) values (${vals})`)));
      expect(result).toBe("erro-sem-constraint:23502"); // not_null_violation
    }
  });

  it("rejeita referência duplicada ignorando maiúsculas/minúsculas", async () => {
    await newProduct("abc-1");
    expect(await constraintOf(newProduct("ABC-1"))).toBe("products_reference_upper_idx");
  });

  it.each([0, -50])("rejeita preço %i (check de preço positivo)", async (price) => {
    expect(await constraintOf(newProduct("P", price))).toBe("products_price_positive");
  });

  it("imagem é opcional: nasce nula e aceita endereço https", async () => {
    expect((await newProduct("SEM-IMG")).imageUrl).toBeNull();
    const [product] = await db()
      .insert(products)
      .values({
        reference: "COM-IMG",
        description: "Produto com imagem",
        priceCents: 100,
        imageUrl: "https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      })
      .returning();
    expect(product.imageUrl).toBe("https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it.each([
    "http://exemplo.com/a.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "ftp://exemplo.com/a.jpg",
    "//cdn.exemplo.com/a.jpg",
    "drive.google.com/file/d/abc",
  ])("rejeita imagem que não é https: %s (check do banco)", async (imageUrl) => {
    const result = await constraintOf(
      db().insert(products).values({ reference: "X", description: "Produto X", priceCents: 100, imageUrl }),
    );
    expect(result).toBe("products_image_url_https");
  });

  it("ao excluir a categoria, o produto permanece sem categoria", async () => {
    const [category] = await db().insert(categories).values({ name: "Temporária" }).returning();
    const [product] = await db()
      .insert(products)
      .values({ reference: "X", description: "Produto X", priceCents: 100, categoryId: category.id })
      .returning();
    await db().delete(categories).where(eq(categories.id, category.id));
    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    expect(after.categoryId).toBeNull();
  });
});

describe("orders e order_items", () => {
  it("numera os pedidos sequencialmente", async () => {
    const user = await newUser();
    const first = await newOrder(user.id);
    const second = await newOrder(user.id);
    expect(second.orderNumber).toBe(first.orderNumber + 1);
    expect(first.status).toBe("PENDENTE");
  });

  it("rejeita total negativo e status inexistente", async () => {
    const user = await newUser();
    expect(await constraintOf(newOrder(user.id, -1))).toBe("orders_total_non_negative");
    const status = await constraintOf(
      db().execute(
        sql`insert into orders (user_id, customer_name, total_cents, status) values (${user.id}, 'c', 0, 'ENVIADO')`,
      ),
    );
    expect(status).toBe("erro-sem-constraint:22P02");
  });

  it("não permite excluir usuário que possui pedidos (preserva o histórico)", async () => {
    const user = await newUser();
    await newOrder(user.id);
    expect(await constraintOf(db().delete(users).where(eq(users.id, user.id)))).toBe("orders_user_id_users_id_fk");
  });

  it("valida quantidade positiva e total da linha consistente", async () => {
    const user = await newUser();
    const product = await newProduct();
    const order = await newOrder(user.id, 2000);
    const base = {
      orderId: order.id,
      productId: product.id,
      reference: product.reference,
      description: product.description,
      unitPriceCents: 1000,
    };
    expect(await constraintOf(db().insert(orderItems).values({ ...base, quantity: 0, lineTotalCents: 0 }))).toBe(
      "order_items_quantity_positive",
    );
    expect(await constraintOf(db().insert(orderItems).values({ ...base, quantity: 2, lineTotalCents: 1999 }))).toBe(
      "order_items_line_total_consistent",
    );
    await expect(
      db().insert(orderItems).values({ ...base, quantity: 2, lineTotalCents: 2000 }),
    ).resolves.toBeDefined();
  });

  it("excluir o pedido remove seus itens (cascade)", async () => {
    const user = await newUser();
    const product = await newProduct();
    const order = await newOrder(user.id, 1000);
    await db().insert(orderItems).values({
      orderId: order.id,
      productId: product.id,
      reference: "REF-1",
      description: "Produto de teste",
      unitPriceCents: 1000,
      quantity: 1,
      lineTotalCents: 1000,
    });
    await db().delete(orders).where(eq(orders.id, order.id));
    expect(await db().select().from(orderItems).where(eq(orderItems.orderId, order.id))).toHaveLength(0);
  });

  it("excluir o produto mantém o item do pedido com o snapshot histórico", async () => {
    const user = await newUser();
    const product = await newProduct("HIST-9", 2500);
    const order = await newOrder(user.id, 2500);
    await db().insert(orderItems).values({
      orderId: order.id,
      productId: product.id,
      reference: product.reference,
      description: product.description,
      unitPriceCents: 2500,
      quantity: 1,
      lineTotalCents: 2500,
    });
    await db().delete(products).where(eq(products.id, product.id));
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(item.productId).toBeNull();
    expect(item.reference).toBe("HIST-9");
    expect(item.unitPriceCents).toBe(2500);
  });
});

describe("sessions", () => {
  it("token_hash é único", async () => {
    const user = await newUser();
    const values = { userId: user.id, tokenHash: hashSessionToken("t"), expiresAt: new Date(Date.now() + 1000) };
    await db().insert(sessions).values(values);
    expect(await constraintOf(db().insert(sessions).values(values))).toBe("sessions_token_hash_unique");
  });

  it("excluir o usuário remove suas sessões (cascade)", async () => {
    const user = await newUser();
    await db()
      .insert(sessions)
      .values({ userId: user.id, tokenHash: hashSessionToken("x"), expiresAt: new Date(Date.now() + 1000) });
    await db().delete(users).where(eq(users.id, user.id));
    expect(await db().select().from(sessions)).toHaveLength(0);
  });
});
