/**
 * Action Policy — o catálogo (§5.8, D17/D18/D33/D34).
 *
 * DEZ entradas na F04-T01: as nove tools de D18 mais `resume_ai` (D34). As duas
 * ações LGPD de F06-T03 fecham as doze de §5.8; `assign_owner` (F15-T04) é a
 * décima terceira — a automação entrega oportunidade pelo rodízio.
 *
 * `toolsFor(ctx, "ai")` devolve exatamente NOVE: `resume_ai` é humana por
 * desenho (D34 — devolver a conversa à IA é decisão de quem a tirou dela).
 *
 * ─── A tabela é DADO ───────────────────────────────────────────────────────
 *
 * Nenhum número deste arquivo é escrito à mão em teste nenhum: a matriz
 * N × 3 executores de §5.8 e a contagem de campos saem daqui em tempo de teste.
 * Mudar o risco ou a confirmação de uma Action continua sendo 1 linha (§5.19).
 *
 * `src/actions/` é o ÚNICO diretório que chama `adapter.send` (§5.7, invariante
 * 3). A chamada mora em `outbound.ts`; aqui só a política.
 */
import { toJSONSchema, type z } from "zod";

import { CONVERSATION_STATES, type ConversationState } from "@/src/conversation";

import {
  cancelAppointmentInputSchema,
  cancelAppointmentOutputSchema,
  confirmAppointmentInputSchema,
  confirmAppointmentOutputSchema,
  createLeadInputSchema,
  createLeadOutputSchema,
  findFreeSlotsInputSchema,
  findFreeSlotsOutputSchema,
  getLeadInputSchema,
  getLeadOutputSchema,
  listAppointmentsInputSchema,
  listAppointmentsOutputSchema,
  listEventTypesInputSchema,
  listEventTypesOutputSchema,
  listLeadsInputSchema,
  listLeadsOutputSchema,
  listPipelinesInputSchema,
  listPipelinesOutputSchema,
  listStagesInputSchema,
  listStagesOutputSchema,
  moveLeadStageInputSchema,
  moveLeadStageOutputSchema,
  proposeContactFieldInputSchema,
  proposeContactFieldOutputSchema,
  setAppointmentOutcomeInputSchema,
  setAppointmentOutcomeOutputSchema,
  updateLeadInputSchema,
  updateLeadOutputSchema,
  assignOwnerInputSchema,
  scheduleAppointmentInputSchema,
  scheduleAppointmentOutputSchema,
  assignOwnerOutputSchema,
  createOrderInputSchema,
  createOrderOutputSchema,
  createTaskInputSchema,
  createTaskOutputSchema,
  customerDataInputSchema,
  deleteCustomerDataOutputSchema,
  exportCustomerDataOutputSchema,
  getCustomerInputSchema,
  getCustomerOutputSchema,
  getOrdersInputSchema,
  getOrdersOutputSchema,
  requestConfirmationInputSchema,
  resumeAiInputSchema,
  searchProductsInputSchema,
  searchProductsOutputSchema,
  sendMessageInputSchema,
  sendMessageOutputSchema,
  transferToHumanInputSchema,
  transferToHumanOutputSchema,
  transitionOutputSchema,
  updateOrderQuantityInputSchema,
  updateOrderQuantityOutputSchema,
} from "./schemas";

/** Os três executores de §5.8. `job` não é executor: é quem transporta um. */
export const ACTION_EXECUTORS = ["human", "ai", "automation"] as const;
export type ActionExecutor = (typeof ACTION_EXECUTORS)[number];

/**
 * Taxonomia de risco — só existe aqui (§5.8, "Esconde") — e a ORDEM é
 * semântica: `by_risk` compara o risco da Action com o Setting
 * `actions.confirm_from_risk`, e comparar enum exige uma escala. O índice neste
 * array É a escala; uma segunda tabela `{low: 0, medium: 1, …}` poderia
 * divergir desta lista no dia em que um risco novo aparecesse.
 */
export const ACTION_RISKS = ["low", "medium", "high", "blocked"] as const;
export type ActionRisk = (typeof ACTION_RISKS)[number];

export type ActionConfirmation = "none" | "always" | "by_risk";

export function nivelDeRisco(risco: ActionRisk): number {
  return ACTION_RISKS.indexOf(risco);
}

/** Os oito campos de §5.8, em um lugar só — o teste conta a partir daqui. */
export const ACTION_ENTRY_FIELDS = [
  "name",
  "input_schema",
  "output_schema",
  "side_effect",
  "risk",
  "executors",
  "confirmation",
  "audit",
] as const;

/**
 * Entrada do catálogo. `audit` é o literal `"always"` e não um booleano: §5.8
 * diz "audit: always" para TODA entrada, e um campo que só pode ter um valor
 * documenta melhor a regra do que um `true` que convida ao `false`.
 */
export interface ActionCatalogEntry {
  readonly name: string;
  readonly risk: ActionRisk;
  readonly executors: readonly ActionExecutor[];
  readonly confirmation: ActionConfirmation;
  /** O que a Action escreve, em prosa curta — vai para a auditoria e o ADR. */
  readonly side_effect: string;
  readonly audit: "always";
  readonly input_schema: z.ZodType;
  readonly output_schema: z.ZodType;
  /**
   * `resource_type` da linha de auditoria. Fica na POLÍTICA e não no executor
   * porque é o catálogo que sabe sobre o que cada Action age; descobrir isso no
   * executor faria duas Actions do mesmo domínio divergirem em silêncio.
   *
   * NÃO é um dos oito campos de §5.8 — é coluna de `audit_events`, e o
   * `ACTION_ENTRY_FIELDS` acima é quem define a contagem `fields=8/8`.
   */
  readonly resource_type: string;
}

export const ACTION_CATALOG: readonly ActionCatalogEntry[] = [
  {
    name: "get_customer",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "leitura de contacts (nenhuma escrita)",
    audit: "always",
    input_schema: getCustomerInputSchema,
    output_schema: getCustomerOutputSchema,
    resource_type: "contacts",
  },
  {
    name: "search_products",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "leitura de catalog_products (nenhuma escrita)",
    audit: "always",
    input_schema: searchProductsInputSchema,
    output_schema: searchProductsOutputSchema,
    resource_type: "catalog_products",
  },
  {
    name: "get_orders",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "leitura de crm_orders e crm_order_items (nenhuma escrita)",
    audit: "always",
    input_schema: getOrdersInputSchema,
    output_schema: getOrdersOutputSchema,
    resource_type: "crm_orders",
  },
  {
    name: "create_order",
    risk: "medium",
    executors: ["human", "ai"],
    confirmation: "by_risk",
    side_effect: "crm_orders (draft) + crm_order_items + crm_order_events",
    audit: "always",
    input_schema: createOrderInputSchema,
    output_schema: createOrderOutputSchema,
    resource_type: "crm_orders",
  },
  {
    name: "update_order_quantity",
    risk: "medium",
    executors: ["human", "ai"],
    confirmation: "by_risk",
    side_effect: "crm_order_items + crm_order_events",
    audit: "always",
    input_schema: updateOrderQuantityInputSchema,
    output_schema: updateOrderQuantityOutputSchema,
    resource_type: "crm_orders",
  },
  {
    name: "create_task",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "crm_tasks + crm_task_events (tarefa vinculada ao pedido)",
    audit: "always",
    input_schema: createTaskInputSchema,
    output_schema: createTaskOutputSchema,
    resource_type: "crm_tasks",
  },
  // F15-T04: `automation` também transfere (regra "transferir a uma pessoa");
  // o ator da transição continua `system` (`tools/conversa.ts`).
  {
    name: "transfer_to_human",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "transition(handoff.requested) + item de inbox kind=handoff",
    audit: "always",
    input_schema: transferToHumanInputSchema,
    output_schema: transferToHumanOutputSchema,
    resource_type: "conversations",
  },
  {
    name: "request_confirmation",
    risk: "low",
    executors: ["human", "ai"],
    confirmation: "none",
    side_effect: "messages (queued) + job_queue; ESTADO DA CONVERSA INALTERADO",
    audit: "always",
    input_schema: requestConfirmationInputSchema,
    output_schema: sendMessageOutputSchema,
    resource_type: "messages",
  },
  {
    name: "send_message",
    risk: "medium",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "messages (queued) + job_queue (outbound_message) + adapter.send",
    audit: "always",
    input_schema: sendMessageInputSchema,
    output_schema: sendMessageOutputSchema,
    resource_type: "messages",
  },
  {
    name: "resume_ai",
    risk: "low",
    executors: ["human"],
    confirmation: "none",
    side_effect: "transition(human.return_to_ai); só de human_handling (D34)",
    audit: "always",
    input_schema: resumeAiInputSchema,
    output_schema: transitionOutputSchema,
    resource_type: "conversations",
  },
  // F06-T03 — LGPD mínima (§5.18, §7.7). `high` e só humana: a IA e a
  // automação nunca exportam nem apagam um cliente. O papel (tenant_admin)
  // é conferido no handler, contra `user_organizations`, porque o catálogo
  // não sabe de papéis — sabe de executores.
  {
    name: "export_customer_data",
    risk: "high",
    executors: ["human"],
    confirmation: "none",
    side_effect: "leitura de toda tabela ligada ao contato por FK (grafo lido do catálogo); nenhuma escrita",
    audit: "always",
    input_schema: customerDataInputSchema,
    output_schema: exportCustomerDataOutputSchema,
    resource_type: "contacts",
  },
  // F15-T04 (ADR-036 §2 T04) — a única ação NOVA da F15: entregar uma
  // oportunidade a uma pessoa (rodízio ou nomeada). `automation` porque é o
  // que uma regra faz; `human` porque a fila da F13 já deixa o manager
  // distribuir; NÃO `ai` — a IA não escolhe quem vende (D40, autorização).
  {
    name: "assign_owner",
    risk: "low",
    executors: ["human", "automation"],
    confirmation: "none",
    side_effect: "crm_leads.owner_user_id/assigned_at + crm_lead_activities (owner_assigned)",
    audit: "always",
    input_schema: assignOwnerInputSchema,
    output_schema: assignOwnerOutputSchema,
    resource_type: "crm_leads",
  },
  // F14-T04 (ADR-038 §2 T04, D55 e): a IA marca horário na agenda a partir da
  // conversa. `medium` + `by_risk` ⇒ sem entrada na política, D33 PENDURA para
  // aprovação do atendente; a organização sobe para `allow` pela tela da F15.
  // NÃO `automation`: uma regra QUANDO/ENTÃO não escolhe horário por ninguém.
  {
    name: "schedule_appointment",
    risk: "medium",
    executors: ["human", "ai"],
    confirmation: "by_risk",
    side_effect: "insert em calendar_appointments (ligado ao contato e à conversa) + audit_events",
    audit: "always",
    input_schema: scheduleAppointmentInputSchema,
    output_schema: scheduleAppointmentOutputSchema,
    resource_type: "calendar_appointments",
  },
  // ─── F18-T02 (ADR-040 §2): as 14 que saem do MCP herdado ───────────────
  // As 13 que o agente publicado DECLARA e o catálogo não tinha, mais
  // `cancel_appointment` (D56 e). As leituras são `low`/`never`: contexto para
  // responder não é efeito. As escritas de funil são `medium` + `by_risk` ⇒ sem
  // entrada na política, D33 PENDURA para a pessoa aprovar.
  {
    name: "list_leads",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: listLeadsInputSchema,
    output_schema: listLeadsOutputSchema,
    resource_type: "crm_leads",
  },
  {
    name: "get_lead",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: getLeadInputSchema,
    output_schema: getLeadOutputSchema,
    resource_type: "crm_leads",
  },
  {
    name: "list_pipelines",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: listPipelinesInputSchema,
    output_schema: listPipelinesOutputSchema,
    resource_type: "crm_pipelines",
  },
  {
    name: "list_stages",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: listStagesInputSchema,
    output_schema: listStagesOutputSchema,
    resource_type: "crm_stages",
  },
  {
    name: "create_lead",
    risk: "medium",
    executors: ["human", "ai", "automation"],
    confirmation: "by_risk",
    side_effect: "insert em crm_leads no primeiro estágio do funil + audit_events",
    audit: "always",
    input_schema: createLeadInputSchema,
    output_schema: createLeadOutputSchema,
    resource_type: "crm_leads",
  },
  {
    name: "update_lead",
    risk: "medium",
    executors: ["human", "ai"],
    confirmation: "by_risk",
    side_effect: "update de título/valor/descrição em crm_leads + audit_events",
    audit: "always",
    input_schema: updateLeadInputSchema,
    output_schema: updateLeadOutputSchema,
    resource_type: "crm_leads",
  },
  {
    name: "move_lead_stage",
    risk: "medium",
    executors: ["human", "ai", "automation"],
    confirmation: "by_risk",
    side_effect: "update de stage_id em crm_leads (gatilhos herdados fecham/reabrem o lead) + audit_events",
    audit: "always",
    input_schema: moveLeadStageInputSchema,
    output_schema: moveLeadStageOutputSchema,
    resource_type: "crm_leads",
  },
  // A IA não grava o que o cliente disse: PROPÕE, e uma pessoa confirma. Por
  // isso é `low` — a proposta não toca o cadastro.
  {
    name: "propose_contact_field",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "insert em contact_field_proposals (pendente); o cadastro NÃO muda",
    audit: "always",
    input_schema: proposeContactFieldInputSchema,
    output_schema: proposeContactFieldOutputSchema,
    resource_type: "contact_field_proposals",
  },
  {
    name: "list_event_types",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: listEventTypesInputSchema,
    output_schema: listEventTypesOutputSchema,
    resource_type: "calendar_event_types",
  },
  {
    name: "find_free_slots",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: findFreeSlotsInputSchema,
    output_schema: findFreeSlotsOutputSchema,
    resource_type: "calendar_event_types",
  },
  {
    name: "list_appointments",
    risk: "low",
    executors: ["human", "ai", "automation"],
    confirmation: "none",
    side_effect: "nenhum: leitura",
    audit: "always",
    input_schema: listAppointmentsInputSchema,
    output_schema: listAppointmentsOutputSchema,
    resource_type: "calendar_appointments",
  },
  {
    name: "confirm_appointment",
    risk: "low",
    executors: ["human", "ai"],
    confirmation: "none",
    side_effect: "update de status para confirmed pela RPC herdada + audit_events",
    audit: "always",
    input_schema: confirmAppointmentInputSchema,
    output_schema: confirmAppointmentOutputSchema,
    resource_type: "calendar_appointments",
  },
  {
    name: "set_appointment_outcome",
    risk: "low",
    executors: ["human", "ai"],
    confirmation: "none",
    side_effect: "update de status para completed/no_show pela RPC herdada + audit_events",
    audit: "always",
    input_schema: setAppointmentOutcomeInputSchema,
    output_schema: setAppointmentOutcomeOutputSchema,
    resource_type: "calendar_appointments",
  },
  // D56 e: a IA desmarca SOZINHA (`allow` por decisão do proprietário, com o
  // risco declarado). `confirmation: "none"` é o que torna isso verdade no
  // código; os freios que sobram são da fachada e do banco — compromisso
  // passado não é cancelável, motivo obrigatório, revisão e auditoria.
  {
    name: "cancel_appointment",
    risk: "medium",
    executors: ["human", "ai"],
    confirmation: "none",
    side_effect: "update de status para cancelled pela RPC herdada (libera o horário) + audit_events",
    audit: "always",
    input_schema: cancelAppointmentInputSchema,
    output_schema: cancelAppointmentOutputSchema,
    resource_type: "calendar_appointments",
  },
  {
    name: "delete_customer_data",
    risk: "high",
    executors: ["human"],
    confirmation: "none",
    side_effect: "delete em toda tabela ligada ao contato por FK, filhos antes dos pais, numa transação; audit_events sobrevive",
    audit: "always",
    input_schema: customerDataInputSchema,
    output_schema: deleteCustomerDataOutputSchema,
    resource_type: "contacts",
  },
];

const INDICE: ReadonlyMap<string, ActionCatalogEntry> = new Map(
  ACTION_CATALOG.map((entrada) => [entrada.name, entrada]),
);

if (INDICE.size !== ACTION_CATALOG.length) {
  throw new Error("ACTION_CATALOG tem nome duplicado");
}

/** `null` quando o nome não está no catálogo — nunca exceção (§5.8, inv. 4). */
export function findAction(name: string): ActionCatalogEntry | null {
  return INDICE.get(name) ?? null;
}

/**
 * A tool como o modelo a recebe (§5.8, `toolsFor`).
 *
 * `input_schema` sai como JSON Schema porque é isso que o provedor lê; o objeto
 * zod não atravessa a fronteira. `risk` e `confirmation` VIAJAM junto: o turno
 * precisa saber que uma tool pode voltar `pending` sem ter falhado.
 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
  readonly risk: ActionRisk;
  readonly confirmation: ActionConfirmation;
}

/**
 * `toolsFor(ctx, executor)` — §5.8.
 *
 * O `ctx` entra na assinatura porque a Fase 2 filtra por Entitlement do tenant
 * (capabilities de Calendar e Instagram, §5.20) e mudar a assinatura depois
 * obrigaria a mexer em todo chamador. Na Fase 1 o filtro é só o subset de
 * executores — e é ele que faz `toolsFor(ctx, "ai")` devolver nove.
 *
 * `io: "input"` no gerador de JSON Schema: com o default do zod (`"output"`),
 * campo com `.default()` sai como OBRIGATÓRIO, e o modelo passaria a ser
 * cobrado por `limit`, `priority` e companhia — que existem justamente para ele
 * não precisar preencher.
 */
export function toolsFor(_ctx: unknown, executor: ActionExecutor): readonly ToolSpec[] {
  return ACTION_CATALOG.filter((entrada) => entrada.executors.includes(executor)).map(
    (entrada) => ({
      name: entrada.name,
      description: entrada.side_effect,
      input_schema: toJSONSchema(entrada.input_schema, { io: "input" }),
      risk: entrada.risk,
      confirmation: entrada.confirmation,
    }),
  );
}

/**
 * A guarda de estado de `send_message` (e de `request_confirmation`, que também
 * põe texto no fio), em forma de REGISTRO TOTAL sobre os oito estados D16.
 *
 * Registro e não lista de literais soltos: estado novo em
 * `src/conversation/transitions.ts` vira erro de COMPILAÇÃO aqui, porque
 * `Record<ConversationState, boolean>` exige a chave. Uma lista
 * `["resolved","archived"]` aceitaria o estado novo em silêncio — e o silêncio
 * seria "pode enviar", que é o lado errado para errar.
 *
 * Os dois `false` são os terminais de D16: conversa `resolved` ou `archived`
 * não recebe mensagem nossa. Reabrir é movimento de `transition()`
 * (`human.reopened`, `inbound.message`), nunca efeito colateral de um envio.
 */
const ENVIO_PERMITIDO: Record<ConversationState, boolean> = {
  open: true,
  ai_handling: true,
  waiting_customer: true,
  waiting_confirmation: true,
  waiting_human: true,
  human_handling: true,
  resolved: false,
  archived: false,
};

if (Object.keys(ENVIO_PERMITIDO).length !== CONVERSATION_STATES.length) {
  throw new Error("ENVIO_PERMITIDO não cobre os estados de CONVERSATION_STATES");
}

/** Os estados que RECUSAM envio, derivados do registro — nunca escritos à mão. */
export const ESTADOS_SEM_ENVIO: readonly ConversationState[] = CONVERSATION_STATES.filter(
  (estado) => !ENVIO_PERMITIDO[estado],
);

export function conversaAceitaEnvio(estado: ConversationState): boolean {
  return ENVIO_PERMITIDO[estado] === true;
}
