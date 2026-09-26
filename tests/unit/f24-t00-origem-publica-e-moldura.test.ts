/**
 * F24-T00 (Suporte KN, 25/09/2026) — defeito 0a do teste visual: o script
 * `GET /embed/<slug>.js` montava o iframe com `request.nextUrl.origin`, que
 * atrás do proxy é a origem INTERNA do Next (`https://0.0.0.0:3000`). Em
 * qualquer site externo o balão aparecia e o clique abria um iframe que não
 * carregava.
 *
 * O que este arquivo congela:
 *  1. `origemPublica()` prefere o que o proxy encaminhou (`x-forwarded-proto`
 *     + `x-forwarded-host`), depois o `Host`, depois `NEXT_PUBLIC_APP_URL`, e
 *     só por último a origem interna — e recusa host malformado;
 *  2. o script servido atrás de um proxy simulado aponta para a origem pública;
 *  3. `/chat/<slug>` e `/embed/<slug>.js` ficam FORA do `X-Frame-Options: DENY`
 *     global (que era emitido junto de `frame-ancestors *` — a página dependia
 *     da precedência do CSP para ser embutida);
 *  4. o caminho novo do cockpit (`/api/admin/handoffs`) é público sem carona.
 */
import { NextRequest } from "next/server";
import { checkCustomRoutes } from "next/dist/lib/load-custom-routes";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

const envFalso = vi.hoisted(() => ({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }));
vi.mock("@/lib/env", () => ({ env: envFalso }));
vi.mock("@/src/obs/log", () => ({ registrarRequisicaoDe: () => {}, registrarRequisicao: () => {} }));
vi.mock("@/src/webchat", () => ({
  organizacaoPorSlug: async (slug: string) => (slug === "suporte-crm-os" ? { organization_id: "org-1" } : null),
}));

import { GET as embedGET } from "@/app/embed/[arquivo]/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import { CABECALHOS_DE_SEGURANCA } from "@/lib/http/cabecalhos-de-seguranca";
import { origemPublica } from "@/src/http/origem-publica";

function requisicao(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

const INTERNA = "http://0.0.0.0:3000/embed/suporte-crm-os.js";
const PROXY = { "x-forwarded-proto": "https", "x-forwarded-host": "crm.kntecnologia.app", host: "crm.kntecnologia.app" };

describe("F24-T00 — origemPublica: a origem que o navegador usou, nunca a interna", () => {
  it("atrás do proxy, vale x-forwarded-proto + x-forwarded-host", () => {
    expect(origemPublica(requisicao(INTERNA, PROXY), { padrao: "http://localhost:3000" })).toBe("https://crm.kntecnologia.app");
  });

  it("lista encaminhada por dois saltos: vale o primeiro valor de cada cabeçalho", () => {
    const req = requisicao(INTERNA, { "x-forwarded-proto": "https, http", "x-forwarded-host": "crm.kntecnologia.app, interno:3000" });
    expect(origemPublica(req, { padrao: "" })).toBe("https://crm.kntecnologia.app");
  });

  it("host encaminhado malformado é ignorado — cai no Host, depois no padrão", () => {
    const req = requisicao(INTERNA, { "x-forwarded-proto": "https", "x-forwarded-host": "evil.test/<script>" , host: "0.0.0.0:3000" });
    expect(origemPublica(req, { padrao: "https://crm.exemplo.test" })).toBe("https://crm.exemplo.test");
  });

  it("sem proxy: o Host da requisição, com o esquema encaminhado ou o da URL", () => {
    expect(origemPublica(requisicao("http://127.0.0.1:3000/x", { host: "127.0.0.1:3000" }), { padrao: "https://crm.exemplo.test" })).toBe("http://127.0.0.1:3000");
    expect(origemPublica(requisicao("http://127.0.0.1:3000/x", { host: "crm.exemplo.test", "x-forwarded-proto": "https" }), { padrao: "" })).toBe("https://crm.exemplo.test");
  });

  it("Host de escuta (0.0.0.0, [::]) não é origem: vale NEXT_PUBLIC_APP_URL, e só por último a URL interna", () => {
    expect(origemPublica(requisicao(INTERNA, { host: "0.0.0.0:3000" }), { padrao: "https://crm.exemplo.test" })).toBe("https://crm.exemplo.test");
    expect(origemPublica(requisicao(INTERNA, { host: "[::]:3000" }), { padrao: "" })).toBe("http://0.0.0.0:3000");
    expect(origemPublica(requisicao(INTERNA), { padrao: "isto não é url" })).toBe("http://0.0.0.0:3000");
  });
});

describe("F24-T00 — o script de embed servido atrás do proxy", () => {
  it("aponta o iframe para a origem pública, nunca para 0.0.0.0", async () => {
    const res = await embedGET(requisicao(INTERNA, PROXY), { params: Promise.resolve({ arquivo: "suporte-crm-os.js" }) });
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain("https://crm.kntecnologia.app/chat/suporte-crm-os");
    expect(js).not.toContain("0.0.0.0");
  });

  it("sem cabeçalho do proxy e com Host de escuta, usa NEXT_PUBLIC_APP_URL", async () => {
    envFalso.NEXT_PUBLIC_APP_URL = "https://crm.exemplo.test";
    const res = await embedGET(requisicao(INTERNA, { host: "0.0.0.0:3000" }), { params: Promise.resolve({ arquivo: "suporte-crm-os.js" }) });
    expect(await res.text()).toContain("https://crm.exemplo.test/chat/suporte-crm-os");
    envFalso.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  it("slug desconhecido continua 404 em javascript", async () => {
    const res = await embedGET(requisicao("http://0.0.0.0:3000/embed/nao-existe.js", PROXY), { params: Promise.resolve({ arquivo: "nao-existe.js" }) });
    expect(res.status).toBe(404);
  });
});

describe("F24-T00 — X-Frame-Options: DENY não alcança a página do chat nem o script", () => {
  function cabecalhosPara(caminho: string): Record<string, string> {
    const saida: Record<string, string> = {};
    for (const regra of CABECALHOS_DE_SEGURANCA) {
      if (!getPathMatch(regra.source)(caminho)) continue;
      for (const h of regra.headers) saida[h.key.toLowerCase()] = h.value;
    }
    return saida;
  }

  it("as regras são aceitas pelo validador de rotas do próprio Next", () => {
    expect(() => checkCustomRoutes([...CABECALHOS_DE_SEGURANCA], "header")).not.toThrow();
  });

  it("o produto continua sem moldura; o chat e o embed ficam de fora do DENY", () => {
    expect(cabecalhosPara("/app/inbox")["x-frame-options"]).toBe("DENY");
    expect(cabecalhosPara("/login")["x-frame-options"]).toBe("DENY");
    expect(cabecalhosPara("/")["x-frame-options"]).toBe("DENY");
    expect(cabecalhosPara("/chat/suporte-crm-os")["x-frame-options"]).toBeUndefined();
    expect(cabecalhosPara("/embed/suporte-crm-os.js")["x-frame-options"]).toBeUndefined();
  });

  it("os outros cabeçalhos de segurança continuam em TODA rota, chat incluído", () => {
    for (const caminho of ["/app/inbox", "/chat/suporte-crm-os", "/embed/x.js"]) {
      const h = cabecalhosPara(caminho);
      expect(h["x-content-type-options"], caminho).toBe("nosniff");
      expect(h["referrer-policy"], caminho).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], caminho).toContain("camera=()");
    }
  });
});

describe("F24-T05 — o caminho do cockpit para casos em espera é público, sem carona", () => {
  it("/api/admin/handoffs é público; sub-path e variações não", () => {
    expect(isPublicPath("/api/admin/handoffs")).toBe(true);
    expect(isPublicPath("/api/admin/handoffs/1")).toBe(false);
    expect(isPublicPath("/api/admin/handoffsx")).toBe(false);
    expect(isPublicPath("/api/admin/summary")).toBe(true);
  });
});
