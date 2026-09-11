/**
 * Action Policy — o catálogo (§5.8, D17/D18).
 *
 * Nasce na F03-T06 com UMA entrada, `send_message`. As outras onze de §5.8
 * chegam em F04-T01 e F06-T03; escrevê-las aqui agora seria catálogo com
 * entrada sem executor — e "pode executar?" respondido por uma linha que não
 * leva a lugar nenhum é pior que a ausência da linha.
 *
 * `executors: ["human"]` e não `["human","ai","automation"]` como a tabela de
 * §5.8 prevê no fim da Fase 1: a IA só ganha `execute()` na F04-T01 e a
 * automação na F05. Um subset maior que os executores que existem faria a
 * matriz N×3 de §5.8 aprovar um caminho que ninguém percorre.
 *
 * `src/actions/` é o ÚNICO diretório que chama `adapter.send` (§5.7, invariante
 * 3). A chamada em si mora em `execute.ts`; aqui só a política.
 */
import { z } from "zod";

import { CONVERSATION_STATES, type ConversationState } from "@/src/conversation";

/** Os três executores de §5.8. `job` não é executor: é quem transporta um. */
export const ACTION_EXECUTORS = ["human", "ai", "automation"] as const;
export type ActionExecutor = (typeof ACTION_EXECUTORS)[number];

/** Taxonomia de risco — só existe aqui (§5.8, "Esconde"). */
export type ActionRisk = "low" | "medium" | "high" | "blocked";

export type ActionConfirmation = "none" | "always" | "by_risk";

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
}

export const sendMessageInputSchema = z.strictObject({
  conversation_id: z.uuid(),
  body: z.string().trim().min(1).max(4096),
  /**
   * Opcional: sem ela, `execute()` usa o id da mensagem recém-gravada. É o que
   * faz "enviar duas vezes o mesmo texto" continuar sendo DOIS envios (duas
   * mensagens, dois ids) e "reprocessar o mesmo envio" continuar sendo um.
   */
  idempotency_key: z.string().trim().min(1).max(200).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const sendMessageOutputSchema = z.strictObject({
  message_id: z.uuid(),
  job_id: z.uuid(),
  /** `false` quando a fila já tinha o job desta mensagem (idempotência). */
  enqueued: z.boolean(),
});

export type SendMessageOutput = z.infer<typeof sendMessageOutputSchema>;

export const ACTION_CATALOG: readonly ActionCatalogEntry[] = [
  {
    name: "send_message",
    risk: "medium",
    executors: ["human"],
    confirmation: "none",
    side_effect: "messages (queued) + job_queue (outbound_message) + adapter.send",
    audit: "always",
    input_schema: sendMessageInputSchema,
    output_schema: sendMessageOutputSchema,
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
 * A guarda de estado de `send_message`, em forma de REGISTRO TOTAL sobre os oito
 * estados D16.
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
