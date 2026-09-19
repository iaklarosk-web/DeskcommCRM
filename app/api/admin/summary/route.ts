/**
 * `GET /api/admin/summary` (F19-T04, ADR-042 §5; padrão KN, DF-33) — o
 * cockpit da KN lê daqui, com `Authorization: Bearer <ADMIN_SUMMARY_TOKEN>`.
 * Sem sessão e sem cookie (caminho público no proxy; a autoridade é o
 * token, comparado em tempo constante). Token vazio na instalação = 503,
 * nunca 200 sem token (G-27); token errado = 401. Itens `{nome, ok, valor,
 * detalhe}` de `src/billing/summary.ts`.
 */
import { timingSafeEqual } from "node:crypto";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { montarCockpit } from "@/src/billing/summary";
import { registrarRequisicao } from "@/src/obs/log";
import { getServicePool } from "@/src/tenant-context/db";

export const dynamic = "force-dynamic";

function tokenConfere(recebido: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(env.ADMIN_SUMMARY_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const registrar = (status: number) =>
    registrarRequisicao({ request_id: requestId, organization_id: null, scope: "platform_admin" as const, outcome: status === 200 ? "accepted" : "rejected", path: "/api/admin/summary", method: "GET", status });
  if (env.ADMIN_SUMMARY_TOKEN.length === 0) {
    registrar(503);
    return fail("upstream_unavailable", "Cockpit não configurado nesta instalação (ADMIN_SUMMARY_TOKEN).", 503, { requestId });
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (bearer.length === 0 || !tokenConfere(bearer)) {
    registrar(401);
    return fail("unauthorized", "Credencial inválida.", 401, { requestId });
  }
  const itens = await montarCockpit(await getServicePool(), { gateway: env.BILLING_GATEWAY, modo: env.STRIPE_MODE });
  registrar(200);
  return ok({ generated_at: new Date().toISOString(), items: itens }, { requestId });
}
