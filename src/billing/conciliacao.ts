/**
 * CONCILIAÇÃO (F12-T07, §7.9 F12): faturas pagas × eventos `payment_confirmed`
 * aplicados. Uma fatura paga sem evento aplicado com a mesma referência, ou um
 * evento aplicado sem fatura paga, é DIVERGÊNCIA — contada com denominador e
 * listada, nunca "conciliado" por prosa.
 *
 * Lê pelo pool de serviço (as duas tabelas são `service_only`); por organização
 * quando `organization_id` vem, senão a plataforma inteira (tela do dono).
 */
import type { ServicePool } from "@/src/tenant-context/db";
import { getServicePool } from "@/src/tenant-context/db";

export interface Divergencia {
  readonly organization_id: string;
  readonly kind: "invoice_without_event" | "event_without_invoice";
  readonly ref: string;
}

export interface Conciliacao {
  readonly invoices_paid: number;
  readonly events_applied: number;
  readonly matched: number;
  readonly mismatch: number;
  readonly divergences: readonly Divergencia[];
}

interface Deps {
  pool?: ServicePool;
}

export async function conciliar(organizationId: string | null, deps: Deps = {}): Promise<Conciliacao> {
  const pool = deps.pool ?? (await getServicePool());
  const filtro = organizationId === null ? "" : "where organization_id = $1";
  const params = organizationId === null ? [] : [organizationId];
  const faturas = await pool.query<{ organization_id: string; gateway_ref: string | null }>(
    `select organization_id, gateway_ref from public.invoices ${filtro ? `${filtro} and` : "where"} status = 'paid'`,
    params,
  );
  const eventos = await pool.query<{ organization_id: string; event_ref: string }>(
    `select organization_id, event_ref from public.billing_events
      ${filtro ? `${filtro} and` : "where"} applied and event_type = 'payment_confirmed'`,
    params,
  );
  const refsDeEventos = new Set(eventos.rows.map((e) => `${e.organization_id}|${e.event_ref}`));
  const refsDeFaturas = new Set(
    faturas.rows.filter((f) => f.gateway_ref !== null).map((f) => `${f.organization_id}|${f.gateway_ref}`),
  );
  const divergences: Divergencia[] = [];
  let matched = 0;
  for (const f of faturas.rows) {
    const chave = f.gateway_ref === null ? null : `${f.organization_id}|${f.gateway_ref}`;
    if (chave !== null && refsDeEventos.has(chave)) matched += 1;
    else divergences.push({ organization_id: f.organization_id, kind: "invoice_without_event", ref: f.gateway_ref ?? "(sem referência)" });
  }
  for (const e of eventos.rows) {
    if (!refsDeFaturas.has(`${e.organization_id}|${e.event_ref}`)) {
      divergences.push({ organization_id: e.organization_id, kind: "event_without_invoice", ref: e.event_ref });
    }
  }
  return {
    invoices_paid: faturas.rows.length,
    events_applied: eventos.rows.length,
    matched,
    mismatch: divergences.length,
    divergences,
  };
}
