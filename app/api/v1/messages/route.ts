import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/messages — envia mensagem outbound (handler em ./_handler.ts).
 *
 * F03-T09: esta é a porta HUMANA do envio (`requireRole("agent")`, ator `user`),
 * e responder pelo inbox é o evento `human.reply_sent` de D16. A transição roda
 * ANTES do envio, de propósito: par ilegal recusa a ação inteira, em vez de
 * mandar a mensagem ao cliente e devolver erro depois.
 *
 * O evento fica na ROTA e não em `sendMessageHandler` porque o handler é
 * compartilhado com as tools MCP, a automação e o agente — atores para os quais
 * `human.reply_sent` seria mentira, e cujos movimentos D16 chegam em F04/F05.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { chaveDeIdempotencia, idDaMensagemIdempotente } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { ctxDoInbox, erroDeApiDaTransicao, moverPeloInbox } from "@/lib/inbox/acoes-d16";
import { sendMessageSchema, validateRequest, type SendMessageInput } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { sendMessageHandler } from "./_handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const activeOrg = authz.org;

  let input;
  try {
    input = await validateRequest(sendMessageSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const t = (texto: string) => traduzir(texto, user.idioma);
  try {
    await moverPeloInbox(
      ctxDoInbox(activeOrg.orgId, user.id, activeOrg.role),
      (input as SendMessageInput).conversation_id,
      "responder",
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

  // F06-T02 (§B10): o `apiClient` repete o POST após 10 s sem resposta e manda
  // `Idempotency-Key` sempre; com a chave, a mensagem ganha id fixo por
  // (organização, atendente, chave) e a repetição devolve a linha existente.
  const chave = chaveDeIdempotencia(req.headers);
  const idempotencia = chave
    ? { internalMessageId: idDaMensagemIdempotente(activeOrg.orgId, user.id, chave), idempotentReplay: true }
    : {};

  try {
    const message = await sendMessageHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
        idioma: user.idioma,
        ...idempotencia,
      },
      input as SendMessageInput,
    );
    return ok(message, { status: 201, requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
