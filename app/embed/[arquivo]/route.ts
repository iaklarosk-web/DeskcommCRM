/**
 * GET /embed/<slug>.js — o script de UMA linha que o cliente põe no site dele
 * (F14, ADR-038 §2 T02; decisão do proprietário: página hospedada + embed).
 *
 * O script desenha um balão fixo e, ao clique, abre `/chat/<slug>` num iframe
 * do domínio do SaaS. Isolamento por desenho: nada do site do cliente entra no
 * chat e nada do chat toca o CSS do site — só o balão e a moldura. A origem do
 * iframe é a deste servidor (`request.nextUrl.origin`), então o script vale
 * para o domínio em que foi servido.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { registrarRequisicaoDe } from "@/src/obs/log";
import { organizacaoPorSlug } from "@/src/webchat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function scriptDeEmbed(origem: string, slug: string): string {
  const url = `${origem}/chat/${slug}`;
  return `(function(){if(window.__crmWebchat)return;window.__crmWebchat=true;
var d=document,b=d.createElement('button'),f=null;
b.setAttribute('aria-label','Chat');b.textContent='\\u{1F4AC}';
b.style.cssText='position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:28px;border:0;background:#1f6feb;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000';
function abrir(){if(!f){f=d.createElement('iframe');f.src=${JSON.stringify(url)};f.title='Chat';
f.style.cssText='position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);background:#fff;z-index:2147483000';
d.body.appendChild(f);}else{f.style.display=f.style.display==='none'?'':'none';}}
b.addEventListener('click',abrir);d.body.appendChild(b);})();`;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ arquivo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { arquivo } = await ctx.params;
  const casou = /^([a-z0-9][a-z0-9-]{1,62})\.js$/.exec(arquivo);
  const org = casou ? await organizacaoPorSlug(casou[1]!) : null;
  if (casou === null || org === null) {
    registrarRequisicaoDe(req, { outcome: "rejected", organization_id: null, scope: "unresolved", request_id: requestId, status: 404 });
    return new Response("// not found", { status: 404, headers: { "content-type": "text/javascript; charset=utf-8" } });
  }
  registrarRequisicaoDe(req, { outcome: "allowed", organization_id: org.organization_id, request_id: requestId, status: 200 });
  return new Response(scriptDeEmbed(req.nextUrl.origin, casou[1]!), {
    status: 200,
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-request-id": requestId },
  });
}
