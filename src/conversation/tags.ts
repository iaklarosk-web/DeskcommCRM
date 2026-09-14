/**
 * As TAGS da conversa (§5.6: `tags` "só recebe valores do enum
 * `{awaiting_quantity}` na Fase 1"; migration 9022, coluna `saas_tags`).
 *
 * Vocabulário FECHADO, aqui e no CHECK do banco: uma tag nova é 1 valor neste
 * array + 1 valor em `conversations_saas_tags_check`, no mesmo commit. A tag é
 * marca, não estado — quem move a conversa continua sendo `transition()`; a
 * tag diz ao turno da IA COMO ler a próxima mensagem do cliente (§5.12: "a IA
 * lê a tag, extrai quantidades e chama `update_order_quantity`").
 *
 * Escrita idempotente por construção (`array_append` só quando ausente,
 * `array_remove` sempre): marcar duas vezes não duplica; limpar o que não
 * está não falha.
 */
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export const CONVERSATION_TAGS = ["awaiting_quantity"] as const;
export type ConversationTag = (typeof CONVERSATION_TAGS)[number];

export async function marcarTag(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
  tag: ConversationTag,
): Promise<void> {
  await db.query(
    `update public.conversations
        set saas_tags = case when $3 = any(saas_tags) then saas_tags else array_append(saas_tags, $3) end
      where id = $1 and organization_id = $2`,
    [conversationId, ctx.organization_id, tag],
  );
}

export async function limparTag(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
  tag: ConversationTag,
): Promise<void> {
  await db.query(
    `update public.conversations set saas_tags = array_remove(saas_tags, $3)
      where id = $1 and organization_id = $2`,
    [conversationId, ctx.organization_id, tag],
  );
}

export async function tagsDaConversa(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
): Promise<readonly ConversationTag[]> {
  const r = await db.query<{ saas_tags: string[] }>(
    `select saas_tags from public.conversations where id = $1 and organization_id = $2`,
    [conversationId, ctx.organization_id],
  );
  const lidas = r.rows[0]?.saas_tags ?? [];
  return lidas.filter((t): t is ConversationTag =>
    (CONVERSATION_TAGS as readonly string[]).includes(t),
  );
}
