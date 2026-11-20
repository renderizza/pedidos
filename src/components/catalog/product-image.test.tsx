import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductImage } from "./product-image";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const DIRECT = `https://lh3.googleusercontent.com/d/${ID}`;
const SHARE_LINK = `https://drive.google.com/file/d/${ID}/view?usp=sharing`;

const image = () => screen.getByRole("img", { name: "Camiseta azul" });

describe("ProductImage", () => {
  it.each([null, undefined, "", "   ", "http://exemplo.com/a.jpg", "https://drive.google.com/drive/folders/abc", "não é url"])(
    "sem imagem utilizável (%j): não renderiza nada",
    (url) => {
      const { container } = render(<ProductImage url={url} width={400} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("Drive: pede miniatura do tamanho certo (com versão 2x) e usa os atributos que evitam falhas", () => {
    render(<ProductImage url={DIRECT} alt="Camiseta azul" width={400} />);
    const img = image();
    expect(img).toHaveAttribute("src", `${DIRECT}=w400`);
    expect(img).toHaveAttribute("srcset", `${DIRECT}=w400 1x, ${DIRECT}=w800 2x`);
    // Sem Referer o Google não recusa a requisição por causa do site de origem.
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("aceita o link de compartilhamento do Drive (dado antigo ou gravado direto no banco)", () => {
    render(<ProductImage url={SHARE_LINK} alt="Camiseta azul" width={64} />);
    expect(image()).toHaveAttribute("src", `${DIRECT}=w64`);
  });

  it("outros sites: usa o endereço como está, sem sufixo de tamanho", () => {
    render(<ProductImage url="https://exemplo.com/a.jpg" alt="Camiseta azul" width={400} />);
    expect(image()).toHaveAttribute("src", "https://exemplo.com/a.jpg");
    expect(image()).not.toHaveAttribute("srcset");
  });

  it("imagem decorativa (alt vazio) não aparece como imagem para leitores de tela", () => {
    render(<ProductImage url={DIRECT} width={400} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("presentation")).toHaveAttribute("src", `${DIRECT}=w400`);
  });

  it("se a miniatura falhar, tenta o endereço puro do Drive antes de desistir", () => {
    render(<ProductImage url={DIRECT} alt="Camiseta azul" width={400} />);
    fireEvent.error(image());

    expect(image()).toHaveAttribute("src", DIRECT);
    expect(image()).not.toHaveAttribute("srcset");
    expect(screen.queryByTestId("product-image-fallback")).not.toBeInTheDocument();
  });

  it("se tudo falhar (arquivo não compartilhado, apagado, cota), mostra o espaço reservado — não o ícone de imagem quebrada", () => {
    render(<ProductImage url={DIRECT} alt="Camiseta azul" width={400} className="aspect-[4/3]" />);
    fireEvent.error(image());
    fireEvent.error(image());

    expect(screen.queryByRole("img", { name: "Camiseta azul" })).not.toBeInTheDocument();
    const fallback = screen.getByTestId("product-image-fallback");
    expect(fallback).toHaveAttribute("aria-hidden", "true");
    expect(fallback).toHaveClass("aspect-[4/3]"); // mantém o tamanho: a lista não "pula"
  });

  it('onFailure="hidden": ao falhar de vez, some sem deixar rastro', () => {
    const { container } = render(<ProductImage url="https://exemplo.com/a.jpg" alt="Camiseta azul" width={48} onFailure="hidden" />);
    fireEvent.error(image());
    expect(container).toBeEmptyDOMElement();
  });

  it("endereço de outro site que falha vai direto ao espaço reservado (não há segunda tentativa)", () => {
    render(<ProductImage url="https://exemplo.com/a.jpg" alt="Camiseta azul" width={48} />);
    fireEvent.error(image());
    expect(screen.getByTestId("product-image-fallback")).toBeInTheDocument();
  });

  it("trocar a URL recomeça do zero: uma falha antiga não esconde a imagem nova", () => {
    const { rerender } = render(<ProductImage url="https://exemplo.com/quebrada.jpg" alt="Camiseta azul" width={48} />);
    fireEvent.error(image());
    expect(screen.getByTestId("product-image-fallback")).toBeInTheDocument();

    rerender(<ProductImage url={DIRECT} alt="Camiseta azul" width={48} />);
    expect(image()).toHaveAttribute("src", `${DIRECT}=w48`);
    expect(screen.queryByTestId("product-image-fallback")).not.toBeInTheDocument();
  });
});
