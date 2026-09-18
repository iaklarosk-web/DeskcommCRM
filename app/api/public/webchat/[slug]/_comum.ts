/**
 * O que as três rotas públicas do chat do site compartilham (F14, ADR-038 §2 T01).
 *
 * PÚBLICAS de verdade: sem cookie de sessão (o proxy as libera em
 * `lib/auth/public-paths.ts`), sem `requireRole` — a autoridade é o TOKEN do
 * visitante (32 bytes aleatórios, só o hash no banco) somado ao slug da URL:
 * os dois têm de contar a mesma história (`sessaoPorToken`). O tenant é
 * resolvido AQUI, pelo slug, nunca pelo payload (§5.1).
 *
 * O IP vem do proxy (`x-forwarded-for`, primeiro salto) e é hasheado antes de
 * qualquer escrita; sem cabeçalho, `0.0.0.0` — o freio por IP continua
 * valendo (tudo cai no mesmo balde) em vez de sumir.
 */
import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { registrarRequisicaoDe } from "@/src/obs/log";
import { sessaoPorToken, type SessaoDoVisitante } from "@/src/webchat";

export const CABECALHO_DO_TOKEN = "x-webchat-token";

export function ipDoVisitante(req: NextRequest): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  const primeiro = encaminhado?.split(",")[0]?.trim();
  return primeiro && primeiro.length > 0 ? primeiro : (req.headers.get("x-real-ip") ?? "0.0.0.0");
}

export function slugValido(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug);
}

/** Sessão do token da requisição, ou a resposta de recusa já pronta (404: não se distingue "não existe" de "não é sua"). */
export async function sessaoDaRequisicao(
  req: NextRequest,
  slug: string,
  requestId: string,
): Promise<{ sessao: SessaoDoVisitante } | { resposta: Response }> {
  const token = req.headers.get(CABECALHO_DO_TOKEN) ?? "";
  if (!slugValido(slug) || token.length === 0) {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status: 404 });
    return { resposta: fail("not_found", "sessão desconhecida", 404, { requestId }) };
  }
  const sessao = await sessaoPorToken(slug, token);
  if (sessao === null) {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status: 404 });
    return { resposta: fail("not_found", "sessão desconhecida", 404, { requestId }) };
  }
  return { sessao };
}

export const STATUS_POR_MOTIVO: Record<string, number> = {
  unknown_organization: 404,
  webchat_disabled: 404,
  ip_sessions: 429,
  ip_messages: 429,
  org_messages: 429,
  not_identified: 409,
  already_identified: 409,
  invalid_name: 422,
  invalid_contact: 422,
  empty_body: 422,
  body_too_long: 422,
};
