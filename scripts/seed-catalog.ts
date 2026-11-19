/**
 * Popula o banco de DESENVOLVIMENTO com categorias, produtos (cosméticos e beleza)
 * e pedidos de exemplo.
 *
 * Uso: npm run db:seed:catalog
 *
 * Pré-requisito: rode `npm run db:seed` antes — os pedidos pertencem aos usuários de
 * desenvolvimento (admin, consultor e cliente).
 *
 * Pode ser executado quantas vezes quiser:
 *  - categorias e produtos já existentes (mesmo nome / mesma referência) são mantidos como estão;
 *  - os pedidos de exemplo só são criados uma vez (marcador em `app_meta`), para não duplicar o histórico.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { appMeta, categories, orderItems, orders, products, users } from "@/db/schema";
import { parseMoneyToCents } from "@/lib/money";
import { calculateOrder } from "@/lib/orders/calculation";
import type { OrderStatus } from "@/lib/orders/status";
import { categoryInputSchema } from "@/lib/validation/category";
import { createOrderInputSchema } from "@/lib/validation/order";
import { productInputSchema } from "@/lib/validation/product";

// ---------------------------------------------------------------------------
// Catálogo (marcas fictícias; preços em reais, convertidos para centavos ao gravar)
// ---------------------------------------------------------------------------

type SeedProduct = { ref: string; description: string; price: string; inactive?: true };

const CATALOG: { category: string; products: SeedProduct[] }[] = [
  {
    category: "Maquiagem",
    products: [
      { ref: "MAQ-001", description: "Batom Matte Longa Duração 3,5g - Vermelho Cereja", price: "24,90" },
      { ref: "MAQ-002", description: "Batom Cremoso Hidratante 3,5g - Nude Rosado", price: "22,90" },
      { ref: "MAQ-003", description: "Base Líquida Alta Cobertura 30ml - Bege Médio", price: "49,90" },
      { ref: "MAQ-004", description: "Corretivo Líquido 6ml - Tom Claro", price: "27,90" },
      { ref: "MAQ-005", description: "Pó Compacto Matte FPS 30 - Bege Natural", price: "34,90" },
      { ref: "MAQ-006", description: "Máscara de Cílios Volume Extremo à Prova d'Água 8ml", price: "32,90" },
      { ref: "MAQ-007", description: "Paleta de Sombras 12 Cores - Tons Terrosos", price: "54,90" },
      { ref: "MAQ-008", description: "Blush Compacto 5g - Rosa Pêssego", price: "29,90" },
      { ref: "MAQ-009", description: "Delineador Líquido Preto à Prova d'Água", price: "19,90" },
      { ref: "MAQ-010", description: "Gloss Labial Brilho Intenso 5ml - Transparente (linha descontinuada)", price: "17,90", inactive: true },
    ],
  },
  {
    category: "Skincare",
    products: [
      { ref: "SKN-001", description: "Sabonete Facial Líquido Controle de Oleosidade 150ml", price: "28,90" },
      { ref: "SKN-002", description: "Água Micelar 5 em 1 200ml", price: "31,90" },
      { ref: "SKN-003", description: "Sérum Facial Vitamina C 30ml", price: "69,90" },
      { ref: "SKN-004", description: "Sérum Ácido Hialurônico 30ml", price: "74,90" },
      { ref: "SKN-005", description: "Hidratante Facial Oil Free FPS 30 50g", price: "44,90" },
      { ref: "SKN-006", description: "Protetor Solar Facial Toque Seco FPS 60 50g", price: "52,90" },
      { ref: "SKN-007", description: "Máscara Facial de Argila Verde 100g", price: "26,90" },
      { ref: "SKN-008", description: "Creme para Área dos Olhos Anti-Olheiras 15g", price: "39,90" },
      { ref: "SKN-009", description: "Tônico Facial Adstringente 200ml", price: "24,90" },
    ],
  },
  {
    category: "Cabelos",
    products: [
      { ref: "CAB-001", description: "Shampoo Hidratação Profunda 300ml", price: "21,90" },
      { ref: "CAB-002", description: "Condicionador Hidratação Profunda 300ml", price: "21,90" },
      { ref: "CAB-003", description: "Máscara de Tratamento Reconstrução 250g", price: "38,90" },
      { ref: "CAB-004", description: "Leave-in Protetor Térmico 150ml", price: "29,90" },
      { ref: "CAB-005", description: "Óleo Capilar Reparador de Pontas 60ml", price: "34,90" },
      { ref: "CAB-006", description: "Shampoo Anticaspa 350ml", price: "23,90" },
      { ref: "CAB-007", description: "Creme para Pentear Cachos Definidos 300ml", price: "27,90" },
      { ref: "CAB-008", description: "Tintura Permanente 6.0 Louro Escuro 50g (fora de linha)", price: "18,90", inactive: true },
      { ref: "CAB-009", description: "Spray Fixador Forte 250ml", price: "20,90" },
    ],
  },
  {
    category: "Perfumaria",
    products: [
      { ref: "PRF-001", description: "Deo Colônia Floral 100ml", price: "59,90" },
      { ref: "PRF-002", description: "Perfume Feminino Eau de Parfum Rosa e Baunilha 50ml", price: "129,90" },
      { ref: "PRF-003", description: "Perfume Masculino Eau de Toilette Amadeirado 100ml", price: "119,90" },
      { ref: "PRF-004", description: "Body Splash Frutas Vermelhas 200ml", price: "39,90" },
      { ref: "PRF-005", description: "Body Splash Flor de Cerejeira 200ml", price: "39,90" },
      { ref: "PRF-006", description: "Perfume Unissex Âmbar e Sândalo 75ml", price: "149,90" },
      { ref: "PRF-007", description: "Miniatura Perfume Feminino 15ml", price: "29,90" },
      { ref: "PRF-008", description: "Kit Presente Perfume + Loção Hidratante (edição de fim de ano)", price: "169,90", inactive: true },
    ],
  },
  {
    category: "Corpo e Banho",
    products: [
      { ref: "COR-001", description: "Sabonete em Barra Amêndoas 90g", price: "4,50" },
      { ref: "COR-002", description: "Sabonete Líquido Íntimo 200ml", price: "19,90" },
      { ref: "COR-003", description: "Loção Hidratante Corporal Manteiga de Karité 400ml", price: "32,90" },
      { ref: "COR-004", description: "Esfoliante Corporal Açúcar e Coco 250g", price: "36,90" },
      { ref: "COR-005", description: "Óleo Corporal de Amêndoas 120ml", price: "29,90" },
      { ref: "COR-006", description: "Sabonete Líquido Corporal Lavanda 300ml", price: "18,90" },
      { ref: "COR-007", description: "Creme para Mãos Nutritivo 75g", price: "14,90" },
      { ref: "COR-008", description: "Desodorante Roll-on 48h 50ml", price: "12,90" },
      { ref: "COR-009", description: "Protetor Solar Corporal FPS 50 200ml", price: "49,90" },
    ],
  },
  {
    category: "Unhas",
    products: [
      { ref: "UNH-001", description: "Esmalte Cremoso 8ml - Vermelho Clássico", price: "6,90" },
      { ref: "UNH-002", description: "Esmalte Cremoso 8ml - Nude Rosado", price: "6,90" },
      { ref: "UNH-003", description: "Esmalte Efeito Gel 9ml - Azul Marinho", price: "8,90" },
      { ref: "UNH-004", description: "Base Fortalecedora de Unhas 10ml", price: "11,90" },
      { ref: "UNH-005", description: "Top Coat Brilho Extremo 10ml", price: "12,90" },
      { ref: "UNH-006", description: "Removedor de Esmalte sem Acetona 100ml", price: "9,90" },
      { ref: "UNH-007", description: "Kit Manicure 5 Peças em Estojo", price: "24,90" },
      { ref: "UNH-008", description: "Óleo de Cutículas 15ml", price: "10,90" },
    ],
  },
  {
    category: "Cuidados Masculinos",
    products: [
      { ref: "BAR-001", description: "Balm para Barba Hidratante 60g", price: "29,90" },
      { ref: "BAR-002", description: "Óleo para Barba Amadeirado 30ml", price: "32,90" },
      { ref: "BAR-003", description: "Shampoo para Barba 140ml", price: "24,90" },
      { ref: "BAR-004", description: "Pomada Modeladora Efeito Matte 80g", price: "27,90" },
      { ref: "BAR-005", description: "Pós-Barba Calmante 100ml", price: "22,90" },
      { ref: "BAR-006", description: "Gel de Barbear Transparente 200g", price: "17,90" },
      { ref: "BAR-007", description: "Sabonete Facial Masculino Esfoliante 100ml", price: "19,90" },
    ],
  },
  {
    category: "Acessórios de Beleza",
    products: [
      { ref: "ACE-001", description: "Pincel de Base com Cerdas Sintéticas", price: "19,90" },
      { ref: "ACE-002", description: "Kit 5 Pincéis para Maquiagem em Estojo", price: "59,90" },
      { ref: "ACE-003", description: "Esponja de Maquiagem Formato Gota (2 unidades)", price: "14,90" },
      { ref: "ACE-004", description: "Curvador de Cílios Profissional", price: "16,90" },
      { ref: "ACE-005", description: "Pinça de Sobrancelha Ponta Inclinada", price: "13,90" },
      { ref: "ACE-006", description: "Espelho de Bolso com Aumento 5x", price: "11,90" },
      { ref: "ACE-007", description: "Necessaire Organizadora Média", price: "26,90" },
      { ref: "ACE-008", description: "Escova de Cabelo Raquete Antiestática", price: "31,90" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pedidos de exemplo (clientes fictícios; o histórico se espalha pelos últimos ~40 dias)
// ---------------------------------------------------------------------------

type SeedOrder = {
  /** Dono do pedido: quem o lançou (define quem o enxerga no histórico). */
  owner: keyof typeof OWNER_EMAILS;
  customer: string;
  phone?: string;
  notes?: string;
  status: OrderStatus;
  daysAgo: number;
  /** [referência do produto, quantidade] */
  items: [string, number][];
};

const OWNER_EMAILS = {
  admin: "admin@pedidos.local",
  consultor: "consultor@pedidos.local",
  cliente: "cliente@pedidos.local",
} as const;

const ORDERS: SeedOrder[] = [
  {
    owner: "consultor", customer: "Studio Bela Vida", phone: "(11) 98765-4321",
    notes: "Entregar no período da manhã.", status: "CONFIRMADO", daysAgo: 38,
    items: [["MAQ-001", 12], ["MAQ-003", 6], ["MAQ-005", 6], ["ACE-002", 4]],
  },
  {
    owner: "consultor", customer: "Perfumaria Essência", phone: "(21) 99876-5432",
    status: "CONFIRMADO", daysAgo: 34,
    items: [["PRF-002", 6], ["PRF-003", 6], ["PRF-006", 4], ["PRF-004", 12]],
  },
  {
    owner: "cliente", customer: "Ana Paula Ribeiro", phone: "(31) 97654-3210",
    notes: "Presente de aniversário, embalar para presente.", status: "CONFIRMADO", daysAgo: 30,
    items: [["SKN-003", 1], ["SKN-006", 1], ["ACE-007", 1]],
  },
  {
    owner: "consultor", customer: "Salão Cabelo & Arte", phone: "(11) 91234-5678",
    notes: "Pagamento no boleto, 28 dias.", status: "CONFIRMADO", daysAgo: 27,
    items: [["CAB-001", 24], ["CAB-002", 24], ["CAB-003", 12], ["CAB-005", 10]],
  },
  {
    owner: "consultor", customer: "Drogaria Vida Nova", phone: "(41) 98888-1122",
    notes: "Cliente desistiu da compra.", status: "CANCELADO", daysAgo: 25,
    items: [["SKN-001", 20], ["SKN-005", 10], ["COR-008", 30]],
  },
  {
    owner: "admin", customer: "Espaço Nails & Co", phone: "(85) 99911-2233",
    status: "CONFIRMADO", daysAgo: 21,
    items: [["UNH-001", 36], ["UNH-002", 36], ["UNH-004", 12], ["UNH-005", 12], ["UNH-006", 12]],
  },
  {
    owner: "cliente", customer: "Carla Mendes", phone: "(11) 99123-4455",
    status: "CONFIRMADO", daysAgo: 18,
    items: [["CAB-004", 2], ["CAB-007", 2], ["CAB-003", 1]],
  },
  {
    owner: "consultor", customer: "Barbearia Navalha de Ouro", phone: "(51) 98123-9900",
    notes: "Cliente retira na loja.", status: "CONFIRMADO", daysAgo: 14,
    items: [["BAR-001", 12], ["BAR-002", 12], ["BAR-004", 18], ["BAR-005", 12]],
  },
  {
    owner: "consultor", customer: "Beleza Pura Cosméticos", phone: "(62) 99654-7788",
    notes: "Urgente: reposição de estoque.", status: "PENDENTE", daysAgo: 9,
    items: [["MAQ-002", 12], ["MAQ-004", 12], ["MAQ-006", 18], ["MAQ-007", 6], ["MAQ-008", 12], ["MAQ-009", 12]],
  },
  {
    owner: "cliente", customer: "Juliana Alves", phone: "(19) 98765-0011",
    status: "PENDENTE", daysAgo: 6,
    items: [["SKN-002", 2], ["SKN-004", 1], ["SKN-007", 2]],
  },
  {
    owner: "admin", customer: "Empório da Beleza", phone: "(71) 99777-3344",
    notes: "Enviar a nota fiscal por e-mail.", status: "CONFIRMADO", daysAgo: 5,
    items: [["COR-003", 24], ["COR-004", 12], ["COR-005", 12], ["COR-006", 24], ["COR-007", 30]],
  },
  {
    owner: "consultor", customer: "Clínica Estética Renova", phone: "(11) 97788-9900",
    status: "PENDENTE", daysAgo: 3,
    items: [["SKN-001", 12], ["SKN-003", 10], ["SKN-004", 10], ["SKN-006", 20], ["SKN-008", 12]],
  },
  {
    owner: "cliente", customer: "Fernanda Lima", phone: "(21) 99001-2345",
    status: "PENDENTE", daysAgo: 1,
    items: [["PRF-007", 3], ["UNH-007", 2], ["ACE-006", 2]],
  },
  {
    owner: "consultor", customer: "Mercearia & Perfumaria Estrela",
    status: "PENDENTE", daysAgo: 0,
    items: [["PRF-001", 12], ["COR-001", 60], ["COR-002", 24]],
  },
];

/** Chave em `app_meta` que indica que os pedidos de exemplo já foram criados. */
const ORDERS_MARKER = "seed:catalog-orders";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type CatalogProduct = { id: string; reference: string; description: string; priceCents: number };

async function seedCategoriesAndProducts(): Promise<Map<string, CatalogProduct>> {
  const db = getDb();
  let newCategories = 0;
  let newProducts = 0;

  for (const { category, products: items } of CATALOG) {
    const { name } = categoryInputSchema.parse({ name: category });
    const createdCategory = await db
      .insert(categories)
      .values({ name })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    newCategories += createdCategory.length;

    const [{ id: categoryId }] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(sql`lower(${categories.name}) = lower(${name})`);

    const values = items.map((item) => {
      const priceCents = parseMoneyToCents(item.price);
      if (priceCents === null) throw new Error(`Preço inválido em ${item.ref}: "${item.price}"`);
      return productInputSchema.parse({
        reference: item.ref,
        description: item.description,
        priceCents,
        categoryId,
        active: !item.inactive,
      });
    });
    const createdProducts = await db
      .insert(products)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: products.id });
    newProducts += createdProducts.length;
  }

  const refs = CATALOG.flatMap(({ products: items }) => items.map((item) => item.ref));
  const rows = await db
    .select({
      id: products.id,
      reference: products.reference,
      description: products.description,
      priceCents: products.priceCents,
    })
    .from(products)
    .where(inArray(products.reference, refs));

  console.log(`✔ Categorias: ${newCategories} nova(s), ${CATALOG.length - newCategories} já existia(m)`);
  console.log(`✔ Produtos:   ${newProducts} novo(s), ${refs.length - newProducts} já existia(m)`);
  return new Map(rows.map((row) => [row.reference, row]));
}

async function seedOrders(catalog: Map<string, CatalogProduct>): Promise<void> {
  const db = getDb();

  const [marker] = await db.select().from(appMeta).where(eq(appMeta.key, ORDERS_MARKER));
  if (marker) {
    console.log(`• Pedidos:    já criados em ${marker.value}; nada a fazer`);
    return;
  }

  const emails = Object.values(OWNER_EMAILS);
  const userRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(sql`lower(${users.email})`, emails));
  const userIdByOwner = new Map<string, string>();
  for (const [owner, email] of Object.entries(OWNER_EMAILS)) {
    const user = userRows.find((row) => row.email.toLowerCase() === email);
    if (!user) throw new Error(`Usuário ${email} não encontrado. Rode "npm run db:seed" antes.`);
    userIdByOwner.set(owner, user.id);
  }

  const now = Date.now();
  await db.transaction(async (tx) => {
    for (const [index, seed] of ORDERS.entries()) {
      const lines = seed.items.map(([reference, quantity]) => {
        const product = catalog.get(reference);
        if (!product) throw new Error(`Pedido de "${seed.customer}": produto ${reference} não existe`);
        return {
          productId: product.id,
          reference: product.reference,
          description: product.description,
          unitPriceCents: product.priceCents,
          quantity,
        };
      });

      // Mesmas regras de entrada do sistema (telefone só com dígitos, itens sem repetição, quantidades 1–9999).
      const input = createOrderInputSchema.parse({
        customerName: seed.customer,
        customerPhone: seed.phone ?? "",
        notes: seed.notes ?? "",
        items: lines.map(({ productId, quantity }) => ({ productId, quantity })),
      });
      const totals = calculateOrder(lines);
      if (totals.exceedsLimit) throw new Error(`Pedido de "${seed.customer}" excede o limite de valor`);

      // Horários variados no dia, para o histórico não ficar todo no mesmo minuto.
      const createdAt = new Date(now - seed.daysAgo * DAY_MS - (index % 6) * HOUR_MS);

      const [order] = await tx
        .insert(orders)
        .values({
          userId: userIdByOwner.get(seed.owner)!,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          notes: input.notes,
          status: seed.status,
          totalCents: totals.totalCents,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: orders.id });

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
    }
    await tx.insert(appMeta).values({ key: ORDERS_MARKER, value: new Date(now).toISOString() });
  });

  console.log(`✔ Pedidos:    ${ORDERS.length} criado(s)`);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed de desenvolvimento não deve rodar em produção.");
  }
  const catalog = await seedCategoriesAndProducts();
  await seedOrders(catalog);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
