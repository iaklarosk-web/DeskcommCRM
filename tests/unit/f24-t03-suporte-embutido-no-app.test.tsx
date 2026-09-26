/**
 * F24-T03 (Suporte KN, 25/09/2026) — o chat de suporte embutido na área
 * logada do PRÓPRIO CRM-OS (`/app`), apontando para a organização de suporte
 * (`suporte-crm-os`), só quando `SUPPORT_WEBCHAT_SLUG` está definida. Sem a
 * variável, nada muda — nenhum script, nenhum balão.
 *
 * Usa o contrato da T02: nome e e-mail de quem está logado vão em
 * `window.__crmWebchatPrefill` antes de o script entrar no documento.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SuporteEmbutido } from "@/app/app/_components/SuporteEmbutido";
import { slugDoSuporte } from "@/lib/suporte/slug-do-suporte";

declare global {
  interface Window {
    __crmWebchat?: boolean;
    __crmWebchatPrefill?: { name?: unknown; contact?: unknown };
  }
}

describe("F24-T03 — slugDoSuporte: só um slug válido liga o embed", () => {
  it("vazio, indefinido e lixo dão null; slug válido passa aparado", () => {
    expect(slugDoSuporte("")).toBeNull();
    expect(slugDoSuporte(undefined)).toBeNull();
    expect(slugDoSuporte("Suporte CRM!")).toBeNull();
    expect(slugDoSuporte("a")).toBeNull();
    expect(slugDoSuporte(" suporte-crm-os ")).toBe("suporte-crm-os");
  });
});

describe("F24-T03 — SuporteEmbutido monta o script com o prefill de quem está logado", () => {
  beforeEach(() => {
    delete window.__crmWebchat;
    delete window.__crmWebchatPrefill;
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("insere UM script /embed/<slug>.js e define name/contact antes dele", () => {
    render(<SuporteEmbutido slug="suporte-crm-os" nome="Ana Lima" contato="ana@kn.test" />);
    const scripts = document.querySelectorAll('script[src="/embed/suporte-crm-os.js"]');
    expect(scripts).toHaveLength(1);
    expect(window.__crmWebchatPrefill).toEqual({ name: "Ana Lima", contact: "ana@kn.test" });
  });

  it("sem nome, só o contato vai no prefill (o campo de nome fica para a pessoa)", () => {
    render(<SuporteEmbutido slug="suporte-crm-os" nome={null} contato="ana@kn.test" />);
    expect(window.__crmWebchatPrefill).toEqual({ contact: "ana@kn.test" });
  });

  it("ao desmontar (logout), o script, o balão e a janela saem do documento e a guarda é zerada", () => {
    const { unmount } = render(<SuporteEmbutido slug="suporte-crm-os" nome="Ana" contato="ana@kn.test" />);
    // Simula o que o script faz ao rodar.
    window.__crmWebchat = true;
    const balao = document.createElement("button");
    balao.id = "crm-webchat-balao";
    const janela = document.createElement("iframe");
    janela.id = "crm-webchat-janela";
    document.body.append(balao, janela);

    unmount();

    expect(document.querySelector('script[src="/embed/suporte-crm-os.js"]')).toBeNull();
    expect(document.getElementById("crm-webchat-balao")).toBeNull();
    expect(document.getElementById("crm-webchat-janela")).toBeNull();
    expect(window.__crmWebchat).toBeUndefined();
  });
});

describe("F24-T03 — a casca do /app só liga o suporte pela variável de ambiente", () => {
  it("o layout lê SUPPORT_WEBCHAT_SLUG por slugDoSuporte e a variável está no contrato do operador", () => {
    const raiz = join(__dirname, "..", "..");
    const layout = readFileSync(join(raiz, "app/app/layout.tsx"), "utf8");
    expect(layout).toContain("slugDoSuporte(env.SUPPORT_WEBCHAT_SLUG)");
    expect(layout).toContain("<SuporteEmbutido");
    // A função chamada pelo SERVIDOR vem de módulo neutro, nunca do componente cliente.
    expect(layout).toContain('from "@/lib/suporte/slug-do-suporte"');
    expect(readFileSync(join(raiz, "lib/suporte/slug-do-suporte.ts"), "utf8")).not.toMatch(/^\s*["']use client["']/m);
    expect(readFileSync(join(raiz, "app/app/_components/SuporteEmbutido.tsx"), "utf8")).not.toMatch(/export function slugDoSuporte/);
    const envTs = readFileSync(join(raiz, "lib/env.ts"), "utf8");
    expect(envTs).toMatch(/^\s{2}SUPPORT_WEBCHAT_SLUG:/m);
    const exemplo = readFileSync(join(raiz, ".env.example"), "utf8");
    expect(exemplo).toMatch(/^SUPPORT_WEBCHAT_SLUG=$/m);
  });
});
