/**
 * F03-T01 — a máquina de estados D16 (DIRETRIZ §5.6, ADR-016).
 *
 * A prova mede A TABELA (`src/conversation/transitions.ts`), nunca números
 * escritos à mão: conta os estados e os eventos em tempo de teste, enumera
 * todos os pares e exige que cada um seja legal OU recusado por
 * `transition()`. Escrever "128" no arquivo invalidaria a prova — seria uma
 * asserção sobre o que se lembra, não sobre o que existe.
 *
 * Mede também os dois mapas com o ciclo herdado: totalidade nos dois sentidos
 * e engrossamento SOMENTE onde a ADR-016 o declarou.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { counterTotal, counterValue, resetCounters } from "@/src/obs/counters";
import {
  COARSENINGS,
  CONVERSATION_EVENTS,
  CONVERSATION_STATES,
  D16_TO_LEGACY,
  findTransition,
  IllegalTransition,
  isDeclaredCoarsening,
  LEGACY_STATUSES,
  LEGACY_TO_D16,
  transition,
  type ConversationState,
  type GuardResolver,
} from "@/src/conversation";
import type { TenantCtx } from "@/src/tenant-context";

const ORG_ID = "f0300001-0000-4000-8000-000000000001";
const CONVERSA_ID = "f0300001-1000-4000-8000-000000000001";
const CONTATO_ID = "f0300001-2000-4000-8000-000000000001";
const ATENDENTE_ID = "f0300001-3000-4000-8000-000000000001";

const ctx: TenantCtx = { organization_id: ORG_ID, source: "session", user_id: ATENDENTE_ID };

/**
 * Pool fake: devolve UMA conversa no estado pedido para o `select ... for no
 * key update` e nada para o resto. Nenhum Postgres é tocado.
 */
function fakePool(saasState: ConversationState) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes("from public.conversations") && text.includes("for no key update")) {
        return {
          rows: [
            {
              id: CONVERSA_ID,
              status: "open",
              saas_state: saasState,
              saas_state_entered_at: new Date("2026-09-10T09:00:00Z"),
              last_outbound_at: null,
              service_revision: "1",
              contact_id: CONTATO_ID,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return {
    pool: { connect: async () => client } as never,
    queries,
  };
}

/** Guarda que sempre responde o valor dado — a tabela nunca consulta banco. */
function guardaFixa(resposta: boolean): GuardResolver {
  return async () => resposta;
}

describe("F03-T01 — a tabela D16 é a única descrição da máquina", () => {
  beforeEach(() => {
    resetCounters();
  });

  it("todo par (estado, evento) ou é legal na tabela ou é recusado por transition()", async () => {
    // Arrange — os dois eixos saem da tabela, nunca de literais.
    const estados = CONVERSATION_STATES;
    const eventos = CONVERSATION_EVENTS;
    let validos = 0;
    let ilegaisRecusados = 0;

    // Act
    for (const from of estados) {
      for (const event of eventos) {
        const linha = findTransition(from, event);
        if (linha !== null) {
          expect(linha.from, `linha indexada no estado errado: ${from} ${event}`).toBe(from);
          expect(linha.event, `linha indexada no evento errado: ${from} ${event}`).toBe(event);
          expect(CONVERSATION_STATES, `destino fora do vocabulário: ${from} ${event}`).toContain(
            linha.to,
          );
          validos += 1;
          continue;
        }
        const { pool } = fakePool(from);
        await expect(
          transition(ctx, CONVERSA_ID, event, { kind: "system" }, { pool }),
          `par ilegal aceito: ${from} -${event}->`,
        ).rejects.toBeInstanceOf(IllegalTransition);
        ilegaisRecusados += 1;
      }
    }

    // Assert — a soma fecha o produto cartesiano, sem sobra nem falta.
    const pares = estados.length * eventos.length;
    expect(validos + ilegaisRecusados).toBe(pares);
    expect(counterTotal("conversation_illegal_transition")).toBe(ilegaisRecusados);
    console.log(
      `conversation-states: states=${estados.length} events=${eventos.length} ` +
        `pairs=${pares} valid=${validos} invalid_rejected=${ilegaisRecusados}`,
    );
  });

  it("recusa o ator fora do subset da linha e conta o motivo separado do par", async () => {
    // Arrange — `human.claimed` a partir de `open` é de atendente, não do sistema.
    const linha = findTransition("open", "human.claimed");
    expect(linha?.actor).not.toContain("system");
    const { pool } = fakePool("open");

    // Act
    const erro = await transition(
      ctx,
      CONVERSA_ID,
      "human.claimed",
      { kind: "system" },
      { pool },
    ).catch((e: unknown) => e);

    // Assert
    expect(erro).toBeInstanceOf(IllegalTransition);
    expect((erro as IllegalTransition).reason).toBe("actor");
    expect(
      counterValue("conversation_illegal_transition", {
        from: "open",
        event: "human.claimed",
        reason: "actor",
      }),
    ).toBe(1);
    expect(
      counterValue("conversation_illegal_transition", {
        from: "open",
        event: "human.claimed",
        reason: "pair",
      }),
    ).toBe(0);
  });

  it("recusa guarda falsa quando a linha não declara toWhenGuardFails", async () => {
    // Arrange — `human.return_to_ai` exige `ai_enabled` e não tem alternativa.
    const linha = findTransition("human_handling", "human.return_to_ai");
    expect(linha?.guard).toBe("ai_enabled");
    expect(linha?.toWhenGuardFails).toBeUndefined();
    const { pool } = fakePool("human_handling");

    // Act
    const erro = await transition(
      ctx,
      CONVERSA_ID,
      "human.return_to_ai",
      { kind: "attendant", userId: ATENDENTE_ID },
      { pool, guards: guardaFixa(false) },
    ).catch((e: unknown) => e);

    // Assert
    expect(erro).toBeInstanceOf(IllegalTransition);
    expect((erro as IllegalTransition).reason).toBe("guard");
    expect(
      counterValue("conversation_illegal_transition", {
        from: "human_handling",
        event: "human.return_to_ai",
        reason: "guard",
      }),
    ).toBe(1);
  });

  it("guarda verdadeira leva ao destino da linha e sinaliza a supressão da projeção", async () => {
    // Arrange
    const { pool, queries } = fakePool("waiting_customer");

    // Act
    const resultado = await transition(
      ctx,
      CONVERSA_ID,
      "system.inactivity",
      { kind: "job" },
      { pool, guards: guardaFixa(true) },
    );

    // Assert
    expect(resultado).toEqual({ from: "waiting_customer", to: "resolved" });
    const textos = queries.map((q) => q.text).join("\n");
    expect(textos).toContain("app.conversation_transition");
    expect(textos).toContain("fn_service_status");
    expect(textos).toContain("saas_state = $3");
    expect(counterTotal("conversation_illegal_transition")).toBe(0);
  });
});

describe("F03-T01 — os mapas com o ciclo herdado são totais e o engrossamento é declarado", () => {
  it("LEGACY_TO_D16 é total sobre os sete status legados", () => {
    // Arrange + Act
    const chaves = Object.keys(LEGACY_TO_D16).sort();

    // Assert
    expect(chaves).toEqual([...LEGACY_STATUSES].sort());
    for (const status of LEGACY_STATUSES) {
      expect(CONVERSATION_STATES, `destino fora do vocabulário D16: ${status}`).toContain(
        LEGACY_TO_D16[status],
      );
    }
    console.log(
      `conversation-states: legacy_statuses=${LEGACY_STATUSES.length} ` +
        `legacy_mapped=${chaves.length}/${LEGACY_STATUSES.length}`,
    );
  });

  it("D16_TO_LEGACY é total sobre os oito estados D16", () => {
    // Arrange + Act
    const chaves = Object.keys(D16_TO_LEGACY).sort();

    // Assert
    expect(chaves).toEqual([...CONVERSATION_STATES].sort());
    for (const estado of CONVERSATION_STATES) {
      expect(LEGACY_STATUSES, `status fora do CHECK herdado: ${estado}`).toContain(
        D16_TO_LEGACY[estado],
      );
    }
    console.log(
      `conversation-states: d16_states=${CONVERSATION_STATES.length} ` +
        `d16_mapped=${chaves.length}/${CONVERSATION_STATES.length}`,
    );
  });

  it("ida e volta é identidade fora dos engrossamentos declarados", () => {
    // Arrange
    const perdidos: Array<{ from: string; to: string }> = [];

    // Act — os dois sentidos, porque o engrossamento aparece nos dois.
    for (const estado of CONVERSATION_STATES) {
      const volta = LEGACY_TO_D16[D16_TO_LEGACY[estado]];
      if (volta !== estado) perdidos.push({ from: estado, to: volta });
    }
    for (const status of LEGACY_STATUSES) {
      const volta = D16_TO_LEGACY[LEGACY_TO_D16[status]];
      if (volta !== status) perdidos.push({ from: status, to: volta });
    }

    // Assert — nenhum engrossamento sem declaração, nenhuma declaração morta.
    for (const par of perdidos) {
      expect(
        isDeclaredCoarsening(par.from, par.to),
        `engrossamento não declarado: ${par.from} -> ${par.to}`,
      ).toBe(true);
    }
    for (const declarado of COARSENINGS) {
      expect(
        perdidos.some((par) => par.from === declarado.from && par.to === declarado.to),
        `engrossamento declarado que não acontece: ${declarado.from} -> ${declarado.to}`,
      ).toBe(true);
    }
    expect(perdidos).toHaveLength(COARSENINGS.length);
    console.log(
      `conversation-states: coarsenings_declared=${COARSENINGS.length} ` +
        `coarsenings_observed=${perdidos.length}/${COARSENINGS.length}`,
    );
  });
});
