/**
 * QUEM recebe cada aviso (§5.16, F05-T05).
 *
 * `notify(ctx, event, recipients[])` recebe a lista pronta — a DIRETRIZ deixa
 * a resolução com o chamador, que é quem sabe se o fato tem dono (a tarefa tem
 * assignee; a conversa assumida tem atendente) ou se é da FILA (o handoff e a
 * confirmação são de "todo attendant", §5.11/D33). Estas duas funções são o
 * vocabulário comum para não se reescrever a consulta de membros em cada
 * chamador.
 *
 * Só membros ATIVOS (`accepted_at not null and revoked_at is null`): avisar quem
 * saiu da organização é vazar o fato para fora dela. `platform_admin` nunca
 * entra: o papel de plataforma não é membro do tenant, e um aviso de handoff
 * de um cliente não é assunto da administração global.
 */
import { papelD15DoHerdado, type PapelD15 } from "@/src/rbac/matrix";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

/** Membros ativos do tenant cujo papel D15 está na lista. Ordem estável. */
export async function membrosPorPapel(
  db: TenantDb,
  ctx: TenantCtx,
  papeis: readonly PapelD15[],
): Promise<readonly string[]> {
  const linhas = await db.query<{ user_id: string; role: string }>(
    `select user_id, role from public.user_organizations
      where organization_id = $1 and accepted_at is not null and revoked_at is null
      order by created_at asc, user_id asc`,
    [ctx.organization_id],
  );
  return linhas.rows
    .filter((linha) => {
      const papel = papelD15DoHerdado(linha.role);
      return papel !== null && papeis.includes(papel);
    })
    .map((linha) => linha.user_id);
}

/**
 * Quem recebe um aviso de CONVERSA: o atendente que a assumiu, se houver; senão
 * a fila (os papéis dados). É o critério de `customer.replied_while_human` — em
 * `human_handling` a conversa tem dono; em `waiting_human` ainda não, e o aviso
 * vai para quem pode assumi-la.
 */
export async function donoOuFila(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
  papeisDaFila: readonly PapelD15[],
): Promise<readonly string[]> {
  const dono = await db.query<{ assigned_to_user_id: string | null }>(
    `select assigned_to_user_id from public.conversations
      where id = $1 and organization_id = $2`,
    [conversationId, ctx.organization_id],
  );
  const assignee = dono.rows[0]?.assigned_to_user_id ?? null;
  if (assignee !== null) return [assignee];
  return membrosPorPapel(db, ctx, papeisDaFila);
}
