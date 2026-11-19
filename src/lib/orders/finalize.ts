import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { orderDraftItems, orderDrafts, orderItems, orders, products } from "@/db/schema";
import { calculateOrder } from "@/lib/orders/calculation";
import { createOrderInputSchema, finalizeOrderSchema, guestOrderSchema, internalOrderSchema } from "@/lib/validation/order";

export class EmptyDraftError extends Error {
  constructor() {
    super("Não há itens no pedido para finalizar");
    this.name = "EmptyDraftError";
  }
}

export class OrderProductUnavailableError extends Error {
  constructor(public readonly productIds: string[]) {
    super("Um ou mais produtos do pedido não estão mais disponíveis. Atualize a página e revise o pedido.");
    this.name = "OrderProductUnavailableError";
  }
}

export class OrderTotalTooLargeError extends Error {
  constructor() {
    super("O valor total do pedido excede o limite permitido");
    this.name = "OrderTotalTooLargeError";
  }
}

export class OrderPriceChangedError extends Error {
  constructor(public readonly actualTotalCents: number) {
    super("Os preços mudaram desde que você montou o pedido. Revise os valores atualizados e finalize novamente.");
    this.name = "OrderPriceChangedError";
  }
}

export type FinalizedOrder = { orderId: string; orderNumber: number; totalCents: number };

/** Pedido recém-gravado, com o que é preciso para montar a mensagem do WhatsApp sem reler o banco. */
export type PlacedOrder = FinalizedOrder & {
  createdAt: Date;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  items: { reference: string; description: string; unitPriceCents: number; quantity: number; lineTotalCents: number }[];
};

/** Dados do cliente do pedido. Tudo nulo = pedido interno (CONSULTOR). */
type CustomerData = { customerName: string | null; customerPhone: string | null; notes: string | null };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Linha de pedido já lida do cadastro: preço e disponibilidade VIGENTES + a quantidade pedida. */
type SourceRow = {
  productId: string;
  reference: string;
  description: string;
  priceCents: number;
  active: boolean;
  quantity: number;
};

/**
 * Parte comum de todo pedido (do usuário logado ou do visitante), dentro de uma transação já aberta:
 * confere disponibilidade, valida as linhas, calcula o total, compara com o que a pessoa viu na tela
 * e grava o pedido com um "snapshot" (referência, descrição e preço) de cada item.
 * `userId` nulo grava um pedido de visitante.
 */
async function insertOrder(
  tx: Tx,
  args: {
    userId: string | null;
    customer: CustomerData;
    rows: SourceRow[];
    expectedTotalCents: number;
  },
): Promise<PlacedOrder> {
  const { userId, customer, rows, expectedTotalCents } = args;

  const unavailable = rows.filter((row) => !row.active).map((row) => row.productId);
  if (unavailable.length > 0) throw new OrderProductUnavailableError(unavailable);

  // Mesmas regras do cadastro de pedido (mín. 1 item, máx. 200, sem produto repetido, quantidade 1–9999).
  createOrderInputSchema.shape.items.parse(rows.map((row) => ({ productId: row.productId, quantity: row.quantity })));

  const totals = calculateOrder(
    rows.map((row) => ({
      productId: row.productId,
      reference: row.reference,
      description: row.description,
      unitPriceCents: row.priceCents,
      quantity: row.quantity,
    })),
  );
  if (totals.exceedsLimit) throw new OrderTotalTooLargeError();
  if (totals.totalCents !== expectedTotalCents) throw new OrderPriceChangedError(totals.totalCents);

  const [order] = await tx
    .insert(orders)
    .values({
      userId,
      customerName: customer.customerName,
      customerPhone: customer.customerPhone,
      notes: customer.notes,
      totalCents: totals.totalCents,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber, createdAt: orders.createdAt });

  await tx.insert(orderItems).values(
    totals.lines.map((line, position) => ({
      orderId: order.id,
      productId: line.productId,
      reference: line.reference,
      description: line.description,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
      position,
    })),
  );

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalCents: totals.totalCents,
    createdAt: order.createdAt,
    customerName: customer.customerName,
    customerPhone: customer.customerPhone,
    notes: customer.notes,
    items: totals.lines.map((line) => ({
      reference: line.reference,
      description: line.description,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
    })),
  };
}

/**
 * Lê a entrada da finalização. Com `withCustomer: false` (pedido interno do CONSULTOR) só vale o total
 * visto na tela: qualquer dado de cliente enviado é descartado, e o pedido é gravado sem cliente.
 */
function parseFinalizeInput(input: unknown, withCustomer: boolean): { expectedTotalCents: number; customer: CustomerData } {
  if (withCustomer) {
    const { expectedTotalCents, ...customer } = finalizeOrderSchema.parse(input);
    return { expectedTotalCents, customer };
  }
  const { expectedTotalCents } = internalOrderSchema.parse(input);
  return { expectedTotalCents, customer: { customerName: null, customerPhone: null, notes: null } };
}

/**
 * Converte o rascunho do usuário em pedido FINAL, tudo numa única transação:
 *  1. trava o rascunho (cliques duplicados/abas simultâneas são serializados);
 *  2. lê os itens e os preços VIGENTES do cadastro (nada vem do cliente);
 *  3. confere que o total bate com o que o usuário viu na tela;
 *  4. grava o pedido com um "snapshot" (referência, descrição e preço) de cada item;
 *  5. apaga o rascunho.
 * Qualquer falha desfaz tudo: ou o pedido é gravado inteiro, ou nada muda.
 */
export async function finalizeDraft(
  userId: string,
  input: unknown,
  options: { withCustomer?: boolean } = {},
): Promise<FinalizedOrder> {
  const { expectedTotalCents, customer } = parseFinalizeInput(input, options.withCustomer ?? true);

  return getDb().transaction(async (tx) => {
    const [draft] = await tx.select().from(orderDrafts).where(eq(orderDrafts.userId, userId)).for("update");
    if (!draft) throw new EmptyDraftError();

    const rows = await tx
      .select({
        productId: products.id,
        reference: products.reference,
        description: products.description,
        priceCents: products.priceCents,
        active: products.active,
        quantity: orderDraftItems.quantity,
      })
      .from(orderDraftItems)
      .innerJoin(products, eq(products.id, orderDraftItems.productId))
      .where(eq(orderDraftItems.userId, userId))
      .orderBy(asc(orderDraftItems.position));
    if (rows.length === 0) throw new EmptyDraftError();

    const { orderId, orderNumber, totalCents } = await insertOrder(tx, { userId, customer, rows, expectedTotalCents });

    await tx.delete(orderDrafts).where(eq(orderDrafts.userId, userId)); // as linhas saem por cascade

    return { orderId, orderNumber, totalCents };
  });
}

/**
 * Pedido de um VISITANTE (sem cadastro, direto da vitrine). Não há rascunho no banco: os itens
 * (produto + quantidade) chegam no `input`, mas preços e disponibilidade vêm SEMPRE do cadastro
 * de produtos, e o total que o visitante viu é conferido antes de gravar. O pedido é gravado sem
 * dono (`user_id` nulo): só o ADMIN o enxerga.
 */
export async function createGuestOrder(input: unknown): Promise<PlacedOrder> {
  const { expectedTotalCents, items, ...customer } = guestOrderSchema.parse(input);

  return getDb().transaction(async (tx) => {
    const found = await tx
      .select({
        productId: products.id,
        reference: products.reference,
        description: products.description,
        priceCents: products.priceCents,
        active: products.active,
      })
      .from(products)
      .where(inArray(products.id, items.map((item) => item.productId)));
    const byId = new Map(found.map((product) => [product.productId, product]));

    const missing = items.filter((item) => !byId.has(item.productId)).map((item) => item.productId);
    if (missing.length > 0) throw new OrderProductUnavailableError(missing);

    // Mantém a ordem em que o visitante montou a tabela.
    const rows = items.map((item) => ({ ...byId.get(item.productId)!, quantity: item.quantity }));
    return insertOrder(tx, { userId: null, customer, rows, expectedTotalCents });
  });
}
