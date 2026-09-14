/**
 * A tela de COBRANÇA do `tenant_admin` (F12-T04, ADR-030 §3; D14, D38, D44).
 *
 * O que ela mostra é o que o banco diz — servida pelo servidor, como a tela de
 * uso de IA: assinatura (plano, estado, período, prazo de carência), uso por
 * capability com limite e restante, faturas, e o catálogo de planos com o
 * rótulo "placeholder" onde é placeholder (nome = código, preço 0 — decisão do
 * proprietário, nunca fato desta tela). A prova de F12-T08 compara cada número
 * daqui com `GET /api/v1/billing/subscription` e `/usage`, que leem pelas
 * MESMAS funções.
 *
 * É a única tela de /app alcançável com assinatura `pending_payment` ou
 * `cancelled` (o layout redireciona para cá): a pessoa precisa poder pagar.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  acessoDe,
  lerAssinaturaEm,
  listarFaturasEm,
  listarPlanos,
  mesCivil,
  obterPlano,
  usoPorCapabilityEm,
  type Periodo,
  type Plano,
} from "@/src/billing";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { BotaoDeCheckout, BotaoDeTrocaDePlano, FormularioDeCancelamento } from "./_acoes";

export const dynamic = "force-dynamic";

function data(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function preco(plano: Plano): string {
  return `${plano.currency} ${(plano.price_cents / 100).toFixed(2)}`;
}

export default async function BillingPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const ctx: TenantCtx = { organization_id: activeOrg.orgId, user_id: user.id, role: activeOrg.role, source: "session" };
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const planos = await listarPlanos();
  const dados = await withTenant(ctx, async (db) => {
    const assinatura = await lerAssinaturaEm(db, ctx);
    const faturas = await listarFaturasEm(db, ctx);
    const plano = assinatura === null ? null : await obterPlano(assinatura.plan_code);
    const periodo: Periodo =
      assinatura?.current_period_start && assinatura.current_period_end
        ? { desde: assinatura.current_period_start, ate: assinatura.current_period_end }
        : mesCivil();
    const uso = await usoPorCapabilityEm(db, ctx, periodo, plano?.limits ?? {});
    return { assinatura, faturas, plano, periodo, uso };
  });
  const { assinatura, faturas, plano, periodo, uso } = dados;
  const acesso = acessoDe(
    assinatura === null ? null : { status: assinatura.status, plan_code: assinatura.plan_code, grace_until: assinatura.grace_until },
  );
  const podeContratar = assinatura === null || ["pending_payment", "past_due", "blocked", "cancelled"].includes(assinatura.status);
  const podeTrocar = assinatura?.status === "active";
  const podeCancelar = assinatura !== null && ["active", "past_due", "blocked"].includes(assinatura.status);

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="billing">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Assinatura e cobrança")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Plano, estado da assinatura, uso do período e faturas desta empresa. Gateway em modo de teste: nenhuma cobrança real acontece.")}
        </p>
      </header>

      <section className="rounded-lg border p-4" aria-labelledby="billing-assinatura">
        <h2 id="billing-assinatura" className="text-sm font-medium">{t("Assinatura")}</h2>
        {assinatura === null ? (
          <p className="mt-1 text-sm" data-testid="billing-status" data-status="none">
            {t("Esta empresa ainda não tem assinatura registrada.")}
          </p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">{t("Plano")}</dt>
            <dd data-testid="billing-plano">{assinatura.plan_code}</dd>
            <dt className="text-muted-foreground">{t("Estado")}</dt>
            <dd data-testid="billing-status" data-status={assinatura.status}>{assinatura.status}</dd>
            <dt className="text-muted-foreground">{t("Período")}</dt>
            <dd data-testid="billing-periodo">{data(assinatura.current_period_start)} → {data(assinatura.current_period_end)}</dd>
            <dt className="text-muted-foreground">{t("Acesso")}</dt>
            <dd data-testid="billing-acesso" data-mode={acesso.mode}>{acesso.mode}</dd>
            {assinatura.grace_until ? (
              <>
                <dt className="text-muted-foreground">{t("Prazo para regularizar")}</dt>
                <dd data-testid="billing-carencia">{data(assinatura.grace_until)}</dd>
              </>
            ) : null}
            {assinatura.cancelled_at ? (
              <>
                <dt className="text-muted-foreground">{t("Cancelada em")}</dt>
                <dd data-testid="billing-cancelada-em">{data(assinatura.cancelled_at)}</dd>
              </>
            ) : null}
          </dl>
        )}
        {podeCancelar ? (
          <div className="mt-4">
            <FormularioDeCancelamento />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="billing-planos">
        <h2 id="billing-planos" className="text-sm font-medium">{t("Planos")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Nome, preço e limites marcados como placeholder ainda não foram decididos pelo proprietário da plataforma.")}
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {planos.map((p) => (
            <li key={p.code} className="rounded-md border p-3 text-sm" data-testid={`billing-plano-card-${p.code}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                {p.source === "placeholder" ? (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide" data-testid={`billing-plano-placeholder-${p.code}`}>placeholder</span>
                ) : null}
              </div>
              <p className="mt-1 text-muted-foreground" data-testid={`billing-plano-preco-${p.code}`}>{preco(p)} / {p.period_days} {t("dias")}</p>
              <ul className="mt-2 text-xs text-muted-foreground">
                {Object.entries(p.limits).length === 0 ? (
                  <li>{t("Sem limites declarados")}</li>
                ) : (
                  Object.entries(p.limits).map(([cap, lim]) => (
                    <li key={cap}>{cap}: {lim}</li>
                  ))
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {podeContratar ? <BotaoDeCheckout planCode={p.code} rotulo={assinatura === null || assinatura.status === "cancelled" ? t("Contratar") : t("Pagar agora")} /> : null}
                {podeTrocar && plano?.code !== p.code ? <BotaoDeTrocaDePlano planCode={p.code} /> : null}
                {plano?.code === p.code ? <span className="text-xs text-muted-foreground" data-testid="billing-plano-atual">{t("Plano atual")}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="billing-uso">
        <h2 id="billing-uso" className="text-sm font-medium">{t("Uso do período")}</h2>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="billing-uso-periodo">{data(periodo.desde)} → {data(periodo.ate)}</p>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">{t("Capacidade")}</th>
              <th className="py-1">{t("Usado")}</th>
              <th className="py-1">{t("Limite")}</th>
              <th className="py-1">{t("Restante")}</th>
            </tr>
          </thead>
          <tbody>
            {uso.map((u) => (
              <tr key={u.capability} data-testid="billing-uso-linha" data-capability={u.capability} data-used={u.used} data-limit={u.limit ?? ""} data-remaining={u.remaining ?? ""}>
                <td className="py-1">{u.capability}</td>
                <td className="py-1">{u.used}</td>
                <td className="py-1">{u.limit ?? "∞"}</td>
                <td className="py-1">{u.remaining ?? "∞"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="billing-faturas">
        <h2 id="billing-faturas" className="text-sm font-medium">{t("Faturas")}</h2>
        {faturas.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="billing-sem-faturas">{t("Nenhuma fatura ainda.")}</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">{t("Período")}</th>
                <th className="py-1">{t("Plano")}</th>
                <th className="py-1">{t("Valor")}</th>
                <th className="py-1">{t("Estado")}</th>
                <th className="py-1">{t("Paga em")}</th>
              </tr>
            </thead>
            <tbody>
              {faturas.map((f) => (
                <tr key={f.id} data-testid="billing-fatura" data-status={f.status}>
                  <td className="py-1">{data(f.period_start)} → {data(f.period_end)}</td>
                  <td className="py-1">{f.plan_code}</td>
                  <td className="py-1">{f.currency} {(f.amount_cents / 100).toFixed(2)}</td>
                  <td className="py-1">{f.status}</td>
                  <td className="py-1">{data(f.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
