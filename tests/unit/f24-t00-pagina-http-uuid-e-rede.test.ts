/**
 * F24-T00 (Suporte KN, 25/09/2026) — defeito 0b do teste visual: um iframe
 * https dentro de uma página http NÃO é contexto seguro (`isSecureContext`
 * = false, medido), e `crypto.randomUUID` só existe em contexto seguro. O
 * fallback antigo (`Date.now() + '-' + Math.random()`) não era UUID, o
 * servidor respondia 422 e o visitante lia "Não foi possível enviar".
 *
 * A página roda AQUI, no jsdom, com `crypto.randomUUID` ausente — como no
 * navegador do site http — e com a rede dublada. O que se prova:
 *  1. o id da mensagem é UUID v4 mesmo sem `randomUUID` (via `getRandomValues`),
 *     e mesmo sem `crypto` nenhum;
 *  2. rede que FALHA mostra o aviso de conexão; servidor que RECUSA mostra o
 *     aviso de recusa — são coisas diferentes e o visitante precisa saber qual.
 */
import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { htmlDaPagina } from "@/src/webchat/pagina/html";
import { TEXTOS_DA_PAGINA } from "@/src/webchat/pagina/textos";
import { abrirPagina, aguardarIdentificado, avisos, dublarRede, enviarMensagem, respostaPadrao, type ChamadaDeRede } from "@/tests/lib/pagina-do-visitante";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const html = htmlDaPagina({ slug: "suporte-crm-os", nomeDaOrganizacao: "KN Tecnologia", idioma: "pt-BR" });

function posts(chamadas: ChamadaDeRede[]): ChamadaDeRede[] {
  return chamadas.filter((c) => c.method === "POST" && c.url.endsWith("/messages"));
}

describe("F24-T00 — página do chat embutida em site http (contexto não seguro)", () => {
  beforeEach(() => {
    // Contexto não seguro: `getRandomValues` existe, `randomUUID` não.
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("sem crypto.randomUUID, o client_message_id ainda é UUID v4 — e muda a cada envio", async () => {
    const chamadas = dublarRede(respostaPadrao);
    abrirPagina(html);
    await aguardarIdentificado();

    enviarMensagem("primeira");
    await vi.waitFor(() => expect(posts(chamadas)).toHaveLength(1));
    enviarMensagem("segunda");
    await vi.waitFor(() => expect(posts(chamadas)).toHaveLength(2));

    const ids = posts(chamadas).map((c) => (c.body as { client_message_id: string }).client_message_id);
    for (const id of ids) expect(id, `não é UUID v4: ${id}`).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(2);
    expect(avisos("recusada")).toEqual([]);
    expect(avisos("sem-rede")).toEqual([]);
  });

  it("sem crypto NENHUM (navegador antigo), ainda é UUID v4", async () => {
    vi.stubGlobal("crypto", undefined);
    const chamadas = dublarRede(respostaPadrao);
    abrirPagina(html);
    await aguardarIdentificado();

    enviarMensagem("olá");
    await vi.waitFor(() => expect(posts(chamadas)).toHaveLength(1));
    expect((posts(chamadas)[0]!.body as { client_message_id: string }).client_message_id).toMatch(UUID_V4);
  });

  it("rede que falha: o visitante lê o aviso de CONEXÃO, e não 'não foi aceita'", async () => {
    const chamadas = dublarRede((c) => (c.method === "POST" && c.url.endsWith("/messages") ? new TypeError("Failed to fetch") : respostaPadrao(c)));
    abrirPagina(html);
    await aguardarIdentificado();

    enviarMensagem("olá");
    await vi.waitFor(() => expect(avisos("sem-rede")).toHaveLength(1));
    expect(avisos("sem-rede")[0]).toBe(TEXTOS_DA_PAGINA["pt-BR"].semRede);
    expect(avisos("recusada")).toEqual([]);
    expect(posts(chamadas)).toHaveLength(1);
  });

  it("servidor que recusa (422): o visitante lê o aviso de RECUSA, e não o de conexão", async () => {
    dublarRede((c) =>
      c.method === "POST" && c.url.endsWith("/messages")
        ? { status: 422, json: { error: { code: "validation_failed", message: "client_message_id (uuid) e body são obrigatórios" } } }
        : respostaPadrao(c),
    );
    abrirPagina(html);
    await aguardarIdentificado();

    enviarMensagem("olá");
    await vi.waitFor(() => expect(avisos("recusada")).toHaveLength(1));
    expect(avisos("recusada")[0]).toBe(TEXTOS_DA_PAGINA["pt-BR"].recusada);
    expect(avisos("sem-rede")).toEqual([]);
  });

  it("os dois avisos existem nos dois idiomas e são frases diferentes", () => {
    for (const idioma of ["pt-BR", "es"] as const) {
      const t = TEXTOS_DA_PAGINA[idioma];
      expect(t.semRede, idioma).toBeTruthy();
      expect(t.recusada, idioma).toBeTruthy();
      expect(t.semRede).not.toBe(t.recusada);
    }
  });
});
