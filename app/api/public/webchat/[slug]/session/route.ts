/**
 * POST /api/public/webchat/[slug]/session — abre a sessão anônima do visitante
 * (F14, ADR-038 §2 T01). Sem login: a organização vem do slug; o chat tem de
 * estar ligado (`webchat.enabled`, D55 c); os freios por IP/organização valem
 * aqui (§6 objeção 2). Devolve o token UMA vez — só o hash fica no banco.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { registrarRequisicaoDe } from "@/src/obs/log";
import { criarSessao } from "@/src/webchat";

import { ipDoVisitante, slugValido, STATUS_POR_MOTIVO } from "../_comum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({
  page_url: z.string().url().max(2048).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { slug } = await ctx.params;
  if (!slugValido(slug)) {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status: 404 });
    return fail("not_found", "organização desconhecida", 404, { requestId });
  }
  let corpo: z.infer<typeof corpoSchema> = {};
  try {
    const bruto = await req.text();
    corpo = bruto.length === 0 ? {} : corpoSchema.parse(JSON.parse(bruto));
  } catch {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status: 422 });
    return fail("validation_failed", "corpo inválido", 422, { requestId });
  }
  const resultado = await criarSessao({
    slug,
    ip: ipDoVisitante(req),
    user_agent: req.headers.get("user-agent"),
    page_url: corpo.page_url ?? null,
  });
  if (!resultado.ok) {
    const status = STATUS_POR_MOTIVO[resultado.reason] ?? 400;
    registrarRequisicaoDe(req, { outcome: status === 429 ? "rate_limited" : "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status });
    return fail(status === 429 ? "rate_limited" : "not_found", resultado.reason, status, { requestId });
  }
  registrarRequisicaoDe(req, { outcome: "accepted", organization_id: resultado.sessao.organization_id, request_id: requestId, status: 201 });
  return ok({ token: resultado.token, session_id: resultado.sessao.id, identified: false }, { requestId, status: 201 });
}
