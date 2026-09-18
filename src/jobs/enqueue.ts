/**
 * `enqueue()` — a porta de entrada da fila (§5.13, D20, ADR-017 decisão 5).
 *
 * Duas regras duras, e as duas são de BANCO ou de contador, nunca de boa
 * vontade do chamador:
 *
 *  1. **Payload sem `organization_id` é RECUSADO e CONTADO.** A validação é o
 *     `fromJob` do TenantContext — o MESMO validador que o consumidor usa
 *     (§5.1, invariante 2). Reescrever a checagem aqui daria duas respostas
 *     possíveis para "este job tem tenant?", e a que vale seria a que rodou
 *     por último.
 *
 *  2. **A idempotência é do ÍNDICE.** `job_queue_outbound_message_uk`
 *     (migration 9016) recusa o segundo job da mesma `message_id`; aqui só se
 *     nomeia o árbitro no `on conflict`. Um `select` antes do `insert` teria a
 *     janela entre a leitura e a escrita — que é justamente o caso que a
 *     idempotência existe para cobrir.
 *
 * O job de saída tem `contact_id` NULO de propósito: ele endereça uma CONVERSA
 * e uma MENSAGEM, e a CHECK de coerência herdada (`kind ⇔ contact_id`) só
 * exige contato dos kinds de turno. Ver o cabeçalho da migration 9016.
 */
import { incrementCounter } from "@/src/obs/counters";
import { fromJob, TenantResolutionError, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant } from "@/src/tenant-context";

/**
 * Retry N=3 (§5.13): 1 tentativa + 2 idênticas. Na terceira falha o job vai a
 * `blocked` e nada mais roda automaticamente (G-15).
 *
 * Gravado em `job_queue.max_attempts` no INSERT, e não lido de uma constante
 * pelo worker, porque o limite tem de viajar COM o job: um worker atualizado no
 * meio de um backlog mudaria o limite de jobs que já estavam na fila.
 */
export const MAX_TENTATIVAS_DE_SAIDA = 3;

/** Os kinds que esta porta sabe enfileirar. Kind novo = 1 linha aqui. */
export const JOB_KINDS_DE_SAIDA = ["outbound_message"] as const;
export type JobKindDeSaida = (typeof JOB_KINDS_DE_SAIDA)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Payload sintaticamente inválido — distinto de payload sem tenant (D19). */
export class EnqueueInvalido extends Error {
  constructor(public readonly campo: string) {
    super(`payload de job inválido: ${campo}`);
    this.name = "EnqueueInvalido";
  }
}

export interface EnqueueResult {
  job_id: string;
  /** `false` = a fila já tinha o job desta mensagem; nada foi escrito. */
  created: boolean;
}

export interface EnqueueDeps {
  pool?: ServicePool;
}

export async function enqueue(
  ctx: TenantCtx,
  kind: JobKindDeSaida,
  payload: Record<string, unknown>,
  deps: EnqueueDeps = {},
): Promise<EnqueueResult> {
  // Recusa contada + erro tipado. `fromJob` já incrementa
  // `tenant_ctx_rejected{source=job}` e lança `TenantResolutionError`.
  const doPayload = fromJob(payload);

  // Tenant no payload divergente do tenant do chamador é o modo de falha que
  // um `enqueue` distraído produz: o job rodaria na organização do payload, que
  // não é a que autorizou a ação. Recusa, conta e não escreve.
  if (doPayload.organization_id !== ctx.organization_id) {
    incrementCounter("tenant_ctx_rejected", { source: "job", reason: "organization_mismatch" });
    throw new TenantResolutionError("job", "organization_mismatch");
  }

  const messageId = payload["message_id"];
  if (typeof messageId !== "string" || !UUID_RE.test(messageId)) {
    throw new EnqueueInvalido("message_id");
  }

  return withTenant(
    ctx,
    async (db) => {
      const inserido = await db.query<{ id: string }>(
        `insert into public.job_queue
           (organization_id, contact_id, kind, payload, status, max_attempts, run_after)
         values ($1::uuid, null, $2::text, $3::jsonb, 'pending', $4::smallint, now())
         on conflict (organization_id, ((payload->>'message_id')))
           where kind = 'outbound_message' and payload->>'message_id' is not null
           do nothing
        returning id`,
        [ctx.organization_id, kind, JSON.stringify(payload), MAX_TENTATIVAS_DE_SAIDA],
      );

      const novo = inserido.rows[0]?.id;
      if (novo !== undefined) {
        incrementCounter("job_enqueued", { kind });
        return { job_id: novo, created: true };
      }

      // O índice recusou: o job desta mensagem já existe. Devolver o id do que
      // existe — e não `null` — é o que faz o chamador tratar reenfileiramento
      // como sucesso idempotente em vez de erro.
      const existente = await db.query<{ id: string }>(
        `select id from public.job_queue
          where organization_id = $1 and kind = $2 and payload->>'message_id' = $3`,
        [ctx.organization_id, kind, messageId],
      );
      const id = existente.rows[0]?.id;
      if (id === undefined) {
        throw new EnqueueInvalido("conflito sem job correspondente");
      }
      incrementCounter("job_enqueue_duplicado", { kind });
      return { job_id: id, created: false };
    },
    { pool: deps.pool },
  );
}
