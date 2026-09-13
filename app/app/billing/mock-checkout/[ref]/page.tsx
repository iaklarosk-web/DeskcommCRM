/**
 * A "página de pagamento" do gateway MOCK (F12-T03, D11/D51). Não é um
 * checkout: é onde a pessoa que testa escolhe o que o gateway teria respondido.
 * O botão manda o servidor assinar e entregar o evento ao webhook — o
 * navegador não ativa nada (D38). Fora do `verify`, existe para o proprietário
 * percorrer a jornada no staging.
 */
import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { listarFaturasEm } from "@/src/billing";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { BotoesDoCheckoutMock } from "../../_acoes";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MockCheckoutPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!UUID.test(ref)) notFound();
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");
  const ctx: TenantCtx = { organization_id: activeOrg.orgId, user_id: user.id, role: activeOrg.role, source: "session" };
  const fatura = await withTenant(ctx, async (db) => (await listarFaturasEm(db, ctx)).find((f) => f.id === ref) ?? null);
  if (fatura === null) notFound();
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-6" data-testid="mock-checkout" data-invoice={fatura.id}>
      <h1 className="text-xl font-semibold">{t("Pagamento de teste")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("Este é o gateway em modo de teste. Nenhum valor é cobrado; escolha o que o gateway responderia.")}
      </p>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">{t("Plano")}</dt>
        <dd data-testid="mock-checkout-plano">{fatura.plan_code}</dd>
        <dt className="text-muted-foreground">{t("Valor")}</dt>
        <dd data-testid="mock-checkout-valor">{fatura.currency} {(fatura.amount_cents / 100).toFixed(2)}</dd>
        <dt className="text-muted-foreground">{t("Estado")}</dt>
        <dd data-testid="mock-checkout-status">{fatura.status}</dd>
      </dl>
      <BotoesDoCheckoutMock checkoutRef={fatura.id} />
    </div>
  );
}
