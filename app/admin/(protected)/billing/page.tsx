/**
 * A tela de COBRANÇA do dono da plataforma (F12-T07, ADR-030 §2/§3; D14,
 * D39): assinaturas por empresa, o catálogo de planos com o rótulo
 * "placeholder" onde é placeholder, os eventos recebidos do gateway e a
 * CONCILIAÇÃO — faturas pagas × eventos aplicados, com as divergências
 * listadas uma a uma. Servida pelo servidor, lida das tabelas `service_only`
 * pelo pool de serviço; não há cliente aqui, e não há número que a tela some.
 *
 * O que ela NÃO faz: editar preço, nome ou limite de plano — isso é decisão
 * do proprietário (D14) e entra por migration/seed, com `source = 'owner'`.
 */
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMAS, type Idioma } from "@/lib/i18n/idiomas";
import { conciliar, listarPlanos } from "@/src/billing";
import { linkNoStripe } from "@/src/billing/admin";
import { getServicePool } from "@/src/tenant-context/db";

import { AcoesDaAssinatura } from "./_acoes";
import { rotuloDoGateway } from "@/src/billing/rotulo-do-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobrança — Admin Plataforma" };

interface LinhaDeAssinatura {
  organization_id: string;
  slug: string;
  display_name: string;
  plan_code: string;
  status: string;
  origin: string;
  current_period_end: Date | null;
  grace_until: Date | null;
  invoices_paid: string;
  events_received: string;
  gateway: string | null;
  gateway_ref: string | null;
  trial_ends_at: Date | null;
}

function data(v: Date | string | null): string {
  if (v === null) return "—";
  return (v instanceof Date ? v.toISOString() : v).slice(0, 10);
}

export default async function AdminBillingPage() {
  const adminCtx = await requirePlatformAdmin();
  const { user } = adminCtx;
  // Acompanhamento (suporte) é só leitura: as ações só para escopo `full`.
  const somenteLeitura = adminCtx.platformAdmin.scope !== "full";
  const bruto = (user.user_metadata?.locale as string | undefined) ?? "pt-BR";
  const idioma: Idioma = (IDIOMAS as readonly string[]).includes(bruto) ? (bruto as Idioma) : "pt-BR";
  const t = (texto: string) => traduzir(texto, idioma);
  const pool = await getServicePool();

  // A tela repete a configuração do gateway; ela não afirma "não cobra" por
  // conta própria (ver src/billing/rotulo-do-gateway.ts).
  const gateway = rotuloDoGateway({ gateway: env.BILLING_GATEWAY, modo: env.STRIPE_MODE });

  const [planos, conciliacao, assinaturas, semAssinatura, eventos] = await Promise.all([
    listarPlanos({ pool }),
    conciliar(null, { pool }),
    pool.query<LinhaDeAssinatura>(`
      select s.organization_id, o.slug::text as slug, o.display_name, s.plan_code, s.status, s.origin,
             s.current_period_end, s.grace_until, s.gateway, s.gateway_ref, s.trial_ends_at,
             (select count(*) from public.invoices i where i.organization_id = s.organization_id and i.status = 'paid')::text as invoices_paid,
             (select count(*) from public.billing_events e where e.organization_id = s.organization_id)::text as events_received
        from public.subscriptions s join public.organizations o on o.id = s.organization_id
       order by o.created_at desc limit 200`),
    pool.query<{ n: string }>(`
      select count(*)::text as n from public.organizations o
       where not exists (select 1 from public.subscriptions s where s.organization_id = o.id)`),
    pool.query<{ organization_id: string; slug: string; event_ref: string; event_type: string; occurred_at: Date; applied: boolean; ignored_reason: string | null }>(`
      select e.organization_id, o.slug::text as slug, e.event_ref, e.event_type, e.occurred_at, e.applied, e.ignored_reason
        from public.billing_events e join public.organizations o on o.id = e.organization_id
       order by e.received_at desc limit 50`),
  ]);
  const orgsSemAssinatura = Number(semAssinatura.rows[0]?.n ?? 0);

  return (
    <div className="space-y-6" data-testid="admin-billing">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Cobrança da plataforma")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Assinaturas por empresa, planos, eventos do gateway e conciliação.")}{" "}
          <span data-testid="admin-billing-modo-do-gateway" className={gateway.cobra_de_verdade ? "font-medium text-warning" : undefined}>
            {t(gateway.texto)}
          </span>
        </p>
      </header>

      <section className="rounded-lg border p-4" aria-labelledby="admin-billing-conciliacao">
        <h2 id="admin-billing-conciliacao" className="text-sm font-medium">{t("Conciliação")}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-testid="admin-billing-conciliacao" data-mismatch={conciliacao.mismatch} data-matched={conciliacao.matched}>
          <dt className="text-muted-foreground">{t("Faturas pagas")}</dt>
          <dd data-testid="admin-billing-invoices-paid">{conciliacao.invoices_paid}</dd>
          <dt className="text-muted-foreground">{t("Eventos aplicados")}</dt>
          <dd data-testid="admin-billing-events-applied">{conciliacao.events_applied}</dd>
          <dt className="text-muted-foreground">{t("Conferidas")}</dt>
          <dd data-testid="admin-billing-matched">{conciliacao.matched}</dd>
          <dt className="text-muted-foreground">{t("Divergências")}</dt>
          <dd data-testid="admin-billing-mismatch">{conciliacao.mismatch}</dd>
          <dt className="text-muted-foreground">{t("Empresas sem assinatura (herdadas)")}</dt>
          <dd data-testid="admin-billing-sem-assinatura">{orgsSemAssinatura}</dd>
        </dl>
        {conciliacao.divergences.length > 0 ? (
          <ul className="mt-2 text-sm text-destructive" data-testid="admin-billing-divergencias">
            {conciliacao.divergences.map((d) => (
              <li key={`${d.organization_id}-${d.kind}-${d.ref}`}>{d.organization_id} · {d.kind} · {d.ref}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="admin-billing-planos">
        <h2 id="admin-billing-planos" className="text-sm font-medium">{t("Planos")}</h2>
        {planos.some((p) => p.source === "placeholder") ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="admin-billing-aviso-placeholder">
            {t("Nome, preço e limites marcados como placeholder ainda não foram decididos pelo proprietário da plataforma.")}
          </p>
        ) : null}
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">{t("Código")}</th>
              <th className="py-1">{t("Nome")}</th>
              <th className="py-1">{t("Preço")}</th>
              <th className="py-1">{t("Ciclo")}</th>
              <th className="py-1">{t("Limites")}</th>
              <th className="py-1">{t("Origem")}</th>
            </tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.code} data-testid="admin-billing-plano" data-code={p.code} data-source={p.source}>
                <td className="py-1 font-mono">{p.code}</td>
                <td className="py-1">{p.name}</td>
                <td className="py-1">{p.currency} {(p.price_cents / 100).toFixed(2)}</td>
                <td className="py-1">{p.period_days} {t("dias")}</td>
                <td className="py-1 text-xs">{Object.entries(p.limits).map(([c, l]) => `${c}=${l}`).join(" · ") || "∞"}</td>
                <td className="py-1">{p.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="admin-billing-assinaturas">
        <h2 id="admin-billing-assinaturas" className="text-sm font-medium">{t("Assinaturas por empresa")}</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">{t("Empresa")}</th>
              <th className="py-1">{t("Plano")}</th>
              <th className="py-1">{t("Estado")}</th>
              <th className="py-1">{t("Origem")}</th>
              <th className="py-1">{t("Fim do período")}</th>
              <th className="py-1">{t("Prazo para regularizar")}</th>
              <th className="py-1">{t("Faturas pagas")}</th>
              <th className="py-1">{t("Eventos")}</th>
              <th className="py-1">{t("Gateway")}</th>
              <th className="py-1">{t("Ações")}</th>
            </tr>
          </thead>
          <tbody>
            {assinaturas.rows.map((s) => (
              <tr key={s.organization_id} data-testid="admin-billing-assinatura" data-org={s.organization_id} data-status={s.status}>
                <td className="py-1">{s.display_name} <span className="font-mono text-xs text-muted-foreground">{s.slug}</span></td>
                <td className="py-1">{s.plan_code}</td>
                <td className="py-1">{s.status}</td>
                <td className="py-1" data-testid="admin-billing-origem" data-origin={s.origin}>{s.origin === "operator" ? traduzir("interna (provisionada na mão)", idioma) : s.origin}</td>
                <td className="py-1">{data(s.current_period_end)}</td>
                <td className="py-1">{data(s.grace_until)}</td>
                <td className="py-1 tabular-nums">{s.invoices_paid}</td>
                <td className="py-1 tabular-nums">{s.events_received}</td>
                <td className="py-1" data-testid="admin-billing-gateway" data-gateway={s.gateway ?? ""}>{s.gateway ?? "—"}{s.trial_ends_at ? ` · trial ${data(s.trial_ends_at)}` : ""}</td>
                <td className="py-1">
                  <AcoesDaAssinatura
                    organizationId={s.organization_id}
                    status={s.status}
                    gateway={s.gateway}
                    planos={planos.map((p) => p.code)}
                    linkStripe={linkNoStripe({ gateway: s.gateway, gateway_ref: s.gateway_ref }, env.STRIPE_MODE)}
                    somenteLeitura={somenteLeitura}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="admin-billing-eventos">
        <h2 id="admin-billing-eventos" className="text-sm font-medium">{t("Últimos eventos do gateway")}</h2>
        {eventos.rows.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("Nenhum evento recebido ainda.")}</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">{t("Empresa")}</th>
                <th className="py-1">{t("Referência")}</th>
                <th className="py-1">{t("Tipo")}</th>
                <th className="py-1">{t("Ocorrido em")}</th>
                <th className="py-1">{t("Aplicado")}</th>
              </tr>
            </thead>
            <tbody>
              {eventos.rows.map((e) => (
                <tr key={`${e.organization_id}-${e.event_ref}`} data-testid="admin-billing-evento" data-applied={e.applied}>
                  <td className="py-1 font-mono text-xs">{e.slug}</td>
                  <td className="py-1 font-mono text-xs">{e.event_ref}</td>
                  <td className="py-1">{e.event_type}</td>
                  <td className="py-1">{data(e.occurred_at)}</td>
                  <td className="py-1">{e.applied ? t("sim") : `${t("não")} (${e.ignored_reason ?? "—"})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
