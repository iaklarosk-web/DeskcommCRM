/**
 * `POST /api/v1/billing/mock-checkout` `{checkout_ref, outcome}` (F12-T03) —
 * o "pagar"/"falhar" da página de checkout MOCK. Pelo SERVIDOR, monta o evento
 * que o gateway entregaria, assina com o segredo do webhook e o entrega ao
 * MESMO receptor do webhook. O navegador nunca ativa nada por si: se o
 * receptor recusar (segredo ausente, assinatura, contrato), a resposta diz.
 * Só o `tenant_admin` da organização dona da fatura chega aqui (requireRole).
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { emitirEventoMock, listarFaturasEm, receberEventoMock } from "@/src/billing";
import { withTenant } from "@/src/tenant-context";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  checkout_ref: z.string().uuid(),
  outcome: z.enum(["paid", "failed"]),
});

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const auth = await contextoDeCobranca(requestId, "billing_mock_checkout");
  if (!auth.ok) return auth.response;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Informe checkout_ref (uuid) e outcome (paid|failed).", 422, { requestId });

  // A fatura tem de ser DESTA organização: referência de outro tenant não paga nada.
  const fatura = await withTenant(auth.ctx, async (db) =>
    (await listarFaturasEm(db, auth.ctx)).find((f) => f.id === corpo.data.checkout_ref) ?? null,
  );
  if (fatura === null) return fail("not_found", "Checkout não encontrado nesta organização.", 404, { requestId });

  const { env } = await import("@/lib/env");
  const evento = emitirEventoMock(
    {
      organization_id: auth.ctx.organization_id,
      event_ref: `mock-${corpo.data.outcome}-${randomUUID()}`,
      event_type: corpo.data.outcome === "paid" ? "payment_confirmed" : "payment_failed",
      occurred_at: new Date().toISOString(),
      amount_cents: fatura.amount_cents,
      checkout_ref: fatura.id,
    },
    env.BILLING_MOCK_WEBHOOK_SECRET,
  );
  const resposta = await receberEventoMock(evento.body, evento.signature);
  if (resposta.status !== 200) {
    return fail(resposta.code, "O gateway mock não aceitou o evento; veja BILLING_MOCK_WEBHOOK_SECRET.", resposta.status, { requestId });
  }
  return ok(
    resposta.desfecho.applied
      ? { applied: true, status: resposta.desfecho.assinatura.status }
      : { applied: false, ignored_reason: resposta.desfecho.ignored_reason },
    { requestId },
  );
}
