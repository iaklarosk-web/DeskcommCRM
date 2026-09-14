/**
 * `audit: always` de §5.8 em um lugar só (§5.17, migration 9017).
 *
 * TODA saída de `execute()` e de `confirm()` — executada, pendente, negada ou
 * falha — deixa uma linha em `audit_events`. O id volta no `ActionResult`, e é
 * por ele que o chamador prova o que aconteceu.
 *
 * ─── Por que DOIS registros ────────────────────────────────────────────────
 *
 * `api_audit_log` é o log herdado do CRUD REST (L-10, append-only, retenção 5
 * anos) e continua sendo escrito: ele tem leitores — a tela de auditoria, as
 * provas da F02 e da F03 — e §5.17 põe as duas tabelas lado a lado em vez de
 * trocar uma pela outra. `audit_events` é o registro de §5.17, com `risk` e
 * `result`, vocabulário que o herdado não tem.
 *
 * As duas escritas acontecem na MESMA transação de `withTenant`: metade da
 * auditoria é pior que nenhuma, porque parece completa.
 *
 * ─── O que NUNCA entra ─────────────────────────────────────────────────────
 *
 * Corpo de mensagem do cliente, texto de item, nome de pessoa. Auditoria é
 * quem/quando/o quê — o conteúdo mora na tabela do domínio, sob as regras de
 * LGPD daquela tabela.
 */
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import type { ActionRisk } from "./catalog";

/** Os quatro resultados de §5.17, na mesma ordem do CHECK da 9017. */
export const AUDIT_RESULTS = ["executed", "pending", "denied", "failed"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/** Os quatro atores de §5.17. `user` e não `human`: é o vocabulário do §5.17. */
export const AUDIT_ACTOR_TYPES = ["user", "ai", "automation", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export interface AuditEvent {
  readonly actor_type: AuditActorType;
  readonly actor_id: string | null;
  readonly action_name: string;
  readonly risk: ActionRisk | null;
  readonly result: AuditResult;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly request_id: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Grava as duas linhas DENTRO da transação recebida. Existe separada de
 * `record()` porque `confirm()` já está numa transação quando audita, e abrir
 * outra deixaria a auditoria fora do commit do efeito.
 */
export async function recordIn(
  db: TenantDb,
  ctx: TenantCtx,
  evento: AuditEvent,
): Promise<string> {
  const gravado = await db.query<{ id: string }>(
    `insert into public.audit_events
       (organization_id, actor_type, actor_id, action_name, risk, result,
        resource_type, resource_id, request_id, payload)
     values ($1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::text,
             $7::text,$8::uuid,$9::text,$10::jsonb)
    returning id`,
    [
      ctx.organization_id,
      evento.actor_type,
      evento.actor_id,
      evento.action_name,
      evento.risk,
      evento.result,
      evento.resource_type,
      evento.resource_id,
      evento.request_id,
      JSON.stringify(evento.payload),
    ],
  );
  const id = gravado.rows[0]?.id;
  if (id === undefined) throw new Error("audit_events não devolveu id da linha gravada");

  // O herdado, no mesmo commit. `actor_user_id` só recebe usuário de verdade:
  // a IA e a automação não têm linha em `auth.users`, e a FK recusaria.
  await db.query(
    `insert into public.api_audit_log
       (organization_id, actor_user_id, action, resource_type, resource_id,
        request_id, bypassed_rls, metadata)
     values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,true,$7::jsonb)`,
    [
      ctx.organization_id,
      evento.actor_type === "user" ? evento.actor_id : null,
      `action.${evento.action_name}.${evento.result}`,
      evento.resource_type,
      evento.resource_id,
      evento.request_id,
      JSON.stringify({
        actor_type: evento.actor_type,
        risk: evento.risk,
        audit_event_id: id,
        ...evento.payload,
      }),
    ],
  );

  return id;
}

/** A mesma escrita, abrindo a transação. Para quem audita fora de uma. */
export async function record(
  ctx: TenantCtx,
  evento: AuditEvent,
  deps: { pool?: ServicePool } = {},
): Promise<string> {
  return withTenant(ctx, async (db) => recordIn(db, ctx, evento), { pool: deps.pool });
}
