/**
 * POST /api/public/webchat/[slug]/identify — nome + e-mail/telefone do
 * visitante ANTES da primeira resposta (F14, ADR-038 §2 T01, D55 c): vira
 * contato do CRM e abre a conversa `webchat`. Autoridade: o token da sessão.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { registrarRequisicaoDe } from "@/src/obs/log";
import { identificar } from "@/src/webchat";

import { sessaoDaRequisicao, STATUS_POR_MOTIVO } from "../_comum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(5).max(200),
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
    return fail("validation_failed", "nome e contato são obrigatórios", 422, { requestId });
  }
  const resultado = await identificar(sessao, corpo.data);
  if (!resultado.ok) {
    const status = STATUS_POR_MOTIVO[resultado.reason] ?? 400;
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: sessao.organization_id, request_id: requestId, status });
    return fail(status === 409 ? "state_conflict" : "validation_failed", resultado.reason, status, { requestId });
  }
  registrarRequisicaoDe(req, { outcome: "accepted", organization_id: sessao.organization_id, request_id: requestId, status: 200 });
  return ok({ identified: true, conversation_id: resultado.conversation_id, created_contact: resultado.created_contact }, { requestId });
}
