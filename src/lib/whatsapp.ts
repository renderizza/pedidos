import { formatCents } from "@/lib/money";

export type WhatsAppOrder = {
  orderNumber: number;
  createdAt: Date;
  /** `null` = pedido interno, sem cliente (não segue por WhatsApp): a linha é omitida. */
  customerName: string | null;
  /** Só dígitos (como gravado no banco). */
  customerPhone: string | null;
  notes: string | null;
  /** Quem lançou o pedido (consultor, cliente ou admin). `null` = visitante sem cadastro: a linha é omitida. */
  requesterName: string | null;
  totalCents: number;
  items: {
    reference: string;
    description: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }[];
};

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** Valores monetários sem o espaço "não separável" que o Intl coloca depois do "R$". */
const money = (cents: number) => formatCents(cents).replace(/ /g, " ");

/** Campo de linha única: quebras de linha e espaços repetidos viram um espaço só. */
function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Texto livre (observações): mantém quebras de linha, remove controles e limita linhas em branco. */
function multiLine(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 18/11/2026 14:35 — sempre no mesmo fuso, independente de onde o servidor roda. */
export function formatOrderDate(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/**
 * Telefone brasileiro para o wa.me: 10–11 dígitos (DDD + número) ganham o 55;
 * 12–13 dígitos precisam já começar com 55. Qualquer outra coisa é inválida (`null`).
 */
export function normalizeBrazilPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^\d{10,11}$/.test(digits)) return `55${digits}`;
  if (/^55\d{10,11}$/.test(digits)) return digits;
  return null;
}

/** 11988887777 → (11) 98888-7777; 1133334444 → (11) 3333-4444. Sem formato conhecido, devolve como veio. */
export function formatBrazilPhone(input: string): string {
  const normalized = normalizeBrazilPhone(input);
  if (!normalized) return input;
  const national = normalized.slice(2);
  const ddd = national.slice(0, 2);
  const number = national.slice(2);
  const split = number.length === 9 ? 5 : 4;
  return `(${ddd}) ${number.slice(0, split)}-${number.slice(split)}`;
}

/** Mensagem do pedido no formato do WhatsApp (*negrito*), pronta para envio. */
export function formatOrderMessage(order: WhatsAppOrder, options: { timeZone?: string } = {}): string {
  const lines: string[] = [
    `*PEDIDO #${order.orderNumber}*`,
    `Data: ${formatOrderDate(order.createdAt, options.timeZone)}`,
  ];
  if (order.requesterName) lines.push(`Lançado por: ${singleLine(order.requesterName)}`);
  if (order.customerName) lines.push(`Cliente: ${singleLine(order.customerName)}`);
  if (order.customerPhone) lines.push(`Telefone: ${formatBrazilPhone(order.customerPhone)}`);

  lines.push("", "*ITENS*");
  order.items.forEach((item, index) => {
    lines.push(
      `${index + 1}) ${item.reference} - ${singleLine(item.description)}`,
      `    ${item.quantity} x ${money(item.unitPriceCents)} = ${money(item.lineTotalCents)}`,
    );
  });

  const unitCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  lines.push("", `*TOTAL: ${money(order.totalCents)}*`, `${order.items.length} produto(s) | ${unitCount} unidade(s)`);

  const notes = order.notes ? multiLine(order.notes) : "";
  if (notes) lines.push("", "Observações:", notes);

  return lines.join("\n");
}

/**
 * Link do WhatsApp com a mensagem já preenchida.
 * Com `phone` válido abre a conversa com esse número; sem ele, o WhatsApp deixa o usuário escolher o contato.
 */
export function buildWhatsAppUrl(message: string, phone?: string | null): string {
  const target = phone ? normalizeBrazilPhone(phone) : null;
  return `https://wa.me/${target ?? ""}?text=${encodeURIComponent(message)}`;
}
