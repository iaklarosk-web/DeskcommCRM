/**
 * `POST /api/v1/admin/billing/[org]` `{action, days?, plan_code?}` (F19-T04,
 * ADR-042 §5) — as ações do padrão KN do /admin sobre a assinatura de UMA
 * empresa: `suspend`, `resume`, `extend_trial` (1..90 dias) e `provision`
 * (assinatura `operator` ativa no plano). "Abrir no Stripe" é link, não rota.
 * Só `platform_admin` com escopo `full`; acompanhamento (suporte) é
 * só-leitura. Primeiro o provedor, depois o banco (`src/billing/admin.ts`);
 * cada ação audita `billing.admin.<ação>`.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PlanoDesconhecido, TransicaoIlegal } from "@/src/billing";
import { DiasForaDaFaixa, estenderTrial, provisionarNaMao, reativar, suspender } from "@/src/billing/admin";
import { StripeIndisponivel } from "@/src/billing/gateway/stripe";

export const dynamic = "force-dynamic";

const corpoSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("extend_trial"), days: z.number().int().min(1).max(90) }),
  z.object({ action: z.literal("provision"), plan_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/) }),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ org: string }> }): Promise<Response> {
  const { org } = await params;
  const supportDenied = await requireSupportWrite(org);
  if (supportDenied) return supportDenied;
  const requestId = getRequestId(req);
  // F20-T03: a guarda distingue NEGAÇÃO (403) de INDISPONIBILIDADE (503).
  // O `catch` genérico que existia aqui respondia "sem permissão" quando o
  // banco estava fora — foi o que fez o dono achar que tinha perdido o
  // acesso no incidente de 21–22/09 (VARREDURA §B25/§B29).
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  const adminCtx = guarda;
  if (adminCtx.platformAdmin.scope !== "full") return fail("forbidden", "Seu acesso de suporte não permite mexer na assinatura.", 403, { requestId });
  if (!UUID.test(org)) return fail("validation_failed", "Organização inválida.", 422, { requestId });
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Ação desconhecida ou parâmetros fora da faixa (days 1..90, plan_code).", 422, { requestId });
  const entrada = corpo.data;
  try {
    const assinatura =
      entrada.action === "suspend"
        ? await suspender(org)
        : entrada.action === "resume"
          ? await reativar(org)
          : entrada.action === "extend_trial"
            ? await estenderTrial(org, entrada.days)
            : await provisionarNaMao(org, entrada.plan_code);
    const acao = ({ suspend: "suspended", resume: "resumed", extend_trial: "trial_extended", provision: "provisioned" } as const)[entrada.action];
    await audit({
      action: `billing.admin.${acao}`,
      actorUserId: adminCtx.user.id,
      organizationId: org,
      resourceType: "subscription",
      resourceId: assinatura.id,
      requestId,
      metadata: { action: entrada.action, status: assinatura.status, plan_code: assinatura.plan_code, gateway: assinatura.gateway, ...(entrada.action === "extend_trial" ? { days: entrada.days, trial_ends_at: assinatura.trial_ends_at } : {}) },
    });
    return ok({ subscription: assinatura }, { requestId });
  } catch (erro) {
    if (erro instanceof DiasForaDaFaixa) return fail("validation_failed", "Dias de trial fora de 1..90.", 422, { requestId });
    if (erro instanceof PlanoDesconhecido) return fail("validation_failed", "Plano desconhecido.", 422, { requestId });
    if (erro instanceof TransicaoIlegal) return fail("state_conflict", "A assinatura não aceita esta ação no estado atual.", 409, { requestId });
    if (erro instanceof StripeIndisponivel) return fail("upstream_unavailable", "O Stripe recusou ou não respondeu; nada foi alterado.", 503, { requestId });
    return fail("internal_error", "Não foi possível executar a ação.", 500, { requestId });
  }
}
