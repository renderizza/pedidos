/** DDD (2) + número com o 9 do celular (9). */
const MAX_DIGITS = 11;

/**
 * Máscara do telefone brasileiro enquanto a pessoa digita: `(xx)xxxxx-xxxx` (celular).
 * Fixo, com 10 dígitos, sai como `(xx)xxxx-xxxx`. O resultado é sempre o que deve aparecer no campo.
 *
 * - Ignora tudo que não é dígito e limita a 11 dígitos (DDD + número).
 * - O parêntese só fecha a partir do 3º dígito: se fechasse em "(11)", o Backspace ficaria preso nele.
 * - `previous` é o valor do campo antes desta edição. Serve para reconhecer uma colagem (ou preenchimento
 *   automático): vários dígitos de uma vez de um número com código do país ("+55 11 98888-7777") perdem o 55.
 *   Digitando, o 12º dígito é só descartado, porque 55 também é DDD (Rio Grande do Sul).
 *
 * O servidor continua aceitando qualquer pontuação e guardando só os dígitos (`phoneSchema`).
 */
export function maskBrazilPhone(raw: string, previous = ""): string {
  let digits = raw.replace(/\D/g, "");
  const previousLength = previous.replace(/\D/g, "").length;

  if (digits.length > MAX_DIGITS && digits.length > previousLength + 1 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, MAX_DIGITS);

  if (digits.length === 0) return "";
  const ddd = digits.slice(0, 2);
  if (digits.length <= 2) return `(${ddd}`;

  const number = digits.slice(2);
  // Celular (começa com 9, ou já tem 11 dígitos): 5 + 4. Fixo: 4 + 4.
  const split = digits.length === MAX_DIGITS || number.startsWith("9") ? 5 : 4;
  const tail = number.slice(split);
  return `(${ddd})${number.slice(0, split)}${tail ? `-${tail}` : ""}`;
}
