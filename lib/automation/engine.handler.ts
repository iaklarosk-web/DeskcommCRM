import { createAdminClient } from "@/lib/supabase/admin";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { AUTOMATION_CONSUMER_KEY, runAutomationForEvent } from "@/lib/automation/engine";
import { processarEventoDeRegra } from "@/src/automation/motor";
import { GATILHOS_DE_REGRA } from "@/src/automation/regras";
// Importa os executores para que se registrem (side-effect imports — Tasks 9-11):
import "@/lib/automation/actions/register-all";

/**
 * F15-T04 (ADR-036 §2 T04): o motor do SaaS (`src/automation/motor.ts`, pg,
 * ações só do catálogo) processa TODOS os gatilhos de regra — os do SaaS e os
 * dois de lead que a base já emitia. `runAutomationForEvent` (Supabase) fica
 * no kit sem consumidor neste fork: dois motores sobre as mesmas regras
 * executariam a mesma regra duas vezes.
 */
export const automationRulesHandler: EventHandler = {
  key: AUTOMATION_CONSUMER_KEY,
  events: [...GATILHOS_DE_REGRA],
  async handle(row) {
    const causedByRule = typeof row.metadata?.request_id === "string" && row.metadata.request_id.startsWith("rule:");
    if (causedByRule) return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "caused_by_rule" };
    const r = await processarEventoDeRegra(row);
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: `rules_matched=${r.rules_matched} runs=${r.runs.length}` };
  },
};

/** Exportado para o kit; não é o handler registrado neste fork (ver acima). */
export const automationRulesHandlerHerdado: EventHandler = {
  key: `${AUTOMATION_CONSUMER_KEY}-herdado`,
  events: ["lead.created", "lead.stage_changed", "message.received", "lead.tag_added", "contact.tag_added"],
  async handle(row) {
    return runAutomationForEvent(createAdminClient(), row);
  },
};
