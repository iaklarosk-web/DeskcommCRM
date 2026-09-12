/**
 * Worker de SAÍDA (§5.13, F03-T07/T08, ADR-017 decisão 5).
 *
 * Um ciclo faz, por job: reivindica → registra a tentativa em `job_runs` →
 * manda entregar por `src/actions/execute` → fecha a tentativa. Falha reagenda
 * com backoff; na TERCEIRA falha o job vai a `blocked`, a mensagem vai a
 * `failed` e um humano é avisado (G-15).
 *
 * ─── A descoberta de tenant é a ÚNICA leitura cross-tenant, e é SÓ leitura ──
 *
 * `withTenant` é o único caminho ao Postgres com service role (§5.1) — mas a
 * fila é, por natureza, de todas as organizações: descobrir de quem é o próximo
 * job é justamente o que ainda não tem tenant. Então o módulo separa as duas
 * coisas, como `forEachEligibleTenant` separa `listEligible` do trabalho:
 *
 *   1. `candidatosDeSaida()` — UMA leitura, sem escrita, devolvendo só id,
 *      organização e payload;
 *   2. `fromJob(payload)` — o validador de D20, o MESMO do `enqueue`;
 *   3. tudo o mais dentro de `withTenant(ctx)`.
 *
 * A reivindicação (a ESCRITA) já acontece com tenant em mãos e filtrada por
 * `organization_id`; o `where status='pending'` no UPDATE é o que faz dois
 * workers na mesma linha terminarem com um vencedor e um zero-linhas, sem
 * precisar de lock explícito.
 *
 * ─── O `notify(job.blocked)` tem DUAS linhas, de propósito ─────────────────
 *
 * `agent_inbox_items(kind='job_dead')` é o aviso operacional que a organização
 * JÁ tem (`supabase/baseline.sql:6456-6458`) e continua sendo escrito. Desde a
 * F05-T05 o mesmo bloqueio também grava o aviso POR USUÁRIO de §5.16
 * (`job.blocked`, para os `tenant_admin` ativos), na mesma transação. Não são
 * dois avisos concorrentes para o mesmo leitor: um é o cartão da Central; o
 * outro é a linha que a pessoa marca como lida e que pode virar e-mail.
 */
import { randomUUID } from "node:crypto";

import { entregarSaida, type ExecuteDeps } from "@/src/actions/execute";
import type { SaasChannelAdapter, SaasChannelProvider } from "@/src/channels/contract";
import { membrosPorPapel, notify } from "@/src/notifications";
import { incrementCounter } from "@/src/obs/counters";
import { capturarErro } from "@/src/obs/erros";
import { registrarJob } from "@/src/obs/log";
import { fromJob, withTenant, type TenantCtx } from "@/src/tenant-context";
import { getServicePool, type ServicePool } from "@/src/tenant-context/db";

import { normalizarErro } from "./erros";

/** Backoff de §5.13: 30 s depois da 1ª falha, 120 s depois da 2ª. */
export const BACKOFF_PADRAO_MS: readonly number[] = [30_000, 120_000];

/** Quantos jobs um ciclo atende. Lote pequeno: ciclo curto reage a SIGTERM. */
const LOTE_PADRAO = 10;

export interface CicloDeSaidaDeps extends ExecuteDeps {
  pool?: ServicePool;
  adapters?: Partial<Record<SaasChannelProvider, SaasChannelAdapter>>;
  modo?: string;
  /** Seam de teste: `[0,0]` faz a retentativa ser imediata. */
  backoffMs?: readonly number[];
  lote?: number;
  /** Quem reivindicou — vai para `job_queue.locked_by`. */
  locadoPor?: string;
}

export interface ResultadoDoCiclo {
  reivindicados: number;
  entregues: number;
  falhas: number;
  bloqueados: number;
}

interface CandidatoDeSaida {
  id: string;
  organization_id: string;
  payload: Record<string, unknown>;
}

interface JobReivindicado {
  attempts: number;
  max_attempts: number;
}

/**
 * A leitura cross-tenant. Sem escrita e sem dado de negócio: id, organização e
 * o payload que o `fromJob` vai validar.
 */
async function candidatosDeSaida(pool: ServicePool, lote: number): Promise<CandidatoDeSaida[]> {
  const linhas = await pool.query<CandidatoDeSaida>(
    `select id, organization_id, payload
       from public.job_queue
      where kind = 'outbound_message' and status = 'pending' and run_after <= now()
      order by priority asc, run_after asc
      limit $1`,
    [lote],
  );
  return linhas.rows;
}

function backoffDe(deps: CicloDeSaidaDeps, tentativa: number): number {
  const tabela = deps.backoffMs ?? BACKOFF_PADRAO_MS;
  if (tabela.length === 0) return 0;
  const indice = Math.min(Math.max(tentativa - 1, 0), tabela.length - 1);
  return tabela[indice] ?? 0;
}

/** O que o payload precisa ter para virar entrega. Falta = defeito de quem enfileirou. */
function entregaDoPayload(payload: Record<string, unknown>): {
  conversation_id: string;
  message_id: string;
  to_e164: string;
  provider: SaasChannelProvider;
  account_key: string | null;
  idempotency_key: string;
} | null {
  const conversationId = payload["conversation_id"];
  const messageId = payload["message_id"];
  const toE164 = payload["to_e164"];
  const provider = payload["provider"];
  const idempotencyKey = payload["idempotency_key"];
  const accountKey = payload["account_key"];
  if (
    typeof conversationId !== "string" ||
    typeof messageId !== "string" ||
    typeof toE164 !== "string" ||
    typeof provider !== "string" ||
    typeof idempotencyKey !== "string"
  ) {
    return null;
  }
  return {
    conversation_id: conversationId,
    message_id: messageId,
    to_e164: toE164,
    provider: provider as SaasChannelProvider,
    account_key: typeof accountKey === "string" ? accountKey : null,
    idempotency_key: idempotencyKey,
  };
}

/** Fecha a tentativa com sucesso: `job_runs.ok` + job `done`. */
async function fecharComSucesso(
  ctx: TenantCtx,
  jobId: string,
  tentativa: number,
  deps: CicloDeSaidaDeps,
): Promise<void> {
  await withTenant(
    ctx,
    async (db) => {
      await db.query(
        `update public.job_runs set finished_at = now(), outcome = 'ok'
          where organization_id = $1 and job_id = $2 and attempt = $3`,
        [ctx.organization_id, jobId, tentativa],
      );
      await db.query(
        `update public.job_queue
            set status = 'done', locked_by = null, locked_at = null, last_error = null
          where id = $1 and organization_id = $2`,
        [jobId, ctx.organization_id],
      );
    },
    { pool: deps.pool },
  );
}

/**
 * Fecha a tentativa com erro. Reagenda enquanto houver tentativa; na última,
 * BLOQUEIA: job `blocked`, mensagem `failed` e aviso na central.
 *
 * `blocked` e não `dead`: `dead` é o terminal do motor herdado ("a fila
 * desistiu"); `blocked` é "parou e chamou gente", que é o que G-15 pede.
 */
async function fecharComErro(
  ctx: TenantCtx,
  jobId: string,
  tentativa: number,
  maxTentativas: number,
  messageId: string | null,
  erro: unknown,
  deps: CicloDeSaidaDeps,
): Promise<{ bloqueado: boolean }> {
  const normalizado = normalizarErro(erro);
  const ultima = tentativa >= maxTentativas;

  await withTenant(
    ctx,
    async (db) => {
      await db.query(
        `update public.job_runs
            set finished_at = now(), outcome = 'erro', error = $4
          where organization_id = $1 and job_id = $2 and attempt = $3`,
        [ctx.organization_id, jobId, tentativa, normalizado],
      );

      if (!ultima) {
        await db.query(
          `update public.job_queue
              set status = 'pending', run_after = now() + make_interval(secs => $3::double precision),
                  locked_by = null, locked_at = null, last_error = $4
            where id = $1 and organization_id = $2`,
          [jobId, ctx.organization_id, backoffDe(deps, tentativa) / 1000, normalizado],
        );
        return;
      }

      await db.query(
        `update public.job_queue
            set status = 'blocked', locked_by = null, locked_at = null, last_error = $3
          where id = $1 and organization_id = $2`,
        [jobId, ctx.organization_id, normalizado],
      );

      if (messageId !== null) {
        // Nada se perde: a mensagem continua no banco, agora declarada `failed`.
        await db.query(
          `update public.messages set status = 'failed', error_message = $3, updated_at = now()
            where id = $1 and organization_id = $2`,
          [messageId, ctx.organization_id, normalizado],
        );
      }

      // notify(job.blocked) da F03 — o aviso operacional herdado. Título e
      // corpo carregam id e erro NORMALIZADO; nunca o texto da mensagem.
      await db.query(
        `insert into public.agent_inbox_items
           (organization_id, kind, severity, title, body, ref_kind, ref_id)
         values ($1::uuid,'job_dead','critical',$2::text,$3::text,'job_queue',$4::uuid)`,
        [
          ctx.organization_id,
          `Envio bloqueado após ${tentativa} tentativas`,
          `job=${jobId} erro=${normalizado}`,
          jobId,
        ],
      );

      // notify(job.blocked) POR USUÁRIO (§5.16, F05-T05): quem administra o
      // tenant. Mesmo payload de ids e erro normalizado — nunca o texto.
      await notify(
        db,
        ctx,
        "job.blocked",
        await membrosPorPapel(db, ctx, ["tenant_admin"]),
        {
          job_id: jobId,
          kind: "outbound_message",
          attempts: tentativa,
          error: normalizado,
          message_id: messageId,
        },
      );
    },
    { pool: deps.pool },
  );

  incrementCounter(ultima ? "job_blocked" : "job_retry", { kind: "outbound_message" });
  return { bloqueado: ultima };
}

/**
 * Um ciclo. Devolve contagem com denominador — é ela que o `--once` imprime e
 * que o teste de integração confere.
 */
export async function rodarCicloDeSaida(
  deps: CicloDeSaidaDeps = {},
): Promise<ResultadoDoCiclo> {
  const pool = deps.pool ?? (await getServicePool());
  const locadoPor = deps.locadoPor ?? `saida-${process.pid}-${randomUUID().slice(0, 8)}`;
  const resultado: ResultadoDoCiclo = {
    reivindicados: 0,
    entregues: 0,
    falhas: 0,
    bloqueados: 0,
  };

  for (const candidato of await candidatosDeSaida(pool, deps.lote ?? LOTE_PADRAO)) {
    // D20: o consumidor valida o tenant do PAYLOAD antes de executar. Payload
    // sem `organization_id` é recusado e contado pelo próprio `fromJob`.
    let ctx: TenantCtx;
    try {
      ctx = fromJob(candidato.payload);
    } catch {
      continue;
    }
    if (ctx.organization_id !== candidato.organization_id) {
      incrementCounter("tenant_ctx_rejected", { source: "job", reason: "organization_mismatch" });
      continue;
    }

    const reivindicado = await withTenant(
      ctx,
      async (db) => {
        const linha = await db.query<JobReivindicado>(
          `update public.job_queue
              set status = 'running', attempts = attempts + 1,
                  locked_by = $3, locked_at = now()
            where id = $1 and organization_id = $2 and status = 'pending'
              and run_after <= now()
          returning attempts, max_attempts`,
          [candidato.id, ctx.organization_id, locadoPor],
        );
        const job = linha.rows[0];
        if (job === undefined) return null;

        // Uma linha por TENTATIVA, e o índice único (organization_id, job_id,
        // attempt) é quem garante isso — não este insert.
        await db.query(
          `insert into public.job_runs (organization_id, job_id, attempt, started_at)
           values ($1::uuid,$2::uuid,$3::smallint, now())`,
          [ctx.organization_id, candidato.id, job.attempts],
        );
        return job;
      },
      { pool: deps.pool },
    );

    // Zero linhas: outro worker levou o job entre a leitura e a escrita. Perder
    // a rodada é o desfecho certo — não é erro e não conta como falha.
    if (reivindicado === null) continue;
    resultado.reivindicados += 1;
    // F06-T01: uma linha JSON por transição do job, com o tenant e o job_id.
    registrarJob({
      request_id: candidato.id,
      organization_id: ctx.organization_id,
      job_type: "outbound_message",
      outcome: "claimed",
      attempt: reivindicado.attempts,
    });

    const entrega = entregaDoPayload(candidato.payload);
    const messageId = typeof candidato.payload["message_id"] === "string"
      ? (candidato.payload["message_id"] as string)
      : null;

    try {
      if (entrega === null) throw new Error("payload de saída incompleto");
      await entregarSaida(ctx, entrega, {
        pool: deps.pool,
        adapters: deps.adapters,
        modo: deps.modo,
      });
      await fecharComSucesso(ctx, candidato.id, reivindicado.attempts, deps);
      resultado.entregues += 1;
      registrarJob({
        request_id: candidato.id,
        organization_id: ctx.organization_id,
        job_type: "outbound_message",
        outcome: "ok",
        attempt: reivindicado.attempts,
        counts: { messages_sent: 1 },
      });
    } catch (erro) {
      const { bloqueado } = await fecharComErro(
        ctx,
        candidato.id,
        reivindicado.attempts,
        reivindicado.max_attempts,
        messageId,
        erro,
        deps,
      );
      resultado.falhas += 1;
      if (bloqueado) resultado.bloqueados += 1;
      const errorCode = normalizarErro(erro).slice(0, 120);
      registrarJob({
        request_id: candidato.id,
        organization_id: ctx.organization_id,
        job_type: "outbound_message",
        outcome: bloqueado ? "blocked" : "failed",
        attempt: reivindicado.attempts,
        error_code: errorCode,
      });
      capturarErro(erro, {
        request_id: candidato.id,
        organization_id: ctx.organization_id,
        job_type: "outbound_message",
        error_code: errorCode,
      });
    }
  }

  return resultado;
}
