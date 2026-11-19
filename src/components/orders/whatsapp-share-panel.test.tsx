import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsAppSharePanel } from "./whatsapp-share-panel";

const props = {
  message: "*PEDIDO #7*\nCliente: João",
  storeUrl: "https://wa.me/5511999998888?text=x",
  customerUrl: "https://wa.me/5511988887777?text=x",
};

describe("WhatsAppSharePanel", () => {
  it("mostra a mensagem e os links abrindo em nova aba, sem vazar o referrer", () => {
    render(<WhatsAppSharePanel {...props} />);
    expect(screen.getByTestId("whatsapp-message")).toHaveTextContent("*PEDIDO #7*");
    for (const [testId, href] of [["whatsapp-link", props.storeUrl], ["whatsapp-customer-link", props.customerUrl]]) {
      const link = screen.getByTestId(testId);
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByRole("button", { name: /Copiar/ })).toBeInTheDocument();
  });

  it("sem telefone do cliente, só o link da loja", () => {
    render(<WhatsAppSharePanel {...props} customerUrl={null} />);
    expect(screen.getByTestId("whatsapp-link")).toBeInTheDocument();
    expect(screen.queryByTestId("whatsapp-customer-link")).not.toBeInTheDocument();
  });
});
