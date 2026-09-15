/**
 * F15-T04 — regras sobre o catálogo (ADR-036 §2 T04, D54 e), sem banco.
 *
 * O que se mede aqui: o vocabulário fechado (5 gatilhos, 4 ações, todas do
 * catálogo com executor `automation`), o validador que a rota usa (ação fora
 * do catálogo e configuração inválida recusadas com nome), e a chave
 * determinística do `create_task` por (regra, evento).
 *
 * Alvo do mutante 72 (validador aceita qualquer `actions[].type`): o caso
 * "ação fora do catálogo é recusada" abaixo.
 */
import { describe, expect, it } from "vitest";

import { findAction } from "@/src/actions/catalog";
import { ACOES_DE_REGRA, GATILHOS_DE_REGRA, regraForaDoVocabulario, uuidDeterministico, validarAcoesDeRegra } from "@/src/automation/regras";
import { EVENTOS_DA_F15 } from "@/src/events/emitir";

describe("F15-T04 — o vocabulário fechado", () => {
  it("5 gatilhos (os 3 emitidos pela F15 + 2 de lead) e 4 ações, todas do catálogo com executor automation", () => {
    expect([...GATILHOS_DE_REGRA].sort()).toEqual(["conversation.resolved", "lead.created", "lead.stage_changed", "order.confirmed", "task.overdue"]);
    for (const evento of EVENTOS_DA_F15) expect(GATILHOS_DE_REGRA as readonly string[]).toContain(evento);
    const doCatalogo = ACOES_DE_REGRA.map((nome) => findAction(nome)).filter((e) => e !== null && e.executors.includes("automation"));
    expect(doCatalogo).toHaveLength(ACOES_DE_REGRA.length);
    expect(ACOES_DE_REGRA).toHaveLength(4);
    console.info(`f15-t04-vocabulario: triggers=${GATILHOS_DE_REGRA.length}/5 actions=${doCatalogo.length}/4`);
  });
});

describe("F15-T04 — o validador de ações de regra", () => {
  // Título curto DE PROPÓSITO: é o alvo do mutante 72 (`-t` exato).
  it("ação fora do catálogo é recusada", () => {
    const foraDoCatalogo: unknown[] = [
      [{ type: "call_webhook", config: { url: "https://example.invalid" } }],
      [{ type: "send_whatsapp_message", config: { channel_session_id: "x", template: "oi" } }],
      [{ type: "add_tag", config: { tags: ["vip"] } }],
      [{ type: "drop_database", config: {} }],
      [{ type: "send_message", config: { body: "ok" } }, { type: "create_or_move_lead", config: {} }],
    ];
    const recusas = foraDoCatalogo.map((acoes) => validarAcoesDeRegra(acoes));
    // A primeira asserção nomeia o invariante: é o que o mutante 72 tem de derrubar.
    expect(recusas[0], "esperava recusa 'fora do catálogo' para call_webhook").toBe("ação 1 fora do catálogo: call_webhook");
    expect(recusas.every((r) => typeof r === "string" && /fora do catálogo/.test(r)), recusas.join(" | ")).toBe(true);
    expect(recusas[4]).toBe("ação 2 fora do catálogo: create_or_move_lead");
    console.info(`f15-t04-validador: outside_catalog_denied=${recusas.filter((r) => r !== null).length}/${foraDoCatalogo.length}`);
  });

  it("aceita as quatro do catálogo com configuração válida; recusa configuração inválida, lista vazia e gatilho fora do vocabulário", () => {
    expect(validarAcoesDeRegra([
      { type: "send_message", config: { body: "Olá" } },
      { type: "create_task", config: { title: "Ligar" } },
      { type: "transfer_to_human", config: { summary: "Cliente pediu" } },
      { type: "assign_owner", config: {} },
    ])).toBeNull();
    expect(validarAcoesDeRegra([{ type: "send_message", config: { body: "" } }])).toMatch(/configuração inválida/);
    expect(validarAcoesDeRegra([{ type: "create_task", config: { title: "x", due_in_hours: 0 } }])).toMatch(/configuração inválida/);
    expect(validarAcoesDeRegra([])).toMatch(/ao menos uma/);
    expect(regraForaDoVocabulario("message.received", [{ type: "send_message", config: { body: "x" } }])).toMatch(/gatilho fora do vocabulário/);
    expect(regraForaDoVocabulario("order.confirmed", [{ type: "send_message", config: { body: "x" } }])).toBeNull();
  });

  it("a chave do create_task é determinística por (regra, evento) e tem forma de uuid", () => {
    const a = uuidDeterministico("rule:r1:event:e1:create_task");
    const b = uuidDeterministico("rule:r1:event:e1:create_task");
    const c = uuidDeterministico("rule:r1:event:e2:create_task");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
