/**
 * F14-T01 — a decisão de abrir sessão do chat do site (ADR-038 §2 T01, D55 c),
 * sem banco. `webchat.enabled=false` (default declarado) recusa ANTES dos
 * freios; ligado, os freios decidem. Alvo do mutante 74: "desligado recusa sessão".
 */
import { describe, expect, it } from "vitest";

import { decidirAberturaDeSessao, LIMITES_DO_WEBCHAT } from "@/src/webchat";

const zero = { sessoes_do_ip_na_hora: 0, mensagens_do_ip_na_hora: 0, mensagens_da_organizacao_na_hora: 0 };

describe("F14-T01 — abrir sessão do chat do site", () => {
  // Título curto DE PROPÓSITO: alvo do mutante 74 (`-t` exato).
  it("desligado recusa sessão", () => {
    // A primeira asserção nomeia o invariante: o mutante 74 tem de derrubá-la.
    expect(decidirAberturaDeSessao({ ligado: false, contagens: zero }), "chat desligado abriu sessão").toBe("webchat_disabled");
    // Desligado recusa MESMO com os freios folgados — e antes deles.
    const cheio = { ...zero, sessoes_do_ip_na_hora: LIMITES_DO_WEBCHAT.sessoes_por_ip_hora };
    expect(decidirAberturaDeSessao({ ligado: false, contagens: cheio })).toBe("webchat_disabled");
    console.info("f14-t01-sessao: disabled_denied=2/2");
  });

  it("ligado e dentro dos freios abre; ligado e no freio recusa com o motivo do freio", () => {
    expect(decidirAberturaDeSessao({ ligado: true, contagens: zero })).toBeNull();
    expect(decidirAberturaDeSessao({ ligado: true, contagens: { ...zero, sessoes_do_ip_na_hora: 30 } })).toBe("ip_sessions");
    expect(decidirAberturaDeSessao({ ligado: true, contagens: { ...zero, mensagens_da_organizacao_na_hora: 600 } })).toBe("org_messages");
  });
});
