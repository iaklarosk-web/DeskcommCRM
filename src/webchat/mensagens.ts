/**
 * O que a página do visitante LÊ (F14, ADR-038 §2 T02: polling de 3 s).
 *
 * Só a conversa da própria sessão; só o que o visitante pode ver: texto de
 * entrada e de saída ENTREGUE (`sent`/`delivered`/`read`) — nada de `queued`
 * (ainda não foi ao "fio"), `failed`, nota interna ou metadado do CRM. O
 * cursor é `created_at` da última linha vista; a página pede "depois de".
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import type { SessaoDoVisitante, WebchatDeps } from "./sessao";

export interface MensagemVisivel {
  readonly id: string;
  readonly direction: "inbound" | "outbound";
  readonly body: string;
  readonly created_at: string;
  /** Quem escreveu a saída: `ai`, `human` ou `automation` (do `sent_via`). */
  readonly author: "visitor" | "ai" | "human" | "automation";
}

// `messages_sent_via_check`: crm | external_device | automation | ai | user | system.
const AUTOR_POR_SENT_VIA: Record<string, MensagemVisivel["author"]> = {
  ai: "ai",
  crm: "human",
  user: "human",
  automation: "automation",
  system: "automation",
};

export async function listarMensagensDoVisitante(
  sessao: SessaoDoVisitante,
  depoisDe: string | null,
  deps: WebchatDeps = {},
): Promise<MensagemVisivel[]> {
  if (sessao.conversation_id === null) return [];
  const ctx: TenantCtx = { organization_id: sessao.organization_id, source: "webhook" };
  return withTenant(
    ctx,
    async (db) => {
      const linhas = await db.query<{ id: string; direction: string; body: string | null; created_at: string; sent_via: string | null }>(
        `select id, direction, body, created_at::text, sent_via
           from public.messages
          where organization_id = $1 and conversation_id = $2
            and type = 'text' and body is not null
            and (direction = 'inbound' or (direction = 'outbound' and status in ('sent','delivered','read')))
            and ($3::timestamptz is null or created_at > $3::timestamptz)
          order by created_at asc
          limit 200`,
        [ctx.organization_id, sessao.conversation_id, depoisDe],
      );
      return linhas.rows.map((l) => ({
        id: l.id,
        direction: l.direction === "inbound" ? "inbound" : "outbound",
        body: l.body ?? "",
        created_at: l.created_at,
        author: l.direction === "inbound" ? "visitor" : (AUTOR_POR_SENT_VIA[l.sent_via ?? ""] ?? "human"),
      }));
    },
    { pool: deps.pool },
  );
}
