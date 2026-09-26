/**
 * F24-T01 (Suporte KN, 25/09/2026) — o texto da fila com prazo de retorno,
 * por organização. Decisão do fundador: no suporte dentro dos sistemas da KN,
 * quem cai na fila humana lê "Recebemos sua pergunta. A KN responde por
 * {contato} em até 1 dia útil", e não "Sua conversa está na fila para um
 * atendente". O padrão NÃO muda (Deka continua lendo a frase antiga).
 *
 * Configurações novas: `webchat.handoff_mode` (`atendente` | `retorno`) e
 * `webchat.return_deadline_text` (texto livre, padrão "1 dia útil").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { entradaDoSchema } from "@/src/tenant-config/schema";
import { htmlDaPagina } from "@/src/webchat/pagina/html";
import { TEXTOS_DA_PAGINA } from "@/src/webchat/pagina/textos";
import { abrirPagina, avisos, dublarRede, respostaPadrao } from "@/tests/lib/pagina-do-visitante";

describe("F24-T01 — as duas configurações novas nascem na lista única", () => {
  it("webchat.handoff_mode: enum, padrão `atendente` (Deka não muda)", () => {
    const entrada = entradaDoSchema("webchat.handoff_mode");
    expect(entrada?.tipo).toBe("enum");
    expect(entrada?.default).toBe("atendente");
    expect([...(entrada?.valores ?? [])].sort()).toEqual(["atendente", "retorno"]);
  });

  it("webchat.return_deadline_text: texto, padrão `1 dia útil` (decisão do fundador)", () => {
    const entrada = entradaDoSchema("webchat.return_deadline_text");
    expect(entrada?.tipo).toBe("string");
    expect(entrada?.default).toBe("1 dia útil");
  });
});

describe("F24-T01 — o texto de retorno existe nos dois idiomas, com os três campos", () => {
  it.each(["pt-BR", "es"] as const)("%s", (idioma) => {
    const texto = TEXTOS_DA_PAGINA[idioma].retornoCombinado ?? "";
    for (const campo of ["{empresa}", "{contato}", "{prazo}"]) expect(texto, campo).toContain(campo);
  });
});

describe("F24-T01 — a página do visitante mostra a frase certa quando a conversa espera uma pessoa", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const base = { slug: "suporte-crm-os", nomeDaOrganizacao: "KN Tecnologia", idioma: "pt-BR" as const };

  it("modo `retorno`: empresa, contato informado na identificação e prazo configurado", async () => {
    dublarRede((c) => respostaPadrao(c, { waiting_human: true, visitor_contact: "ana@exemplo.test" }));
    abrirPagina(htmlDaPagina({ ...base, fila: { modo: "retorno", prazo: "1 dia útil" } }));

    await vi.waitFor(() => expect(avisos("fila")).toHaveLength(1));
    expect(avisos("fila")[0]).toBe("Recebemos sua pergunta. KN Tecnologia responde por ana@exemplo.test em até 1 dia útil.");
  });

  it("modo `retorno` sem contato na resposta: a frase não fica com buraco", async () => {
    dublarRede((c) => respostaPadrao(c, { waiting_human: true, visitor_contact: null }));
    abrirPagina(htmlDaPagina({ ...base, fila: { modo: "retorno", prazo: "2 horas" } }));

    await vi.waitFor(() => expect(avisos("fila")).toHaveLength(1));
    expect(avisos("fila")[0]).not.toContain("{contato}");
    expect(avisos("fila")[0]).toContain("em até 2 horas");
  });

  it("modo `atendente` (padrão): a frase antiga, sem mudança", async () => {
    dublarRede((c) => respostaPadrao(c, { waiting_human: true }));
    abrirPagina(htmlDaPagina(base));

    await vi.waitFor(() => expect(avisos("fila")).toHaveLength(1));
    expect(avisos("fila")[0]).toBe(TEXTOS_DA_PAGINA["pt-BR"].aguardandoHumano);
  });

  it("o nome da organização entra escapado também na frase de retorno (é HTML servido)", () => {
    const html = htmlDaPagina({ ...base, nomeDaOrganizacao: "Loja <X> & Cia", fila: { modo: "retorno", prazo: "1 dia útil" } });
    expect(html).not.toContain("<X>");
    expect(html).not.toContain("</script><script>");
  });
});
