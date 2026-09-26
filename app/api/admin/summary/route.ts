/**
 * `GET /api/admin/summary` (F19-T04, ADR-042 §5; padrão KN, DF-33) — o
 * cockpit da KN lê daqui, com `Authorization: Bearer <ADMIN_SUMMARY_TOKEN>`.
 * Sem sessão e sem cookie (caminho público no proxy; a autoridade é o
 * token, comparado em tempo constante — `lib/admin/cockpit.ts`). Token vazio
 * na instalação = 503, nunca 200 sem token (G-27); token errado = 401. Itens
 * `{nome, ok, valor, detalhe}` de `src/billing/summary.ts`.
 */
import { autorizarCockpit } from "@/lib/admin/cockpit";
import { getRequestId } from "@/lib/api/request-id";
import { ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { montarCockpit } from "@/src/billing/summary";
import { getServicePool } from "@/src/tenant-context/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const guarda = autorizarCockpit(req, { requestId, path: "/api/admin/summary" });
  if (!guarda.ok) return guarda.response;
  const itens = await montarCockpit(await getServicePool(), { gateway: env.BILLING_GATEWAY, modo: env.STRIPE_MODE });
  guarda.registrar(200);
  return ok({ generated_at: new Date().toISOString(), items: itens }, { requestId });
}
