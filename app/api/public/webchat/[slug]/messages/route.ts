/**
 * /api/public/webchat/[slug]/messages (F14, ADR-038 §2 T01/T02).
 *  - POST: a mensagem do visitante entra no CRM pelo MESMO fim de caminho de
 *    todo canal (`concluirEntrada`); exige identificação; freios por
 *    IP/organização; `client_message_id` é o árbitro da reentrega.
 *  - GET ?after=<iso>: o que a página lê a cada 3 s — só a conversa da própria
 *    sessão, só o que o visitante pode ver.
 * Autoridade nos dois: o token da sessão + o slug.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { registrarRequisicaoDe } from "@/src/obs/log";
import { estadoDaConversaDoVisitante, janelaDoHumano, listarMensagensDoVisitante, receberMensagemDoVisitante, TAMANHO_MAXIMO_DA_MENSAGEM } from "@/src/webchat";

import { sessaoDaRequisicao, STATUS_POR_MOTIVO } from "../_comum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({
  client_message_id: z.string().uuid(),
  body: z.string().min(1).max(TAMANHO_MAXIMO_DA_MENSAGEM),
});

const consultaSchema = z.object({
  after: z.string().datetime({ offset: true }).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { slug } = await ctx.params;
  const achada = await sessaoDaRequisicao(req, slug, requestId);
  if ("resposta" in achada) return achada.resposta;
  const { sessao } = achada;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: sessao.organization_id, request_id: requestId, status: 422 });
    return fail("validation_failed", "client_message_id (uuid) e body são obrigatórios", 422, { requestId });
  }
  const resultado = await receberMensagemDoVisitante(sessao, corpo.data, { requestId });
  if (!resultado.ok) {
    const status = STATUS_POR_MOTIVO[resultado.reason] ?? 400;
    registrarRequisicaoDe(req, { outcome: status === 429 ? "rate_limited" : "rejected", organization_id: sessao.organization_id, request_id: requestId, status });
    return fail(status === 429 ? "rate_limited" : status === 409 ? "state_conflict" : "validation_failed", resultado.reason, status, { requestId });
  }
  registrarRequisicaoDe(req, { outcome: "accepted", organization_id: sessao.organization_id, request_id: requestId, status: 202 });
  return ok({ status: resultado.entrada.status }, { requestId, status: 202 });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { slug } = await ctx.params;
  const achada = await sessaoDaRequisicao(req, slug, requestId);
  if ("resposta" in achada) return achada.resposta;
  const { sessao } = achada;
  const consulta = consultaSchema.safeParse({ after: req.nextUrl.searchParams.get("after") ?? undefined });
  if (!consulta.success) {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: sessao.organization_id, request_id: requestId, status: 422 });
    return fail("validation_failed", "after inválido", 422, { requestId });
  }
  const [mensagens, estado] = await Promise.all([
    listarMensagensDoVisitante(sessao, consulta.data.after ?? null),
    estadoDaConversaDoVisitante(sessao),
  ]);
  // A IA responde 24 h; a pessoa, na janela (D55 d): a página avisa quem atende agora.
  const humano = janelaDoHumano(new Date(), estado.timezone);
  registrarRequisicaoDe(req, { outcome: "allowed", organization_id: sessao.organization_id, request_id: requestId, status: 200 });
  return ok(
    {
      identified: sessao.identified_at !== null,
      messages: mensagens,
      waiting_human: estado.waiting_human,
      human_available: humano.human_available,
      next_human_at: humano.next_human_at,
      window: humano.window,
    },
    { requestId },
  );
}
