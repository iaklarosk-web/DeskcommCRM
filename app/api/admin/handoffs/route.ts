/**
 * `GET /api/admin/handoffs` (F24-T05, Suporte KN, 25/09/2026) — os casos
 * que ESPERAM UMA PESSOA em todas as organizações da instalação, numa
 * leitura só, para a rotina de aviso do dono (o Núcleo lê e avisa no
 * Telegram com o link da conversa no inbox).
 *
 * Por que aqui e não por token de API: o token `dsk_…` é POR organização, e o
 * suporte da KN é uma organização por produto — cinco tokens, cinco leituras,
 * cinco segredos para a mesma pergunta. O cockpit já responde ao dono com um
 * bearer só (`ADMIN_SUMMARY_TOKEN`, `lib/admin/cockpit.ts`); esta rota é a
 * segunda pergunta do mesmo cockpit. SÓ LEITURA: um `select`, nenhum efeito.
 *
 * O que é "caso em espera": conversa não resolvida com `saas_state =
 * waiting_human` OU com um repasse (`handoffs`) ainda não assumido
 * (`claimed_at is null`) — os dois lados que a página do visitante também
 * olha (`src/webchat/mensagens.ts`). Nada de conteúdo de mensagem: o que sai
 * é o resumo e o próximo passo que o próprio repasse já carrega, o nome do
 * contato e os caminhos para abrir a conversa.
 *
 * `?slug=a&slug=b` (ou `?slug=a,b`) restringe às organizações pedidas;
 * `?limit=` 1..200 (padrão 100), do mais antigo para o mais novo.
 */
import { z } from "zod";

import { autorizarCockpit } from "@/lib/admin/cockpit";
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { getServicePool } from "@/src/tenant-context/db";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

const consultaSchema = z.object({
  slug: z.array(z.string().regex(SLUG)).max(50),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

interface LinhaDoCaso {
  conversation_id: string;
  organization_id: string;
  slug: string;
  display_name: string | null;
  channel: string | null;
  saas_state: string | null;
  contact_name: string | null;
  handoff_id: string | null;
  reason: string | null;
  summary: string | null;
  suggested_next_step: string | null;
  waiting_since: Date | string | null;
  last_inbound_at: Date | string | null;
}

function iso(valor: Date | string | null): string | null {
  if (valor === null) return null;
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

export const SQL_DOS_CASOS_EM_ESPERA = `
select c.id as conversation_id,
       c.organization_id,
       o.slug::text as slug,
       o.display_name,
       c.channel,
       c.saas_state,
       ct.name as contact_name,
       h.id as handoff_id,
       h.reason,
       h.summary,
       h.suggested_next_step,
       coalesce(h.created_at, c.saas_state_entered_at, c.last_inbound_at, c.created_at) as waiting_since,
       c.last_inbound_at
  from public.conversations c
  join public.organizations o on o.id = c.organization_id
  left join public.contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
  left join lateral (
    select h.id, h.reason, h.summary, h.suggested_next_step, h.created_at
      from public.handoffs h
     where h.organization_id = c.organization_id and h.conversation_id = c.id and h.claimed_at is null
     order by h.created_at desc
     limit 1
  ) h on true
 where c.is_group = false
   and c.status <> 'resolved'
   and (c.saas_state = 'waiting_human' or h.id is not null)
   and ($1::text[] is null or o.slug::text = any($1::text[]))
 order by waiting_since asc, c.id asc
 limit $2`;

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const guarda = autorizarCockpit(req, { requestId, path: "/api/admin/handoffs" });
  if (!guarda.ok) return guarda.response;

  const url = new URL(req.url);
  const slugs = url.searchParams
    .getAll("slug")
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const consulta = consultaSchema.safeParse({ slug: slugs, limit: url.searchParams.get("limit") ?? undefined });
  if (!consulta.success) {
    guarda.registrar(422);
    return fail("validation_failed", "slug (a-z, 0-9, hífen) e limit (1..200) inválidos.", 422, { requestId, details: consulta.error.flatten() });
  }

  const pool = await getServicePool();
  const { rows } = await pool.query<LinhaDoCaso>(SQL_DOS_CASOS_EM_ESPERA, [consulta.data.slug.length === 0 ? null : consulta.data.slug, consulta.data.limit]);
  const cases = rows.map((l) => ({
    organization: { id: l.organization_id, slug: l.slug, name: l.display_name ?? l.slug },
    conversation_id: l.conversation_id,
    channel: l.channel,
    state: l.saas_state,
    contact_name: l.contact_name,
    handoff_id: l.handoff_id,
    reason: l.reason,
    summary: l.summary,
    suggested_next_step: l.suggested_next_step,
    waiting_since: iso(l.waiting_since),
    last_inbound_at: iso(l.last_inbound_at),
    inbox_path: `/app/inbox?id=${l.conversation_id}`,
    admin_path: `/admin/inbox/${l.conversation_id}`,
  }));
  guarda.registrar(200);
  return ok({ generated_at: new Date().toISOString(), count: cases.length, cases }, { requestId });
}
