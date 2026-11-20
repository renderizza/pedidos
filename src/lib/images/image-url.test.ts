import { describe, expect, it } from "vitest";
import { driveImageUrl, imageSources, MAX_IMAGE_URL_LENGTH, normalizeImageUrl } from "./image-url";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-012345";
const CANONICAL = `https://lh3.googleusercontent.com/d/${ID}`;

function normalized(input: string): string {
  const result = normalizeImageUrl(input);
  if (!result.ok) throw new Error(`esperava link válido, veio erro: ${result.error}`);
  return result.url;
}

function errorOf(input: string): string {
  const result = normalizeImageUrl(input);
  if (result.ok) throw new Error(`esperava erro, veio ${result.url}`);
  return result.error;
}

describe("normalizeImageUrl — links do Google Drive", () => {
  it.each([
    ["compartilhar → copiar link", `https://drive.google.com/file/d/${ID}/view?usp=sharing`],
    ["link de compartilhamento com conta", `https://drive.google.com/file/d/${ID}/view?usp=drive_link`],
    ["sem /view", `https://drive.google.com/file/d/${ID}`],
    ["abrir no editor (/edit)", `https://drive.google.com/file/d/${ID}/edit`],
    ["com índice de conta (/u/0/)", `https://drive.google.com/u/0/file/d/${ID}/view`],
    ["com resourcekey", `https://drive.google.com/file/d/${ID}/view?resourcekey=0-abc`],
    ["open?id=", `https://drive.google.com/open?id=${ID}`],
    ["uc?id=", `https://drive.google.com/uc?id=${ID}`],
    ["uc?export=view&id= (ordem invertida)", `https://drive.google.com/uc?export=view&id=${ID}`],
    ["uc?export=download", `https://drive.google.com/uc?export=download&id=${ID}`],
    ["thumbnail", `https://drive.google.com/thumbnail?id=${ID}&sz=w1000`],
    ["docs.google.com/uc", `https://docs.google.com/uc?export=download&id=${ID}`],
    ["drive.usercontent", `https://drive.usercontent.google.com/download?id=${ID}&export=view`],
    ["já no formato direto", CANONICAL],
    ["direto com sufixo de tamanho", `${CANONICAL}=w400`],
    ["direto com sufixo s220", `${CANONICAL}=s220`],
    ["host em maiúsculas e espaços nas pontas", `  HTTPS://Drive.Google.com/file/d/${ID}/view  `],
  ])("%s → endereço direto", (_label, input) => {
    expect(normalized(input)).toBe(CANONICAL);
  });

  it("é idempotente: normalizar de novo não muda nada", () => {
    for (const input of [`https://drive.google.com/file/d/${ID}/view`, "https://exemplo.com/foto.jpg"]) {
      const once = normalized(input);
      expect(normalized(once)).toBe(once);
    }
  });

  it("monta o endereço direto a partir do ID", () => {
    expect(driveImageUrl(ID)).toBe(CANONICAL);
  });

  it.each([
    ["pasta", "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"],
    ["pasta com conta", "https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"],
    ["pasta (formato antigo)", "https://drive.google.com/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"],
  ])("recusa link de %s, explicando o motivo", (_label, input) => {
    expect(errorOf(input)).toContain("pasta");
  });

  it.each([
    ["documento do Google Docs", `https://docs.google.com/document/d/${ID}/edit`],
    ["planilha", `https://docs.google.com/spreadsheets/d/${ID}/edit`],
    ["página inicial do Drive", "https://drive.google.com/"],
    ["open sem id", "https://drive.google.com/open"],
    ["id curto demais", "https://drive.google.com/file/d/abc/view"],
    ["id com caracteres estranhos", "https://drive.google.com/open?id=../../etc/passwd"],
    ["lh3 /d/ com id curto", "https://lh3.googleusercontent.com/d/abc"],
  ])("recusa %s (não é uma imagem do Drive)", (_label, input) => {
    expect(errorOf(input)).toContain("Drive");
  });
});

describe("normalizeImageUrl — outros endereços", () => {
  it("aceita qualquer endereço https como está", () => {
    expect(normalized("https://exemplo.com/fotos/camiseta.jpg")).toBe("https://exemplo.com/fotos/camiseta.jpg");
    expect(normalized(" https://cdn.exemplo.com/a.png?v=2 ")).toBe("https://cdn.exemplo.com/a.png?v=2");
  });

  it("grava a forma canônica: esquema/host em minúsculas e espaços codificados (a constraint do banco é sensível a maiúsculas)", () => {
    expect(normalized("HTTPS://Exemplo.COM/Fotos/A.jpg")).toBe("https://exemplo.com/Fotos/A.jpg");
    expect(normalized("https://exemplo.com/minha foto.jpg")).toBe("https://exemplo.com/minha%20foto.jpg");
  });

  it("mantém links diretos do Google que não são do Drive (ex.: Google Fotos)", () => {
    const photos = "https://lh3.googleusercontent.com/pw/AP1GczExemplo=w800-h600";
    expect(normalized(photos)).toBe(photos);
  });

  it.each([
    ["vazio", "", "Informe o endereço"],
    ["só espaços", "   ", "Informe o endereço"],
    ["texto solto", "foto da camiseta", "inválido"],
    ["sem protocolo", "drive.google.com/file/d/abc", "inválido"],
    ["http (conteúdo misto)", "http://exemplo.com/a.jpg", "https://"],
    ["javascript:", "javascript:alert(1)", "https://"],
    ["data:", "data:image/png;base64,AAAA", "https://"],
    ["file:", "file:///etc/passwd", "https://"],
    ["usuário e senha na URL", "https://admin:senha@exemplo.com/a.jpg", "inválido"],
  ])("recusa %s", (_label, input, fragment) => {
    expect(errorOf(input)).toContain(fragment);
  });

  it("recusa endereço maior que o limite da coluna", () => {
    const long = `https://exemplo.com/${"a".repeat(MAX_IMAGE_URL_LENGTH)}`;
    expect(errorOf(long)).toContain(String(MAX_IMAGE_URL_LENGTH));
    const atLimit = `https://exemplo.com/${"a".repeat(MAX_IMAGE_URL_LENGTH - "https://exemplo.com/".length)}`;
    expect(atLimit).toHaveLength(MAX_IMAGE_URL_LENGTH);
    expect(normalizeImageUrl(atLimit).ok).toBe(true);
  });
});

describe("imageSources", () => {
  it("Drive: pede miniatura no tamanho certo (1x e 2x) e guarda o endereço puro como segunda tentativa", () => {
    expect(imageSources(CANONICAL, 400)).toEqual({
      candidates: [
        { src: `${CANONICAL}=w400`, srcSet: `${CANONICAL}=w400 1x, ${CANONICAL}=w800 2x` },
        { src: CANONICAL },
      ],
    });
  });

  it("aceita um link de compartilhamento (dado antigo ou gravado direto no banco)", () => {
    const sources = imageSources(`https://drive.google.com/file/d/${ID}/view?usp=sharing`, 64);
    expect(sources?.candidates[0].src).toBe(`${CANONICAL}=w64`);
  });

  it("outros sites: um único endereço, sem sufixo de tamanho", () => {
    expect(imageSources("https://exemplo.com/a.jpg", 400)).toEqual({
      candidates: [{ src: "https://exemplo.com/a.jpg" }],
    });
  });

  it.each([null, undefined, "", "   ", "http://exemplo.com/a.jpg", "javascript:alert(1)", "https://drive.google.com/drive/folders/abc"])(
    "devolve null para %j (nada a exibir)",
    (value) => {
      expect(imageSources(value, 400)).toBeNull();
    },
  );
});
