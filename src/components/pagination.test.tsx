import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pagination } from "./pagination";

const hrefFor = (page: number) => `/lista?pagina=${page}`;

describe("Pagination", () => {
  it("não renderiza nada quando há uma única página", () => {
    const { container } = render(<Pagination page={1} totalPages={1} hrefFor={hrefFor} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("primeira página: 'Anterior' desabilitado e 'Próxima' é link", () => {
    render(<Pagination page={1} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.getByTestId("pagination-status")).toHaveTextContent("Página 1 de 3");
    expect(screen.getByText("Anterior")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Próxima" })).toHaveAttribute("href", "/lista?pagina=2");
  });

  it("página do meio: os dois links aparecem", () => {
    render(<Pagination page={2} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/lista?pagina=1");
    expect(screen.getByRole("link", { name: "Próxima" })).toHaveAttribute("href", "/lista?pagina=3");
  });

  it("última página: 'Próxima' desabilitado", () => {
    render(<Pagination page={3} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.getByText("Próxima")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Anterior" })).toBeInTheDocument();
  });
});
