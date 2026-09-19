/**
 * O COCKPIT (F19-T04, ADR-042 §5; DF-33): o que `GET /api/admin/summary`
 * responde ao painel da KN — itens `{ok, valor, detalhe}`, um por indicador,
 * lidos das tabelas `service_only` pelo pool de serviço. Sem sessão: a
 * autoridade é o bearer `ADMIN_SUMMARY_TOKEN`, conferido pela rota.
 *
 * `ok` é o julgamento do item, não do sistema: gateway `mock` em produção é
 * `ok=false` de propósito (D57 f — a fase fecha assim, e o cockpit tem de
 * dizer). Nenhum item inventa número: sem linha = 0 com denominador.
 */
import type { ServicePool } from "@/src/tenant-context/db";

export interface ItemDoCockpit {
  readonly nome: string;
  readonly ok: boolean;
  readonly valor: string | number;
  readonly detalhe: string;
}

export interface EntradaDoCockpit {
  readonly gateway: "mock" | "stripe";
  readonly modo: "test" | "live";
  readonly agora?: Date;
}

export async function montarCockpit(pool: ServicePool, entrada: EntradaDoCockpit): Promise<ItemDoCockpit[]> {
  const agora = entrada.agora ?? new Date();
  const [porEstado, ultimoEvento, recusados24h, orgsSemAssinatura, trialsAtivos] = await Promise.all([
    pool.query<{ status: string; n: string }>(`select status, count(*)::text as n from public.subscriptions group by status order by status`),
    pool.query<{ received_at: Date | null; gateway: string | null }>(`select received_at, gateway from public.billing_events order by received_at desc limit 1`),
    pool.query<{ n: string }>(
      `select count(*)::text as n from public.billing_events where received_at >= $1 and applied = false and ignored_reason is not null`,
      [new Date(agora.getTime() - 24 * 3_600_000)],
    ),
    pool.query<{ n: string }>(`select count(*)::text as n from public.organizations o where not exists (select 1 from public.subscriptions s where s.organization_id = o.id)`),
    pool.query<{ n: string }>(`select count(*)::text as n from public.subscriptions where trial_ends_at is not null and trial_ends_at > $1`, [agora]),
  ]);
  const estados = Object.fromEntries(porEstado.rows.map((r) => [r.status, Number(r.n)]));
  const total = Object.values(estados).reduce((a, b) => a + b, 0);
  const ultimo = ultimoEvento.rows[0] ?? null;
  return [
    {
      nome: "gateway",
      ok: entrada.gateway === "stripe",
      valor: `${entrada.gateway}/${entrada.modo}`,
      detalhe: entrada.gateway === "stripe" ? `Stripe em modo ${entrada.modo}` : "gateway mock: nenhuma cobrança real (D57 f)",
    },
    { nome: "assinaturas", ok: total > 0, valor: total, detalhe: Object.entries(estados).map(([k, v]) => `${k}=${v}`).join(" ") || "nenhuma" },
    { nome: "past_due", ok: (estados.past_due ?? 0) === 0, valor: estados.past_due ?? 0, detalhe: "assinaturas em carência (D44)" },
    { nome: "blocked", ok: (estados.blocked ?? 0) === 0, valor: estados.blocked ?? 0, detalhe: "assinaturas bloqueadas por atraso ou suspensas" },
    { nome: "trials", ok: true, valor: Number(trialsAtivos.rows[0]?.n ?? 0), detalhe: "períodos de teste em curso (D57 c)" },
    {
      nome: "ultimo_webhook",
      ok: ultimo !== null,
      valor: ultimo?.received_at ? ultimo.received_at.toISOString() : "nunca",
      detalhe: ultimo ? `gateway ${ultimo.gateway}` : "nenhum evento recebido",
    },
    { nome: "webhooks_recusados_24h", ok: Number(recusados24h.rows[0]?.n ?? 0) === 0, valor: Number(recusados24h.rows[0]?.n ?? 0), detalhe: "duplicados/fora de ordem/sem assinatura nas últimas 24 h" },
    { nome: "orgs_sem_assinatura", ok: Number(orgsSemAssinatura.rows[0]?.n ?? 0) === 0, valor: Number(orgsSemAssinatura.rows[0]?.n ?? 0), detalhe: "organizações sem linha em subscriptions" },
  ];
}
