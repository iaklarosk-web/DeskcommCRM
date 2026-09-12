/**
 * F06-T02 — `Idempotency-Key` no caminho síncrono herdado (VARREDURA §B10).
 *
 * O `apiClient` manda `Idempotency-Key` em todo método mutante
 * (`lib/api/client.ts:117`) e REPETE o POST quando não há resposta em 10 s
 * (`DEFAULT_TIMEOUT_MS`). O handler herdado de `/api/v1/messages` não lia o
 * cabeçalho, então sob latência a repetição gravava uma SEGUNDA mensagem — e
 * ela saía duas vezes para o cliente. Medido no trace do gate f05-gate-06.
 *
 * O conserto reusa o que o handler já tinha: `ctx.internalMessageId` faz o
 * INSERT levar um `id` fixo, e a repetição bate no unique da chave primária
 * (`23505`) em vez de nascer de novo. Este módulo só transforma a chave do
 * cliente num id DETERMINÍSTICO por (organização, ator, chave): a mesma chave
 * de outro tenant ou de outro usuário é outro id, então ninguém devolve a
 * mensagem de ninguém.
 *
 * Sem cabeçalho, nada muda: o id continua vindo do banco.
 */
import { createHash } from "node:crypto";

const TAMANHO_MAXIMO = 200;

/** A chave como o cliente a mandou, ou `null` se ausente ou fora do contrato. */
export function chaveDeIdempotencia(headers: Headers): string | null {
  const bruta = headers.get("idempotency-key")?.trim() ?? "";
  if (bruta.length === 0 || bruta.length > TAMANHO_MAXIMO) return null;
  return bruta;
}

/**
 * UUID determinístico (layout v5: versão 5, variante RFC 4122) a partir das
 * partes, separadas por `\0` para que `("a","bc")` e `("ab","c")` não colidam.
 */
export function uuidDeterministico(...partes: string[]): string {
  const hash = createHash("sha256").update(partes.join("\0")).digest("hex").slice(0, 32);
  const versao = `5${hash.slice(13, 16)}`;
  const variante = `${((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`;
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${versao}-${variante}-${hash.slice(20, 32)}`;
}

/** O id fixo da mensagem para esta (organização, ator, chave). */
export function idDaMensagemIdempotente(organizationId: string, actorId: string, chave: string): string {
  return uuidDeterministico("messages", organizationId, actorId, chave);
}
