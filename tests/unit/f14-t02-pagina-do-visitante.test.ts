/**
 * F14-T02 — a página do visitante e o script de embed (ADR-038 §2 T02), sem
 * banco: o HTML é autocontido, fala os dois idiomas do produto, não expõe nada
 * além do nome da organização; o `frame-ancestors` vem das origens configuradas
 * (vazio = qualquer site); o script aponta o iframe para `/chat/<slug>` da
 * origem que o serviu; os caminhos são públicos sem carona de sub-path.
 */
import { describe, expect, it } from "vitest";

import { frameAncestors } from "@/app/chat/[slug]/route";
import { scriptDeEmbed } from "@/app/embed/[arquivo]/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import { htmlDaPagina } from "@/src/webchat/pagina/html";
import { idiomaDaPagina, TEXTOS_DA_PAGINA } from "@/src/webchat/pagina/textos";

describe("F14-T02 — página do visitante", () => {
  it("o HTML é autocontido, sem token, com os ganchos que a spec e o script usam", () => {
    const html = htmlDaPagina({ slug: "loja-x", nomeDaOrganizacao: "Loja <X> & Cia", idioma: "pt-BR" });
    expect(html).toContain('data-slug="loja-x"');
    expect(html).toContain("Loja &lt;X&gt; &amp; Cia");
    for (const gancho of ["data-mensagens", "data-form-ident", "data-form-msg", "data-nome", "data-contato", "data-corpo", "data-enviar"]) {
      expect(html, `sem ${gancho}`).toContain(gancho);
    }
    expect(html).toContain("/api/public/webchat/");
    expect(html).not.toMatch(/x-webchat-token['"]?\s*:\s*['"][0-9a-f]{64}/);
    expect(html).toContain('name="robots" content="noindex"');
  });

  it("fala os dois idiomas do produto e escolhe pelo accept-language", () => {
    const chaves = Object.keys(TEXTOS_DA_PAGINA["pt-BR"]).sort();
    expect(Object.keys(TEXTOS_DA_PAGINA.es).sort()).toEqual(chaves);
    expect(htmlDaPagina({ slug: "a", nomeDaOrganizacao: "A", idioma: "es" })).toContain("Habla con nosotros");
    expect(idiomaDaPagina("es-AR,es;q=0.9")).toBe("es");
    expect(idiomaDaPagina("pt-BR")).toBe("pt-BR");
    expect(idiomaDaPagina(null)).toBe("pt-BR");
    console.info(`f14-t02-idiomas: textos=${chaves.length}/${chaves.length} idiomas=2/2`);
  });

  it("frame-ancestors: vazio = qualquer site; configurado = só as origens válidas", () => {
    expect(frameAncestors([])).toBe("frame-ancestors *");
    expect(frameAncestors(undefined)).toBe("frame-ancestors *");
    expect(frameAncestors(["https://www.loja.com.br", "javascript:alert(1)", "https://app.loja.com.br:8443"])).toBe(
      "frame-ancestors 'self' https://www.loja.com.br https://app.loja.com.br:8443",
    );
  });

  it("o script de embed aponta o iframe para /chat/<slug> da origem que o serviu e não roda duas vezes", () => {
    const js = scriptDeEmbed("https://crm.exemplo.test", "loja-x");
    expect(js).toContain('"https://crm.exemplo.test/chat/loja-x"');
    expect(js).toContain("window.__crmWebchat");
    expect(js).not.toContain("<script");
  });

  it("os caminhos públicos são só os três da API, a página e o script — sem carona", () => {
    expect(isPublicPath("/api/public/webchat/loja-x/session")).toBe(true);
    expect(isPublicPath("/api/public/webchat/loja-x/identify")).toBe(true);
    expect(isPublicPath("/api/public/webchat/loja-x/messages")).toBe(true);
    expect(isPublicPath("/api/public/webchat/loja-x/admin")).toBe(false);
    expect(isPublicPath("/chat/loja-x")).toBe(true);
    expect(isPublicPath("/chat/loja-x/extra")).toBe(false);
    expect(isPublicPath("/embed/loja-x.js")).toBe(true);
    expect(isPublicPath("/embed/loja-x.html")).toBe(false);
  });
});

describe("F14 — o chat do site não é dublado pelo WHATSAPP_MODE=mock", () => {
  it("em modo mock, waha vira mock e webchat continua webchat (não há transporte a dublar)", async () => {
    const { getSaasAdapter } = await import("@/src/channels");
    expect(getSaasAdapter("waha", { modo: "mock" }).provider).toBe("mock");
    expect(getSaasAdapter(undefined, { modo: "mock" }).provider).toBe("mock");
    expect(getSaasAdapter("webchat", { modo: "mock" }).provider).toBe("webchat");
    expect(getSaasAdapter("webchat", { modo: "real" }).provider).toBe("webchat");
    console.info("f14-adapter: mock_keeps_whatsapp=2/2 webchat_never_mocked=2/2");
  });
});
