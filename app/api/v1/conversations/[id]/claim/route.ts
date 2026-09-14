import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/claim — atendente assume a conversa.
 *
 * Concorrência: o UPDATE só vence se o assignee atual for NULL ou bater com
 * `expected_assignee` (optimistic lock). Se 0 linhas → 409 (outro atendente
 * já assumiu).
 *
 * G3-01: a mudança de dono acontece via rpc `fn_conversation_assign`
 * (migration 0031), que faz o UPDATE condicional + INSERT do evento em
 * `conversation_assignment_events` (reason='claim') na MESMA transação.
 *
 * 0173: essa mesma RPC agora grava `bot_silenced_until='infinity'` — assumir CALA
 * o atendimento automático. Antes disso o motor moderno nunca soube que alguém
 * assumiu (ele não lê `assignee_kind`) e os dois atendiam o mesmo cliente.
 *
 * F03-T09: a rota não chama mais a RPC direto. Quem move a conversa é
 * `transition()` (§5.6, ADR-016): ela valida o par D16, escreve `saas_state` e
 * delega a atribuição à MESMA `fn_conversation_assign` — nada do que está escrito
 * acima muda de dono. O lock otimista fica AQUI porque é da porta, não do
 * movimento: `transition()` não tem — nem deve ter — a expectativa de quem
 * clicou. O caso "assumir a conversa do automático" está em
 * `lib/inbox/acoes-d16.ts`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ctxDoInbox, erroDeApiDaTransicao, moverPeloInbox } from "@/lib/inbox/acoes-d16";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { claimConversationSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/messaging";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const user = authz.user;

  let input;
  try {
    input = await validateRequest(claimConversationSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // Optimistic lock (spec 04 §9.2): expected null/omitido = só assume se livre;
  // expected uuid = takeover consciente. A leitura é do client do REQUEST, então
  // a RLS é quem responde "esta conversa é visível para você" — ler com service
  // role aqui deixaria um agent fora de escopo assumir o que nem enxerga.
  const { data: atual, error: leituraErro } = await supabase
    .from("conversations")
    .select("id, assigned_to_user_id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (leituraErro) return fail("internal_error", leituraErro.message, 500, { requestId });
  if (!atual) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const donoAtual = (atual as { assigned_to_user_id: string | null }).assigned_to_user_id;
  if (donoAtual !== (input.expected_assignee ?? null)) {
    return fail("state_conflict", t("Outro atendente já assumiu."), 409, { requestId });
  }

  try {
    await moverPeloInbox(
      ctxDoInbox(authz.org.orgId, user.id, authz.org.role),
      id,
      "assumir",
      { kind: "attendant", userId: user.id },
    );
  } catch (err) {
    const apiErr = erroDeApiDaTransicao(err, requestId, t);
    if (!apiErr) throw err;
    return fail(apiErr.code, apiErr.message, apiErr.status, {
      details: apiErr.details,
      requestId,
    });
  }

  // A linha DEPOIS do movimento: o corpo da resposta é o que a tela recarrega.
  const { data: row, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!row) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }

  const conv = row as unknown as Conversation;

  await audit({
    action: "conversation.claimed",
    actorUserId: user.id,
    organizationId: conv.organization_id,
    resourceType: "conversation",
    resourceId: conv.id,
    requestId,
  });

  await supabase
    .rpc("emit_event", {
      p_event_type: "conversation.claimed",
      p_entity_kind: "conversation",
      p_entity_id: conv.id,
      p_payload: { assigned_to_user_id: user.id },
      p_metadata: { request_id: requestId },
      p_organization_id: conv.organization_id,
    })
    .then(({ error: emitErr }) => {
      if (emitErr) console.error("[conversation.claim] emit_event failed", emitErr.message);
    });

  // A linha na TELA. O `emit_event` acima e o audit não são lidos por atendente
  // nenhum; sem esta chamada, assumir uma conversa era invisível na timeline —
  // grep por atividade nas três rotas de troca de dono devolvia zero.
  await registrarTrocaDeComando({
    supabase,
    organizationId: conv.organization_id,
    conversationId: conv.id,
    contactId: conv.contact_id,
    tipo: "conversation_claimed",
    actor: { type: "user", id: user.id, role: authz.org.role },
    // Canônico em português: quem traduz é a LEITURA (`t(item.reason)`). Ver o
    // bloco "vocabulario de dominio persistido" em `lib/i18n/dicionario.ts`.
    motivo: "Assumiu o atendimento desta conversa",
  });

  return ok(conv, { requestId });
}
