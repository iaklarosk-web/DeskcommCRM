/**
 * F15-T03 — handoff por RODÍZIO (ADR-036 §2 T03, D54 d).
 *
 * `handoff.assignment=round_robin`: o dossiê nasce entregue a um membro da
 * fila (`handoff.queue_roles`) escolhido por `selectRoundRobin` de
 * `lib/routing/decide.ts` — quem recebeu há mais tempo (ou nunca) primeiro,
 * desempate por id. O "último atribuído" por pessoa é lido de
 * `handoffs.assigned_at` (migration 9029): a cada entrega o escolhido vira o
 * mais recente, e a N-ésima entrega cai no N-ésimo elegível — `balanced=1`
 * (max − min ≤ 1) é consequência, não configuração. Mesmo rodízio da fila de
 * oportunidades (F13), outra fila.
 *
 * Em `queue` (default) nada disto roda: a fila continua a corrida de sempre.
 */
import { selectRoundRobin, type RoutingCandidate } from "@/lib/routing/decide";
import { papelD15DoHerdado, type PapelD15 } from "@/src/rbac/matrix";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export const ATRIBUICOES = ["queue", "round_robin"] as const;
export type Atribuicao = (typeof ATRIBUICOES)[number];

export function ehAtribuicao(valor: unknown): valor is Atribuicao {
  return typeof valor === "string" && (ATRIBUICOES as readonly string[]).includes(valor);
}

/**
 * Os elegíveis da organização com o carimbo do último handoff entregue a cada
 * um. Membro aceito e não revogado cujo papel D15 está na lista da fila.
 */
export async function elegiveisDoRodizio(
  db: TenantDb,
  ctx: TenantCtx,
  papeis: readonly PapelD15[],
): Promise<RoutingCandidate[]> {
  const membros = await db.query<{ user_id: string; role: string; ultimo: Date | string | null; carga: string }>(
    `select uo.user_id, uo.role,
            (select max(h.assigned_at) from public.handoffs h
              where h.organization_id = uo.organization_id and h.assigned_to = uo.user_id) as ultimo,
            (select count(*)::text from public.handoffs h
              where h.organization_id = uo.organization_id and h.assigned_to = uo.user_id and h.claimed_at is null) as carga
       from public.user_organizations uo
      where uo.organization_id = $1
        and uo.accepted_at is not null and uo.revoked_at is null
      order by uo.user_id`,
    [ctx.organization_id],
  );
  return membros.rows
    .filter((m) => {
      const papel = papelD15DoHerdado(m.role);
      return papel !== null && papeis.includes(papel);
    })
    .map((m) => ({
      userId: m.user_id,
      lastAssignedAt: m.ultimo === null ? null : new Date(m.ultimo).getTime(),
      currentLoad: Number(m.carga),
    }));
}

/** Escolhe e CARIMBA o handoff; devolve o escolhido, ou null sem elegível. */
export async function entregarPorRodizio(
  db: TenantDb,
  ctx: TenantCtx,
  handoffId: string,
  papeis: readonly PapelD15[],
): Promise<string | null> {
  const escolhido = selectRoundRobin(await elegiveisDoRodizio(db, ctx, papeis));
  if (escolhido === null) return null;
  await db.query(
    `update public.handoffs set assigned_to = $3::uuid, assigned_at = clock_timestamp()
      where id = $1 and organization_id = $2 and assigned_to is null`,
    [handoffId, ctx.organization_id, escolhido],
  );
  return escolhido;
}
