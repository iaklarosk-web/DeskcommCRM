/**
 * A guarda do COCKPIT da KN (F19-T04, ADR-042 §5; padrão DF-33): rotas
 * `/api/admin/*` que o dono lê de fora do produto, sem sessão e sem cookie,
 * com `Authorization: Bearer <ADMIN_SUMMARY_TOKEN>`.
 *
 * Uma guarda para as duas rotas (`/summary` e, desde a F24, `/handoffs`) —
 * a mesma disciplina, escrita uma vez:
 *  - token vazio na instalação = 503, nunca 200 sem token (G-27);
 *  - token ausente ou errado = 401, comparado em tempo constante;
 *  - cada tentativa vira uma linha de log com `scope: platform_admin`.
 */
import { timingSafeEqual } from "node:crypto";

import { fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { registrarRequisicao } from "@/src/obs/log";

export interface EntradaDaGuarda {
  readonly requestId: string;
  readonly path: string;
}

export type ResultadoDaGuarda = { readonly ok: true; readonly registrar: (status: number) => void } | { readonly ok: false; readonly response: Response };

function tokenConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function autorizarCockpit(req: Request, entrada: EntradaDaGuarda): ResultadoDaGuarda {
  const registrar = (status: number) =>
    registrarRequisicao({
      request_id: entrada.requestId,
      organization_id: null,
      scope: "platform_admin" as const,
      outcome: status === 200 ? "accepted" : "rejected",
      path: entrada.path,
      method: "GET",
      status,
    });
  const esperado = env.ADMIN_SUMMARY_TOKEN;
  if (esperado.length === 0) {
    registrar(503);
    return { ok: false, response: fail("upstream_unavailable", "Cockpit não configurado nesta instalação (ADMIN_SUMMARY_TOKEN).", 503, { requestId: entrada.requestId }) };
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (bearer.length === 0 || !tokenConfere(bearer, esperado)) {
    registrar(401);
    return { ok: false, response: fail("unauthorized", "Credencial inválida.", 401, { requestId: entrada.requestId }) };
  }
  return { ok: true, registrar };
}
