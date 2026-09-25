/**
 * F14-T01 — os três freios do endpoint público (ADR-038 §2 T01; §6 objeção 2),
 * sem banco: a decisão é pura e os números são os declarados em
 * `LIMITES_DO_WEBCHAT`. Alvo do mutante 75: "freio por ip bate".
 */
import { describe, expect, it } from "vitest";

import { decidirFreio, LIMITES_DO_WEBCHAT } from "@/src/webchat";

const zero = { sessoes_do_ip_na_hora: 0, mensagens_do_ip_na_hora: 0, mensagens_da_organizacao_na_hora: 0 };

describe("F14-T01 — freios do chat do site", () => {
  // Título curto DE PROPÓSITO: alvo do mutante 75 (`-t` exato).
  it("freio por ip bate", () => {
    // A primeira asserção nomeia o invariante: o mutante 75 tem de derrubá-la.
    expect(
      decidirFreio({ ...zero, sessoes_do_ip_na_hora: LIMITES_DO_WEBCHAT.sessoes_por_ip_hora }),
      "30 sessões na hora do mesmo IP passaram",
    ).toBe("ip_sessions");
    expect(decidirFreio({ ...zero, mensagens_do_ip_na_hora: LIMITES_DO_WEBCHAT.mensagens_por_ip_hora })).toBe("ip_messages");
    expect(decidirFreio({ ...zero, sessoes_do_ip_na_hora: LIMITES_DO_WEBCHAT.sessoes_por_ip_hora - 1 })).toBeNull();
    console.info("f14-t01-freios: ip_sessions=1/1 ip_messages=1/1 below_limit_pass=1/1");
  });

  it("freio por organização bate; a ordem é IP antes de organização; os números são os declarados", () => {
    expect(decidirFreio({ ...zero, mensagens_da_organizacao_na_hora: LIMITES_DO_WEBCHAT.mensagens_por_organizacao_hora })).toBe("org_messages");
    expect(decidirFreio({ sessoes_do_ip_na_hora: 99, mensagens_do_ip_na_hora: 99, mensagens_da_organizacao_na_hora: 9999 })).toBe("ip_sessions");
    expect(LIMITES_DO_WEBCHAT).toEqual({ sessoes_por_ip_hora: 30, mensagens_por_ip_hora: 60, mensagens_por_organizacao_hora: 600 });
  });
});
