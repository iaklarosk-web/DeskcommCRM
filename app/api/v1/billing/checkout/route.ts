/**
 * `POST /api/v1/billing/checkout` `{plan_code}` (F12-T03; F19-T02) — contratação:
 * a assinatura passa a esperar pagamento no plano pedido e o GATEWAY
 * CONFIGURADO devolve o checkout — `mock` (página fictícia da F12) ou `stripe`
 * (sessão de Checkout com `client_reference_id` = organização, trial de D57 c
 * e cartão obrigatório; ADR-042 §2). O navegador que volta do checkout NÃO
 * ativa nada (D38): quem ativa é o webhook. Plano sem `price_…` provisionado
 * em `STRIPE_PRICE_IDS` responde 503 (fail closed) — nunca cai no mock.
 */
import { z } from "zod";

import { env } from "@/lib/env";

import { getRequestId } from "@/lib/api/request-id";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { iniciarCheckout, PlanoDesconhecido, TransicaoIlegal } from "@/src/billing";
import { criarCheckoutMock } from "@/src/billing/gateway/mock";
import { criarSessaoDeCheckout, GATEWAY_STRIPE, lerListaDePrecos, precoDoPlano, StripeIndisponivel } from "@/src/billing/gateway/stripe";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ plan_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/) });

export async function POST(req: Request): Promise<Response> {
  // Acompanhamento (suporte) é só leitura: quem assina, paga, troca ou cancela
  // é a própria empresa, nunca o dono da plataforma acompanhando.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "billing_checkout", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const auth = { ctx: contextoDeCobranca(authz), user: authz.user };
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Informe plan_code.", 422, { requestId });
  try {
    const { assinatura, fatura } = await iniciarCheckout(auth.ctx, { plan_code: corpo.data.plan_code });
    const checkout = env.BILLING_GATEWAY === GATEWAY_STRIPE ? await checkoutNoStripe(assinatura, auth.user.email) : criarCheckoutMock(fatura.id);
    await audit({
      action: "billing.checkout_started",
      actorUserId: auth.user.id,
      organizationId: auth.ctx.organization_id,
      resourceType: "subscription",
      resourceId: assinatura.id,
      requestId,
      metadata: { plan_code: assinatura.plan_code, status: assinatura.status, invoice_id: fatura.id, gateway: checkout.gateway },
    });
    return ok({ subscription: assinatura, invoice: fatura, checkout }, { requestId });
  } catch (erro) {
    if (erro instanceof PlanoDesconhecido) return fail("validation_failed", "Plano desconhecido.", 422, { requestId });
    if (erro instanceof TransicaoIlegal) return fail("state_conflict", "A assinatura já está ativa; para trocar de plano use a mudança de plano.", 409, { requestId });
    if (erro instanceof StripeIndisponivel) return fail("upstream_unavailable", "O gateway de pagamento não respondeu; tente de novo.", 503, { requestId });
    return fail("internal_error", "Não foi possível iniciar a contratação.", 500, { requestId });
  }
}

/**
 * A sessão de Checkout do Stripe para o plano da assinatura. `success_url`
 * volta à tela de cobrança, que NÃO ativa nada (D38) — mostra "aguardando a
 * confirmação" até o webhook chegar.
 */
async function checkoutNoStripe(
  assinatura: { readonly id: string; readonly organization_id: string; readonly plan_code: string; readonly customer_ref: string | null },
  email: string,
): Promise<{ gateway: typeof GATEWAY_STRIPE; checkout_ref: string; url: string }> {
  const preco = precoDoPlano(lerListaDePrecos(env.STRIPE_PRICE_IDS), assinatura.plan_code);
  if (preco === null) throw new StripeIndisponivel(503, `plano ${assinatura.plan_code} sem price em STRIPE_PRICE_IDS`);
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const sessao = await criarSessaoDeCheckout(
    { base: env.STRIPE_API_BASE, chave: env.STRIPE_SECRET_KEY },
    {
      organization_id: assinatura.organization_id,
      price_id: preco,
      trial_days: env.BILLING_TRIAL_DAYS,
      success_url: `${base}/app/billing?checkout=ok`,
      cancel_url: `${base}/app/billing?checkout=cancelado`,
      customer_ref: assinatura.customer_ref,
      customer_email: email,
    },
  );
  return { gateway: GATEWAY_STRIPE, checkout_ref: sessao.id, url: sessao.url };
}
