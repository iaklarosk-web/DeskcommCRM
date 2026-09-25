/**
 * F24-T02 (Suporte KN, 25/09/2026) — pré-preenchimento da identificação.
 *
 * Contrato: o site define `window.__crmWebchatPrefill = { name, contact }`
 * ANTES do script; o script `/embed/<slug>.js` passa os dois como parâmetros
 * URL-encoded para `/chat/<slug>`; a página pré-preenche os dois campos, que
 * continuam editáveis e continuam exigindo o envio. Validação é a mesma do
 * `/identify` (nome 2..120, contato 5..200). A identidade continua DECLARADA,
 * não autenticada: quem digita o e-mail de outra pessoa é tratado como ela.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ajustes = vi.hoisted(() => ({ ligado: true as unknown, origens: [] as unknown }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));
vi.mock("@/src/obs/log", () => ({ registrarRequisicaoDe: () => {}, registrarRequisicao: () => {} }));
vi.mock("@/src/webchat", () => ({
  organizacaoPorSlug: async (slug: string) => (slug === "suporte-crm-os" ? { organization_id: "org-1" } : null),
}));
vi.mock("@/src/tenant-config/settings", () => ({
  getSetting: async (_ctx: unknown, key: string) => {
    if (key === "webchat.enabled") return ajustes.ligado;
    if (key === "webchat.allowed_origins") return ajustes.origens;
    if (key === "webchat.handoff_mode") return "atendente";
    if (key === "webchat.return_deadline_text") return "1 dia útil";
    return null;
  },
}));
vi.mock("@/src/tenant-context/db", () => ({
  getServicePool: async () => ({ query: async () => ({ rows: [{ display_name: "KN Tecnologia", legal_name: "KN Tecnologia LTDA" }] }) }),
}));

import { GET as chatGET, preenchimentoDaConsulta } from "@/app/chat/[slug]/route";
import { scriptDeEmbed } from "@/app/embed/[arquivo]/route";
import { htmlDaPagina } from "@/src/webchat/pagina/html";

declare global {
  interface Window {
    __crmWebchat?: boolean;
    __crmWebchatPrefill?: { name?: unknown; contact?: unknown };
  }
}

describe("F24-T02 — o script de embed passa nome e contato do site para a página", () => {
  beforeEach(() => {
    delete window.__crmWebchat;
    delete window.__crmWebchatPrefill;
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function abrirBalao(): HTMLIFrameElement {
    new Function(scriptDeEmbed("https://crm.exemplo.test", "suporte-crm-os"))();
    const balao = document.getElementById("crm-webchat-balao");
    if (balao === null) throw new Error("balão não montado");
    balao.click();
    const janela = document.getElementById("crm-webchat-janela");
    if (!(janela instanceof HTMLIFrameElement)) throw new Error("iframe não montado");
    return janela;
  }

  it("com __crmWebchatPrefill, o iframe abre /chat/<slug>?name=…&contact=… codificados", () => {
    window.__crmWebchatPrefill = { name: "Ana & Cia <b>", contact: "ana+kn@exemplo.test" };
    const janela = abrirBalao();
    const url = new URL(janela.src);
    expect(url.origin + url.pathname).toBe("https://crm.exemplo.test/chat/suporte-crm-os");
    expect(url.searchParams.get("name")).toBe("Ana & Cia <b>");
    expect(url.searchParams.get("contact")).toBe("ana+kn@exemplo.test");
  });

  it("sem prefill, a URL é a de sempre — nada muda para quem não usa o contrato", () => {
    const janela = abrirBalao();
    expect(janela.src).toBe("https://crm.exemplo.test/chat/suporte-crm-os");
  });

  it("prefill com tipo errado é ignorado, não quebra o balão", () => {
    window.__crmWebchatPrefill = { name: 42, contact: null };
    const janela = abrirBalao();
    expect(janela.src).toBe("https://crm.exemplo.test/chat/suporte-crm-os");
  });
});

describe("F24-T02 — a página valida como o /identify valida, e pré-preenche sem prender", () => {
  it("preenchimentoDaConsulta: aparados, nos limites; fora deles, ausentes", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(preenchimentoDaConsulta(q("name=%20Ana%20&contact=ana%40x.test"))).toEqual({ name: "Ana", contact: "ana@x.test" });
    expect(preenchimentoDaConsulta(q("name=A&contact=abc"))).toEqual({});
    expect(preenchimentoDaConsulta(q(`name=${"x".repeat(121)}&contact=${"y".repeat(201)}`))).toEqual({});
    expect(preenchimentoDaConsulta(q("contact=%2B5511999990000"))).toEqual({ contact: "+5511999990000" });
    expect(preenchimentoDaConsulta(q(""))).toEqual({});
  });

  it("o HTML leva os valores escapados e mantém os campos obrigatórios e editáveis", () => {
    const html = htmlDaPagina({ slug: "s", nomeDaOrganizacao: "KN", idioma: "pt-BR", preenchimento: { name: 'Ana "A" <b>', contact: "ana@x.test" } });
    expect(html).toContain('value="Ana &quot;A&quot; &lt;b&gt;"');
    expect(html).toContain('value="ana@x.test"');
    expect(html).not.toContain("<b>");
    expect(html).toMatch(/<input name="name"[^>]*required[^>]*data-nome>/);
    expect(html).toMatch(/<input name="contact"[^>]*required[^>]*data-contato>/);
    expect(html).not.toMatch(/<input name="name"[^>]*readonly/);
  });

  it("sem preenchimento, nenhum atributo value nasce", () => {
    const html = htmlDaPagina({ slug: "s", nomeDaOrganizacao: "KN", idioma: "pt-BR" });
    expect(html).not.toMatch(/<input name="name"[^>]*value=/);
    expect(html).not.toMatch(/<input name="contact"[^>]*value=/);
  });

  it("GET /chat/<slug>?name&contact devolve a página pré-preenchida", async () => {
    const req = new NextRequest("http://0.0.0.0:3000/chat/suporte-crm-os?name=Ana&contact=ana%40kn.test");
    const res = await chatGET(req, { params: Promise.resolve({ slug: "suporte-crm-os" }) });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="Ana"');
    expect(html).toContain('value="ana@kn.test"');
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
  });

  it("GET /chat/<slug> com nome inválido ignora o parâmetro e serve a página normal", async () => {
    const req = new NextRequest("http://0.0.0.0:3000/chat/suporte-crm-os?name=A&contact=x");
    const res = await chatGET(req, { params: Promise.resolve({ slug: "suporte-crm-os" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/<input name="name"[^>]*value=/);
  });
});
