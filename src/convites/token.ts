/**
 * Token e link do convite de equipe (F20-T02, ADR-045 §2; D59).
 *
 * O token é a CREDENCIAL do convite numa rota pública: 16 chars base64url =
 * 96 bits, sorteados por CSPRNG. Com o teto de 60 tentativas por IP/hora do
 * aceite (`AUTH_LIMITS.invite_accept`), varrer esse espaço é inviável.
 *
 * O tamanho não é estética: o link antigo tinha 559 caracteres porque levava o
 * convite inteiro na URL, e o WhatsApp linkificava só o começo — a pessoa
 * convidada não conseguia clicar (VARREDURA §B27). `/i/<token>` dá ~47 chars no
 * domínio de produção.
 */
import { randomBytes } from "node:crypto";

export const TAMANHO_DO_TOKEN = 16;

export function sortearTokenDeConvite(): string {
  // 12 bytes = 16 chars em base64url, sem padding e sem caracteres a aparar.
  return randomBytes(12).toString("base64url");
}

export function linkDoConvite(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/i/${token}`;
}

/** O índice único do "um vivo por pessoa" casa por `lower(email)` (D61 b). */
export function normalizarEmailDeConvite(email: string): string {
  const normalizado = email.trim().toLowerCase();
  if (normalizado.length === 0) throw new Error("e-mail do convite vazio");
  return normalizado;
}
