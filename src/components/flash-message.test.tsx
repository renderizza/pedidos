import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlashMessage } from "./flash-message";

describe("FlashMessage", () => {
  it.each([
    ["created", "Cadastro realizado com sucesso."],
    ["updated", "Alterações salvas com sucesso."],
  ])("mostra a mensagem para status=%s", (status, text) => {
    render(<FlashMessage status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it.each([undefined, "", "hacked", "<script>alert(1)</script>", ["created"]])(
    "não mostra nada para %j (só status conhecidos são exibidos)",
    (status) => {
      const { container } = render(<FlashMessage status={status as string | undefined} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
