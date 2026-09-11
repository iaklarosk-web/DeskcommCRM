/**
 * O DISPARO do lembrete recorrente PJ (§5.12, D23; F05-T06/T07).
 *
 * ═══ O que este arquivo faz, na ordem ═══
 *
 *  1. Para cada tenant elegível (`forEachEligibleTenant("orders.recurring_reminder")`,
 *     fonte = `listarTenantsComLembreteLigado`, §5.1), lê a configuração e o
 *     fuso, e só DISPARA se a hora LOCAL bate com `weekday`+`hour` (§5.12
 *     invariante 3: Manaus dispara uma hora depois de São Paulo).
 *  2. Abre UM job por tenant em `job_queue(kind='recurring_reminder')` +
 *     `job_runs` (§5.13, "um job run por tenant"), e fecha com as contagens no
 *     `payload` — nunca "ok".
 *  3. Para cada cliente elegível (`selectEligibleCustomers`: `recurring=true`,
 *     `company_id` não nulo, com telefone, nem anonimizado nem fundido), CLAIMA
 *     o período em `reminder_runs` — o índice único `(org, customer, period)`
 *     é o árbitro (D23; G-57). Conflito com linha já ENVIADA = duplicata
 *     evitada, contada. Conflito com linha ainda não enviada (queda entre o
 *     claim e o envio, na mesma corrida) = retoma o envio.
 *  4. Põe a conversa em `waiting_customer` com a tag `awaiting_quantity` —
 *     criando-a se não existir (`iniciarPorAutomacao`, §5.6 "nenhuma") ou
 *     movendo-a por `automation.outbound` se existir em `resolved`/`waiting_customer`.
 *     Qualquer outro estado é conversa OCUPADA: o lembrete não fala no meio de
 *     um atendimento; a linha fica `skipped_reason=conversation_busy`.
 *  5. ENVIA pelo catálogo — `execute(ctx, {kind:"automation"}, "send_message",
 *     {idempotency_key: "reminder:{org}:{customer}:{period}"})` (§5.12, F05-T07).
 *     Nenhuma chamada ao adapter de canal aqui: o único arquivo que a faz é
 *     `src/actions/outbound.ts`, e a entrega é do worker de saída. (O grep de
 *     §7.6 conta comentário também — por isso o nome do método não aparece.)
 *  6. Grava `sent_message_id`, `sent_at` e `cutoff_at = agora + cutoff_hours`
 *     na linha do período.
 *
 * ═══ O que NÃO acontece aqui ═══
 *
 * Nenhuma escrita em `crm_orders`: o pedido `draft` do período nasce da
 * RESPOSTA do cliente, pela IA, por `create_order`/`update_order_quantity`
 * com confirmação `by_risk` (§5.12, F05-T08). Nenhuma leitura de
 * `tenant_settings` fora do `TenantConfiguration`.
 */
import { execute, type ExecuteDeps } from "@/src/actions";
import {
  IllegalTransition,
  iniciarPorAutomacao,
  marcarTag,
  type TransitionEffect,
} from "@/src/conversation";
import { listOrderCards } from "@/src/crm/reads";
import { incrementCounter } from "@/src/obs/counters";
import { listarTenantsComLembreteLigado } from "@/src/tenant-config";
import type { ServicePool } from "@/src/tenant-context/db";
import { forEachEligibleTenant, withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import { configDoLembrete, fusoDoTenant, type ConfigDoLembrete } from "./config";
import { bateAJanela, chaveDoPeriodo, horaLocal } from "./periodo";

export const CRON_KEY_DO_LEMBRETE = "orders.recurring_reminder";

/** A chave de idempotência de §5.12, letra por letra. */
export function chaveDeIdempotencia(org: string, customer: string, period: string): string {
  return `reminder:${org}:${customer}:${period}`;
}

export interface DepsDoLembrete extends ExecuteDeps {
  pool?: ServicePool;
  /** Relógio injetável — a janela local e o período saem dele. */
  agora?: () => Date;
  /** Fonte da elegibilidade; produção usa a canônica do TenantConfiguration. */
  listEligible?: (cronKey: string) => Promise<string[]>;
}

export type DesfechoDoCliente =
  | "sent"
  | "duplicate"
  | "resumed"
  | "skipped:conversation_busy"
  | "skipped:channel_account_missing"
  | "skipped:contact_without_phone"
  | "skipped:send_denied";

export interface ResultadoDoTenant {
  readonly organization_id: string;
  readonly fired: boolean;
  /** Por que NÃO disparou, quando `fired=false`. Etiqueta, não frase. */
  readonly reason?: "disabled" | "outside_window";
  readonly period_key?: string;
  readonly job_id?: string;
  readonly customers_eligible: number;
  readonly sent: number;
  readonly duplicates_avoided: number;
  readonly skipped: number;
  readonly desfechos: readonly { customer_id: string; desfecho: DesfechoDoCliente }[];
}

export interface ResultadoDosLembretes {
  readonly tenants_eligible: number;
  readonly tenants_fired: number;
  readonly tenants_failed: number;
  readonly sent: number;
  readonly duplicates_avoided: number;
  readonly por_tenant: readonly ResultadoDoTenant[];
  readonly falhas: readonly { organization_id: string; error: string }[];
}

interface ClienteElegivel {
  readonly id: string;
  readonly display_name: string | null;
  readonly phone_number: string | null;
}

interface ContaDeCanal {
  readonly channel_session_id: string;
}

/** `selectEligibleCustomers` de §5.12 ("Mudar X: elegibilidade = 1 função"). */
export async function selectEligibleCustomers(
  db: TenantDb,
  ctx: TenantCtx,
): Promise<readonly ClienteElegivel[]> {
  const r = await db.query<ClienteElegivel>(
    `select id, display_name, phone_number
       from public.contacts
      where organization_id = $1
        and recurring = true
        and company_id is not null
        and is_anonymized = false
        and is_merged_into is null
      order by created_at asc, id asc`,
    [ctx.organization_id],
  );
  return r.rows;
}

async function contaDeCanalAtiva(db: TenantDb, ctx: TenantCtx): Promise<ContaDeCanal | null> {
  const r = await db.query<{ channel_session_id: string | null }>(
    `select channel_session_id from public.channel_accounts
      where organization_id = $1 and status = 'active' and channel_session_id is not null
      order by created_at asc limit 1`,
    [ctx.organization_id],
  );
  const sessao = r.rows[0]?.channel_session_id ?? null;
  return sessao === null ? null : { channel_session_id: sessao };
}

/**
 * O texto do lembrete a partir do template do tenant. `{{customer.name}}` e
 * `{{last_order.summary}}` são os campos do default de §5.2; campo sem valor
 * vira `?` visível — texto perfeito com dado apagado é pior que buraco.
 */
export function corpoDoLembrete(
  template: string,
  campos: { readonly nome: string | null; readonly resumoDoUltimoPedido: string | null; readonly period: string },
): string {
  const valores: Record<string, string | null> = {
    "customer.name": campos.nome,
    "last_order.summary": campos.resumoDoUltimoPedido,
    period: campos.period,
  };
  return template.replace(/\{\{([a-z_.]+)\}\}/g, (_tudo, chave: string) => {
    const v = valores[chave];
    return v === undefined || v === null || v.length === 0 ? "?" : v;
  });
}

async function resumoDoUltimoPedido(
  ctx: TenantCtx,
  customerId: string,
  deps: DepsDoLembrete,
): Promise<string | null> {
  const pedidos = await listOrderCards(ctx, customerId, 1, { pool: deps.pool });
  const ultimo = pedidos[0];
  if (ultimo === undefined) return null;
  const itens = ultimo.items
    .map((i) => `${i.quantity ?? "?"} ${i.sale_unit ?? ""} ${i.product_name ?? ""}`.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0);
  return itens.length > 0 ? itens.join(", ") : null;
}

/** O claim do período: cria a linha ou descobre a que já existe. */
async function claimarPeriodo(
  db: TenantDb,
  ctx: TenantCtx,
  customerId: string,
  period: string,
): Promise<{ id: string; estado: "new" | "sent" | "pending" | "skipped" }> {
  const inserido = await db.query<{ id: string }>(
    `insert into public.reminder_runs (organization_id, customer_id, period_key)
     values ($1::uuid,$2::uuid,$3::text)
     on conflict (organization_id, customer_id, period_key) do nothing
     returning id`,
    [ctx.organization_id, customerId, period],
  );
  const novo = inserido.rows[0]?.id;
  if (novo !== undefined) return { id: novo, estado: "new" };
  const existente = await db.query<{ id: string; sent_message_id: string | null; skipped_reason: string | null }>(
    `select id, sent_message_id, skipped_reason from public.reminder_runs
      where organization_id = $1 and customer_id = $2 and period_key = $3`,
    [ctx.organization_id, customerId, period],
  );
  const linha = existente.rows[0];
  if (linha === undefined) throw new Error("reminder_runs: conflito sem linha correspondente");
  if (linha.sent_message_id !== null) return { id: linha.id, estado: "sent" };
  if (linha.skipped_reason !== null) return { id: linha.id, estado: "skipped" };
  return { id: linha.id, estado: "pending" };
}

async function pular(
  ctx: TenantCtx,
  runId: string,
  motivo: "conversation_busy" | "channel_account_missing" | "contact_without_phone" | "send_denied",
  deps: DepsDoLembrete,
  conversationId: string | null = null,
): Promise<DesfechoDoCliente> {
  await withTenant(
    ctx,
    async (db) => {
      await db.query(
        `update public.reminder_runs set skipped_reason = $3, conversation_id = coalesce($4::uuid, conversation_id)
          where id = $1 and organization_id = $2`,
        [runId, ctx.organization_id, motivo, conversationId],
      );
    },
    { pool: deps.pool },
  );
  incrementCounter("reminder_skipped", { reason: motivo });
  return `skipped:${motivo}`;
}

/** O efeito que marca a tag na criação/movimento da conversa (§5.12). */
const marcarAguardandoQuantidade =
  () =>
  async (db: TenantDb, ctx: TenantCtx, conversationId: string, efeito: TransitionEffect): Promise<boolean> => {
    if (efeito !== "create_conversation_if_absent") return false;
    await marcarTag(db, ctx, conversationId, "awaiting_quantity");
    return true;
  };

async function enviarParaCliente(
  ctx: TenantCtx,
  cliente: ClienteElegivel,
  period: string,
  config: ConfigDoLembrete,
  conta: ContaDeCanal | null,
  agora: Date,
  deps: DepsDoLembrete,
): Promise<DesfechoDoCliente> {
  const claim = await withTenant(ctx, async (db) => claimarPeriodo(db, ctx, cliente.id, period), {
    pool: deps.pool,
  });
  if (claim.estado === "sent" || claim.estado === "skipped") {
    incrementCounter("reminder_duplicate_avoided");
    return "duplicate";
  }
  const retomada = claim.estado === "pending";

  if (conta === null) return pular(ctx, claim.id, "channel_account_missing", deps);
  if (cliente.phone_number === null || cliente.phone_number.length === 0) {
    return pular(ctx, claim.id, "contact_without_phone", deps);
  }

  let conversationId: string;
  try {
    const inicio = await iniciarPorAutomacao(
      ctx,
      { contact_id: cliente.id, channel_session_id: conta.channel_session_id },
      { pool: deps.pool, effects: marcarAguardandoQuantidade() },
    );
    conversationId = inicio.conversation_id;
  } catch (erro) {
    if (erro instanceof IllegalTransition) {
      incrementCounter("reminder_conversation_busy", { from: erro.from });
      return pular(ctx, claim.id, "conversation_busy", deps);
    }
    throw erro;
  }

  const corpo = corpoDoLembrete(config.message_template, {
    nome: cliente.display_name,
    resumoDoUltimoPedido: await resumoDoUltimoPedido(ctx, cliente.id, deps),
    period,
  });

  // F05-T07: o envio é do CATÁLOGO, com executor `automation`. Nenhum adapter
  // é tocado aqui; a entrega é do worker de saída.
  const envio = await execute(
    ctx,
    { kind: "automation" },
    "send_message",
    {
      conversation_id: conversationId,
      body: corpo,
      idempotency_key: chaveDeIdempotencia(ctx.organization_id, cliente.id, period),
    },
    {
      pool: deps.pool,
      ...(deps.adapters === undefined ? {} : { adapters: deps.adapters }),
      ...(deps.modo === undefined ? {} : { modo: deps.modo }),
      ...(deps.requestId === undefined ? {} : { requestId: deps.requestId }),
    },
  );
  if (envio.status !== "executed") {
    incrementCounter("reminder_send_denied", { reason: envio.reason ?? "unknown" });
    return pular(ctx, claim.id, "send_denied", deps, conversationId);
  }

  const messageId = String(envio.output?.["message_id"]);
  const cutoff = new Date(agora.getTime() + config.cutoff_hours * 3_600_000);
  await withTenant(
    ctx,
    async (db) => {
      await db.query(
        `update public.reminder_runs
            set conversation_id = $3, sent_message_id = $4, sent_at = $5, cutoff_at = $6
          where id = $1 and organization_id = $2`,
        [claim.id, ctx.organization_id, conversationId, messageId, agora.toISOString(), cutoff.toISOString()],
      );
    },
    { pool: deps.pool },
  );
  incrementCounter("reminder_sent");
  return retomada ? "resumed" : "sent";
}

export async function abrirJob(ctx: TenantCtx, kind: string, period: string, agora: Date, deps: DepsDoLembrete): Promise<string> {
  return withTenant(
    ctx,
    async (db) => {
      const job = await db.query<{ id: string }>(
        `insert into public.job_queue
           (organization_id, contact_id, kind, payload, status, max_attempts, attempts, run_after, locked_by, locked_at)
         values ($1::uuid, null, $2::text, $3::jsonb, 'running', 1, 1, now(), $4::text, now())
         returning id`,
        [
          ctx.organization_id,
          kind,
          JSON.stringify({ organization_id: ctx.organization_id, period_key: period, tick: agora.toISOString() }),
          `${kind}-${process.pid}`,
        ],
      );
      const id = job.rows[0]?.id;
      if (id === undefined) throw new Error("job_queue não devolveu id do job do lembrete");
      await db.query(
        `insert into public.job_runs (organization_id, job_id, attempt, started_at) values ($1::uuid,$2::uuid,1, now())`,
        [ctx.organization_id, id],
      );
      return id;
    },
    { pool: deps.pool },
  );
}

export async function fecharJob(
  ctx: TenantCtx,
  jobId: string,
  counts: Record<string, unknown>,
  erro: string | null,
  deps: DepsDoLembrete,
): Promise<void> {
  await withTenant(
    ctx,
    async (db) => {
      await db.query(
        `update public.job_runs set finished_at = now(), outcome = $3, error = $4
          where organization_id = $1 and job_id = $2 and attempt = 1`,
        [ctx.organization_id, jobId, erro === null ? "ok" : "erro", erro],
      );
      await db.query(
        `update public.job_queue
            set status = $3, locked_by = null, locked_at = null, last_error = $4,
                payload = payload || $5::jsonb
          where id = $1 and organization_id = $2`,
        [jobId, ctx.organization_id, erro === null ? "done" : "failed", erro, JSON.stringify({ counts })],
      );
    },
    { pool: deps.pool },
  );
}

/** O disparo de UM tenant, já dentro do seu contexto. */
export async function dispararParaTenant(
  ctx: TenantCtx,
  agora: Date,
  deps: DepsDoLembrete,
): Promise<ResultadoDoTenant> {
  const base = { organization_id: ctx.organization_id, customers_eligible: 0, sent: 0, duplicates_avoided: 0, skipped: 0, desfechos: [] as const };
  const config = await configDoLembrete(ctx, { pool: deps.pool });
  if (!config.enabled) return { ...base, fired: false, reason: "disabled" };

  const local = horaLocal(agora, await fusoDoTenant(ctx, { pool: deps.pool }));
  if (!bateAJanela(local, config)) {
    incrementCounter("reminder_outside_window");
    return { ...base, fired: false, reason: "outside_window" };
  }
  const period = chaveDoPeriodo(local);
  const jobId = await abrirJob(ctx, "recurring_reminder", period, agora, deps);

  const desfechos: { customer_id: string; desfecho: DesfechoDoCliente }[] = [];
  let sent = 0;
  let duplicates = 0;
  let skipped = 0;
  let clientes: readonly ClienteElegivel[] = [];
  try {
    const { lista, conta } = await withTenant(
      ctx,
      async (db) => ({ lista: await selectEligibleCustomers(db, ctx), conta: await contaDeCanalAtiva(db, ctx) }),
      { pool: deps.pool },
    );
    clientes = lista;
    for (const cliente of clientes) {
      const desfecho = await enviarParaCliente(ctx, cliente, period, config, conta, agora, deps);
      desfechos.push({ customer_id: cliente.id, desfecho });
      if (desfecho === "sent" || desfecho === "resumed") sent += 1;
      else if (desfecho === "duplicate") duplicates += 1;
      else skipped += 1;
    }
    await fecharJob(ctx, jobId, { customers_eligible: clientes.length, sent, duplicates_avoided: duplicates, skipped }, null, deps);
  } catch (erro) {
    await fecharJob(
      ctx,
      jobId,
      { customers_eligible: clientes.length, sent, duplicates_avoided: duplicates, skipped },
      erro instanceof Error ? erro.name : "erro",
      deps,
    );
    throw erro;
  }

  incrementCounter("reminder_tenant_fired");
  return {
    organization_id: ctx.organization_id,
    fired: true,
    period_key: period,
    job_id: jobId,
    customers_eligible: clientes.length,
    sent,
    duplicates_avoided: duplicates,
    skipped,
    desfechos,
  };
}

/** O cron de hora em hora (§5.12): um job run por tenant elegível que bate a janela. */
export async function rodarLembretes(deps: DepsDoLembrete = {}): Promise<ResultadoDosLembretes> {
  const agora = (deps.agora ?? (() => new Date()))();
  const listEligible =
    deps.listEligible ?? (() => listarTenantsComLembreteLigado({ pool: deps.pool }));
  const porTenant: ResultadoDoTenant[] = [];

  const corridas = await forEachEligibleTenant(
    CRON_KEY_DO_LEMBRETE,
    async (ctx) => {
      porTenant.push(await dispararParaTenant(ctx, agora, deps));
    },
    { pool: deps.pool, listEligible },
  );

  return {
    tenants_eligible: corridas.length,
    tenants_fired: porTenant.filter((t) => t.fired).length,
    tenants_failed: corridas.filter((c) => !c.ok).length,
    sent: porTenant.reduce((s, t) => s + t.sent, 0),
    duplicates_avoided: porTenant.reduce((s, t) => s + t.duplicates_avoided, 0),
    por_tenant: porTenant,
    falhas: corridas.filter((c) => !c.ok).map((c) => ({ organization_id: c.organization_id, error: c.error ?? "erro" })),
  };
}
