import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import { USER_ROLES } from "@/lib/auth/roles";
import { ORDER_STATUSES } from "@/lib/orders/status";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum("user_role", USER_ROLES);
export const orderStatus = pgEnum("order_status", ORDER_STATUSES);

/*
 * RLS (row level security) ligado em TODAS as tabelas, sem nenhuma política.
 * No Supabase as tabelas do schema `public` ficam expostas pela Data API aos papéis `anon` e
 * `authenticated`; com RLS e sem políticas esses papéis não leem nem gravam nada. O app conecta
 * com o papel `postgres` (BYPASSRLS) e o dono da tabela também ignora o RLS, então nada muda para ele.
 * Tabela nova: terminar com `.enableRLS()`.
 */

/**
 * Tabela chave/valor com metadados da aplicação (criada na Fase 1 para validar
 * o pipeline de migrações).
 */
export const appMeta = pgTable("app_meta", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("CLIENTE"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 do token do cookie; o token em si nunca é gravado. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), index("sessions_expires_at_idx").on(t.expiresAt)],
).enableRLS();

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 60 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("categories_name_lower_idx").on(sql`lower(${t.name})`)],
).enableRLS();

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 40 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    /** Preço unitário em centavos (inteiro, para evitar erros de ponto flutuante). */
    priceCents: integer("price_cents").notNull(),
    /**
     * Endereço da imagem (opcional). Links do Google Drive são gravados já convertidos para o endereço
     * direto `https://lh3.googleusercontent.com/d/ID` (veja `src/lib/images/image-url.ts`).
     */
    imageUrl: varchar("image_url", { length: 2048 }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_reference_upper_idx").on(sql`upper(${t.reference})`),
    index("products_category_id_idx").on(t.categoryId),
    check("products_price_positive", sql`${t.priceCents} > 0`),
    // Só https: http seria bloqueado como "conteúdo misto" e outros esquemas (javascript:, data:) não são imagem.
    check("products_image_url_https", sql`${t.imageUrl} is null or ${t.imageUrl} like 'https://%'`),
  ],
).enableRLS();

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Número sequencial amigável exibido ao usuário ("Pedido #123"). */
    orderNumber: integer("order_number").notNull().unique().generatedAlwaysAsIdentity(),
    /**
     * Quem lançou o pedido (consultor, cliente ou admin). Define a posse do pedido.
     * Nulo = pedido feito por um visitante sem cadastro, direto da vitrine: só o ADMIN o enxerga.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    /**
     * Nulo nos pedidos de CONSULTOR: são internos, sem cliente e sem envio por WhatsApp.
     * Pedidos de visitante e dos demais perfis sempre têm o nome (a regra está na validação).
     */
    customerName: varchar("customer_name", { length: 120 }),
    customerPhone: varchar("customer_phone", { length: 20 }),
    notes: varchar("notes", { length: 500 }),
    status: orderStatus("status").notNull().default("PENDENTE"),
    totalCents: integer("total_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_user_id_created_at_idx").on(t.userId, t.createdAt),
    check("orders_total_non_negative", sql`${t.totalCents} >= 0`),
  ],
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Pode ficar nulo se o produto for excluído; o histórico vive nos campos "snapshot" abaixo. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    reference: varchar("reference", { length: 40 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    /** Ordem das linhas, como o pedido foi montado na tabela. */
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("order_items_order_id_idx").on(t.orderId),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("order_items_unit_price_non_negative", sql`${t.unitPriceCents} >= 0`),
    check(
      "order_items_line_total_consistent",
      sql`${t.lineTotalCents} = ${t.unitPriceCents} * ${t.quantity}`,
    ),
  ],
).enableRLS();

/**
 * Rascunho do pedido em montagem na tabela interativa: no máximo UM por usuário.
 * Não é um pedido (não aparece no histórico); a Fase 5 o converte em `orders` ao finalizar.
 * Guarda só produto + quantidade — o preço mostrado vem sempre do cadastro atual.
 */
export const orderDrafts = pgTable("order_drafts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const orderDraftItems = pgTable(
  "order_draft_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => orderDrafts.userId, { onDelete: "cascade" }),
    /** Se o produto for excluído, a linha some do rascunho. */
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    /** Ordem das linhas na tabela, como o usuário as montou. */
    position: integer("position").notNull(),
  },
  (t) => [
    uniqueIndex("order_draft_items_user_product_idx").on(t.userId, t.productId),
    index("order_draft_items_user_position_idx").on(t.userId, t.position),
    check("order_draft_items_quantity_range", sql`${t.quantity} between 1 and 9999`),
  ],
).enableRLS();

export type AppMeta = typeof appMeta.$inferSelect;
export type NewAppMeta = typeof appMeta.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderDraft = typeof orderDrafts.$inferSelect;
export type OrderDraftItem = typeof orderDraftItems.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
