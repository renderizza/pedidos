import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FormError, SubmitButton } from "./form-ui";

describe("Field", () => {
  it("liga o rótulo ao controle", () => {
    render(<Field label="Nome" name="name">{(p) => <input {...p} name="name" />}</Field>);
    expect(screen.getByLabelText("Nome")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("Nome")).not.toHaveAttribute("aria-invalid");
  });

  it("com erros: marca aria-invalid, aponta aria-describedby e mostra as mensagens", () => {
    render(
      <Field label="Nome" name="name" errors={["Obrigatório", "Muito curto"]}>
        {(p) => <input {...p} name="name" />}
      </Field>,
    );
    const input = screen.getByLabelText("Nome");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent("ObrigatórioMuito curto");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("mostra a dica só enquanto não há erro", () => {
    const { rerender } = render(
      <Field label="Preço" name="price" hint="Ex.: 12,50">{(p) => <input {...p} />}</Field>,
    );
    expect(screen.getByText("Ex.: 12,50")).toBeInTheDocument();
    rerender(
      <Field label="Preço" name="price" hint="Ex.: 12,50" errors={["Inválido"]}>
        {(p) => <input {...p} />}
      </Field>,
    );
    expect(screen.queryByText("Ex.: 12,50")).not.toBeInTheDocument();
  });
});

describe("FormError / SubmitButton", () => {
  it("FormError só aparece com mensagem", () => {
    const { rerender } = render(<FormError />);
    expect(screen.queryByTestId("form-error")).not.toBeInTheDocument();
    rerender(<FormError message="Algo deu errado" />);
    expect(screen.getByTestId("form-error")).toHaveTextContent("Algo deu errado");
  });

  it("SubmitButton mostra o rótulo e é do tipo submit", () => {
    render(
      <form>
        <SubmitButton>Salvar</SubmitButton>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Salvar" })).toHaveAttribute("type", "submit");
  });
});
