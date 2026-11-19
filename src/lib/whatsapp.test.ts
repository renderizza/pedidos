import { describe, expect, it } from "vitest";
import {
  buildWhatsAppUrl,
  formatBrazilPhone,
  formatOrderDate,
  formatOrderMessage,
  normalizeBrazilPhone,
  type WhatsAppOrder,
} from "./whatsapp";

// 18/11/2026 17:35 UTC = 14:35 em São Paulo (UTC−3, sem horário de verão)
const baseOrder: WhatsAppOrder = {
  orderNumber: 123,
  createdAt: new Date("2026-11-18T17:35:00Z"),
  customerName: "João da Loja",
  customerPhone: "11988887777",
  notes: "Entregar pela manhã",
  requesterName: "Caio Consultor",
  totalCents: 14790,
  items: [
    { reference: "CAM-01", description: "Camiseta azul", unitPriceCents: 1990, quantity: 3, lineTotalCents: 5970 },
    { reference: "SUC-01", description: "Suco de uva", unitPriceCents: 735, quantity: 12, lineTotalCents: 8820 },
  ],
};

describe("formatOrderMessage", () => {
  it("monta a mensagem completa no formato do WhatsApp", () => {
    expect(formatOrderMessage(baseOrder)).toBe(
      [
        "*PEDIDO #123*",
        "Data: 18/11/2026 14:35",
        "Lançado por: Caio Consultor",
        "Cliente: João da Loja",
        "Telefone: (11) 98888-7777",
        "",
        "*ITENS*",
        "1) CAM-01 - Camiseta azul",
        "    3 x R$ 19,90 = R$ 59,70",
        "2) SUC-01 - Suco de uva",
        "    12 x R$ 7,35 = R$ 88,20",
        "",
        "*TOTAL: R$ 147,90*",
        "2 produto(s) | 15 unidade(s)",
        "",
        "Observações:",
        "Entregar pela manhã",
      ].join("\n"),
    );
  });

  it("omite telefone e observações quando não existem", () => {
    const message = formatOrderMessage({ ...baseOrder, customerPhone: null, notes: null });
    expect(message).not.toContain("Telefone:");
    expect(message).not.toContain("Observações");
    expect(message.endsWith("2 produto(s) | 15 unidade(s)")).toBe(true);
  });

  it("observações só com espaços/quebras também são omitidas", () => {
    expect(formatOrderMessage({ ...baseOrder, notes: "  \n \n " })).not.toContain("Observações");
  });

  it("usa espaço comum nos valores (sem o espaço 'não separável' do Intl)", () => {
    expect(formatOrderMessage(baseOrder)).not.toMatch(/ /);
  });

  it("mostra todos os itens, na ordem recebida, com numeração", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      reference: `R-${i + 1}`,
      description: `Produto ${i + 1}`,
      unitPriceCents: 100,
      quantity: 1,
      lineTotalCents: 100,
    }));
    const message = formatOrderMessage({ ...baseOrder, items, totalCents: 1200 });
    const numbered = message.split("\n").filter((line) => /^\d+\) /.test(line));
    expect(numbered).toHaveLength(12);
    expect(numbered[0]).toBe("1) R-1 - Produto 1");
    expect(numbered[11]).toBe("12) R-12 - Produto 12");
    expect(message).toContain("12 produto(s) | 12 unidade(s)");
  });

  it("formata milhares e centavos corretamente", () => {
    const message = formatOrderMessage({
      ...baseOrder,
      totalCents: 123456789,
      items: [{ reference: "X", description: "Caro", unitPriceCents: 123456789, quantity: 1, lineTotalCents: 123456789 }],
    });
    expect(message).toContain("*TOTAL: R$ 1.234.567,89*");
    expect(message).toContain("1 x R$ 1.234.567,89 = R$ 1.234.567,89");
  });

  it("campos de linha única não quebram a mensagem (quebras e espaços repetidos viram um espaço)", () => {
    const message = formatOrderMessage({
      ...baseOrder,
      customerName: "  João \n da   Loja\r\n*Falso*  ",
      requesterName: "Caio\nConsultor",
      items: [{ ...baseOrder.items[0], description: "Camiseta\n azul\t  gola V" }],
    });
    expect(message).toContain("Cliente: João da Loja *Falso*");
    expect(message).toContain("Lançado por: Caio Consultor");
    expect(message).toContain("1) CAM-01 - Camiseta azul gola V");
  });

  it("observações preservam quebras de linha, mas limpam controles e linhas em branco demais", () => {
    const message = formatOrderMessage({
      ...baseOrder,
      notes: "Linha 1\r\nLinha 2   \n\n\n\n\nLinha\u0007 3\u0000",
    });
    expect(message.endsWith("Observações:\nLinha 1\nLinha 2\n\nLinha 3")).toBe(true);
  });

  it("a data usa o fuso de São Paulo por padrão, mesmo perto da meia-noite", () => {
    const late = formatOrderMessage({ ...baseOrder, createdAt: new Date("2026-11-19T02:30:00Z") });
    expect(late).toContain("Data: 18/11/2026 23:30");
  });

  it("aceita outro fuso horário", () => {
    expect(formatOrderMessage(baseOrder, { timeZone: "UTC" })).toContain("Data: 18/11/2026 17:35");
  });

  it("telefone sem formato conhecido aparece como foi gravado", () => {
    expect(formatOrderMessage({ ...baseOrder, customerPhone: "999" })).toContain("Telefone: 999");
  });

  it("é determinística: a mesma entrada gera sempre o mesmo texto", () => {
    expect(formatOrderMessage(baseOrder)).toBe(formatOrderMessage(structuredClone(baseOrder)));
  });
});

describe("formatOrderDate", () => {
  it.each([
    ["2026-01-05T11:05:00Z", "05/01/2026 08:05"],
    ["2026-12-31T23:59:00Z", "31/12/2026 20:59"],
    ["2026-07-01T03:00:00Z", "01/07/2026 00:00"], // meia-noite: hora "00", não "24"
  ])("%s → %s", (iso, expected) => {
    expect(formatOrderDate(new Date(iso))).toBe(expected);
  });
});

describe("normalizeBrazilPhone", () => {
  it.each([
    ["11988887777", "5511988887777"],
    ["(11) 98888-7777", "5511988887777"],
    ["1133334444", "551133334444"],
    ["5511988887777", "5511988887777"],
    ["+55 11 98888-7777", "5511988887777"],
    ["551133334444", "551133334444"],
  ])("%j → %s", (input, expected) => {
    expect(normalizeBrazilPhone(input)).toBe(expected);
  });

  it.each(["", "123", "abc", "119888877770000", "5411988887777", "011988887777", "55119888"])("rejeita %j", (input) => {
    expect(normalizeBrazilPhone(input)).toBeNull();
  });
});

describe("formatBrazilPhone", () => {
  it.each([
    ["11988887777", "(11) 98888-7777"],
    ["1133334444", "(11) 3333-4444"],
    ["5511988887777", "(11) 98888-7777"],
    ["551133334444", "(11) 3333-4444"],
    ["999", "999"],
  ])("%j → %j", (input, expected) => {
    expect(formatBrazilPhone(input)).toBe(expected);
  });
});

describe("buildWhatsAppUrl", () => {
  it("com telefone: abre a conversa com esse número (com DDI 55)", () => {
    expect(buildWhatsAppUrl("Oi", "11988887777")).toBe("https://wa.me/5511988887777?text=Oi");
  });

  it("sem telefone (ou inválido): o WhatsApp deixa o usuário escolher o contato", () => {
    expect(buildWhatsAppUrl("Oi")).toBe("https://wa.me/?text=Oi");
    expect(buildWhatsAppUrl("Oi", null)).toBe("https://wa.me/?text=Oi");
    expect(buildWhatsAppUrl("Oi", "123")).toBe("https://wa.me/?text=Oi");
  });

  it("a mensagem é codificada e volta idêntica ao decodificar (acentos, quebras, & # % *)", () => {
    const message = "*PEDIDO #1*\nCliente: José & Filhos — 50% off\nÇ ã é 😀";
    const url = buildWhatsAppUrl(message, "11988887777");
    const [, query] = url.split("?text=");
    expect(query).not.toMatch(/[\s&#]/); // nada que quebre a URL (o "*" é válido numa query string)
    expect(query).toContain("%0A");
    expect(decodeURIComponent(query)).toBe(message);
  });

  it("a mensagem completa do pedido sobrevive ao ciclo codificar → decodificar", () => {
    const message = formatOrderMessage(baseOrder);
    const url = new URL(buildWhatsAppUrl(message, baseOrder.customerPhone));
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/5511988887777");
    expect(url.searchParams.get("text")).toBe(message);
  });
});

describe("formatOrderMessage — pedido de visitante (sem cadastro)", () => {
  it("omite a linha 'Lançado por' quando não há quem lançou", () => {
    const message = formatOrderMessage({ ...baseOrder, requesterName: null });
    expect(message).not.toContain("Lançado por");
    expect(message.split("\n").slice(0, 4)).toEqual([
      "*PEDIDO #123*",
      "Data: 18/11/2026 14:35",
      "Cliente: João da Loja",
      "Telefone: (11) 98888-7777",
    ]);
  });

  it("o resto da mensagem é idêntico ao do pedido de usuário", () => {
    const withUser = formatOrderMessage(baseOrder).replace("Lançado por: Caio Consultor\n", "");
    expect(formatOrderMessage({ ...baseOrder, requesterName: null })).toBe(withUser);
  });
});

describe("formatOrderMessage — pedido interno (sem cliente)", () => {
  it("omite a linha 'Cliente' e não quebra", () => {
    const message = formatOrderMessage({ ...baseOrder, customerName: null, customerPhone: null, notes: null });
    expect(message).not.toContain("Cliente:");
    expect(message).not.toContain("Telefone:");
    expect(message.split("\n").slice(0, 3)).toEqual(["*PEDIDO #123*", "Data: 18/11/2026 14:35", "Lançado por: Caio Consultor"]);
    expect(message).toContain("*TOTAL: R$ 147,90*");
  });
});
