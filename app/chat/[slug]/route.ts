/**
 * GET /chat/[slug] — a página do visitante do chat do site (F14, ADR-038 §2 T02).
 *
 * Route Handler, não página React, por causa do cabeçalho: `frame-ancestors`
 * lista as origens que podem embutir o chat (`webchat.allowed_origins`; vazio
 * = qualquer origem, default declarado — ADR-038 §5). 404 quando a organização
 * não existe ou não ligou o chat: a página não revela nada.
 *
 * F24 (Suporte KN, 25/09/2026):
 *  - `?name=&contact=` pré-preenchem a identificação (contrato do script de
 *    embed, `window.__crmWebchatPrefill`). Validados pelos MESMOS limites do
 *    `/identify` (nome 2..120, contato 5..200); fora deles, ignorados. Os
 *    campos continuam editáveis e obrigatórios — identidade DECLARADA, não
 *    autenticada.
 *  - `webchat.handoff_mode` + `webchat.return_deadline_text` decidem o que o
 *    visitante lê quando a conversa espera uma pessoa (`src/webchat/pagina`).
 *  - O `X-Frame-Options: DENY` global NÃO alcança esta rota
 *    (`lib/http/cabecalhos-de-seguranca.ts`): quem decide a moldura é o CSP.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { registrarRequisicaoDe } from "@/src/obs/log";
import { getSetting } from "@/src/tenant-config/settings";
import { getServicePool } from "@/src/tenant-context/db";
import { organizacaoPorSlug } from "@/src/webchat";
import { htmlDaPagina, type ConfiguracaoDaFila, type Preenchimento } from "@/src/webchat/pagina/html";
import { idiomaDaPagina } from "@/src/webchat/pagina/textos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `frame-ancestors` a partir das origens configuradas; vazio = `*`. */
export function frameAncestors(origens: unknown): string {
  const lista = Array.isArray(origens) ? origens.filter((o): o is string => typeof o === "string" && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) : [];
  return lista.length === 0 ? "frame-ancestors *" : `frame-ancestors 'self' ${lista.join(" ")}`;
}

/** Os limites são os do `/identify` (`app/api/public/webchat/[slug]/identify`): fora deles, o campo fica em branco. */
export function preenchimentoDaConsulta(consulta: URLSearchParams): Preenchimento {
  const nome = consulta.get("name")?.trim() ?? "";
  const contato = consulta.get("contact")?.trim() ?? "";
  return {
    ...(nome.length >= 2 && nome.length <= 120 ? { name: nome } : {}),
    ...(contato.length >= 5 && contato.length <= 200 ? { contact: contato } : {}),
  };
}

function configuracaoDaFila(modo: unknown, prazo: unknown): ConfiguracaoDaFila {
  const texto = typeof prazo === "string" && prazo.trim().length > 0 ? prazo.trim() : "1 dia útil";
  return { modo: modo === "retorno" ? "retorno" : "atendente", prazo: texto };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { slug } = await ctx.params;
  const org = await organizacaoPorSlug(slug);
  const naoEncontrada = () => {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status: 404 });
    return new Response("Not found", { status: 404, headers: { "x-request-id": requestId } });
  };
  if (org === null) return naoEncontrada();
  const tenant = { organization_id: org.organization_id, source: "webhook" as const };
  const [ligado, origens, modoDaFila, prazoDeRetorno] = await Promise.all([
    getSetting(tenant, "webchat.enabled"),
    getSetting(tenant, "webchat.allowed_origins"),
    getSetting(tenant, "webchat.handoff_mode"),
    getSetting(tenant, "webchat.return_deadline_text"),
  ]);
  if (ligado !== true) return naoEncontrada();
  const pool = await getServicePool();
  const nome = await pool.query<{ display_name: string | null; legal_name: string | null }>(
    `select display_name, legal_name from public.organizations where id = $1`,
    [org.organization_id],
  );
  const idioma = idiomaDaPagina(req.nextUrl.searchParams.get("lang") ?? req.headers.get("accept-language"));
  const html = htmlDaPagina({
    slug,
    nomeDaOrganizacao: nome.rows[0]?.display_name ?? nome.rows[0]?.legal_name ?? slug,
    idioma,
    fila: configuracaoDaFila(modoDaFila, prazoDeRetorno),
    preenchimento: preenchimentoDaConsulta(req.nextUrl.searchParams),
  });
  registrarRequisicaoDe(req, { outcome: "allowed", organization_id: org.organization_id, request_id: requestId, status: 200 });
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `${frameAncestors(origens)}; default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:`,
      "x-request-id": requestId,
    },
  });
}
