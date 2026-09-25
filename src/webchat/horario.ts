/**
 * A janela do HUMANO no chat do site (F14, ADR-038 §2 T02; D55 d).
 *
 * A IA responde 24 h (capability `liveVisitor`); a pessoa segue a janela de
 * atendimento da organização — a mesma dos knobs do pacing (7h–22h no fuso da
 * organização, por padrão declarado). Fora dela, o handoff fica na fila e o
 * visitante recebe o aviso com a próxima abertura. Puro sobre `agora`; os
 * knobs vêm da sessão de canal `webchat` (ou do padrão), o fuso da organização.
 */
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import type { PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import { janelaDeEnvioAberta, proximaAberturaDaJanela } from "@/lib/agent-engine/pacing/engine";

export interface JanelaDoHumano {
  readonly human_available: boolean;
  /** ISO da próxima abertura, ou `null` quando aberta agora. */
  readonly next_human_at: string | null;
  readonly window: { readonly start_hour: number; readonly end_hour: number; readonly timezone: string };
}

export function janelaDoHumano(agora: Date, timezone: string, knobs: PacingKnobs = PACING_DEFAULTS): JanelaDoHumano {
  const efetivos: PacingKnobs = { ...knobs, timezone };
  const aberta = janelaDeEnvioAberta(agora, efetivos);
  return {
    human_available: aberta,
    // Sem jitter: o aviso ao visitante é a hora de abrir, não um adiamento anti-ban.
    next_human_at: aberta ? null : proximaAberturaDaJanela(agora, efetivos, () => 0).toISOString(),
    window: { start_hour: efetivos.windowStartHour, end_hour: efetivos.windowEndHour, timezone },
  };
}
