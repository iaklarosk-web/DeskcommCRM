/**
 * A SAÍDA ESTRUTURADA do turno SaaS (§5.9, F04-T04).
 *
 * ─── Por que o turno SaaS pede JSON e o herdado não ────────────────────────
 *
 * O turno de lead (`lib/agent-engine/agent/inbound-turn.ts`) devolve texto mais
 * tool-call nativo do SDK. Isso basta para conversar, e NÃO basta para D19: não
 * existe lugar onde o modelo declare quanta confiança tem na própria resposta,
 * e sem esse número o "limiar de confiança configurável" de §5.2 não tem o que
 * comparar. Por isso §5.9 exige
 * `{reply, intent, confidence ∈ [0,1], tool_calls[], handoff:{wanted, reason}}`
 * — e é essa exigência, não uma preferência de formato, que faz o turno SaaS ser
 * um turno novo em vez de um parâmetro do herdado (ADR-021 decisão 1).
 *
 * ─── Ausência é ZERO, não "tudo bem" (G-77) ────────────────────────────────
 *
 * §5.9: "sem `confidence` vale 0". Um default otimista (1, ou "não sei, deixa
 * passar") transformaria modelo mudo, JSON truncado e resposta em prosa nos três
 * casos mais perigosos do produto: a IA responde ao cliente com o que inventou e
 * ninguém é chamado. Aqui todo caminho de leitura mal-sucedida converge para
 * `confidence = 0`, que é gatilho de handoff `low_confidence` no turno.
 *
 * Por isso a leitura NUNCA lança: JSON quebrado é um DESFECHO (`malformada`),
 * não uma exceção que o chamador pode esquecer de tratar.
 */
import { z } from "zod";

import { HANDOFF_REASONS } from "@/src/actions";

/**
 * Uma tool pedida pelo modelo. `input` é `unknown` de propósito: quem valida é o
 * `input_schema` do catálogo dentro de `execute()` (§5.8, passo 4), e validar
 * aqui criaria uma segunda régua para a mesma entrada — que é como as duas
 * divergem.
 */
export const toolCallSchema = z.object({
  name: z.string().trim().min(1).max(80),
  input: z.unknown().default({}),
});

export type ToolCallPedida = z.infer<typeof toolCallSchema>;

export const handoffPedidoSchema = z.object({
  wanted: z.boolean().default(false),
  /** Enum dos oito motivos de §5.11 — nunca frase livre (G-78). */
  reason: z.enum(HANDOFF_REASONS).nullable().default(null),
});

/**
 * `z.object` e não `z.strictObject`: campo a mais do modelo é RUÍDO que se
 * descarta, não motivo para jogar o turno inteiro fora. O rigor está do outro
 * lado — na entrada das tools, onde campo desconhecido reprova (§5.8).
 */
export const saidaEstruturadaSchema = z.object({
  reply: z.string().max(4096).default(""),
  intent: z.string().trim().max(120).default("desconhecida"),
  confidence: z.number().min(0).max(1).default(0),
  tool_calls: z.array(toolCallSchema).max(10).default([]),
  handoff: handoffPedidoSchema.default({ wanted: false, reason: null }),
});

export type SaidaEstruturada = z.infer<typeof saidaEstruturadaSchema>;

/** O que se assume quando não há saída legível. Zero confiança, zero ação. */
export const SAIDA_SEM_LEITURA: SaidaEstruturada = Object.freeze({
  reply: "",
  intent: "ilegivel",
  confidence: 0,
  tool_calls: [],
  handoff: { wanted: false, reason: null },
});

export interface LeituraDaSaida {
  readonly saida: SaidaEstruturada;
  /** `true` quando o texto do modelo não era o JSON do contrato. */
  readonly malformada: boolean;
}

/**
 * Tira o JSON de uma cerca de markdown, quando houver.
 *
 * Modelo instruído a responder JSON devolve ```json … ``` com frequência
 * suficiente para que tratar isso como "malformado" fosse trocar um handoff por
 * um detalhe de formatação. O que NÃO se faz aqui é procurar a primeira `{` e a
 * última `}` do texto: isso aceitaria prosa com um objeto no meio, e aí o turno
 * estaria adivinhando qual pedaço da resposta é o contrato.
 */
function semCerca(texto: string): string {
  const limpo = texto.trim();
  const cerca = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(limpo);
  return cerca?.[1]?.trim() ?? limpo;
}

/**
 * Lê a saída do provedor. Nunca lança: o desfecho ruim é `malformada: true` com
 * `confidence` zero, que o turno converte em handoff.
 */
export function lerSaidaEstruturada(texto: string): LeituraDaSaida {
  const cru = semCerca(texto ?? "");
  if (cru.length === 0) {
    return { saida: SAIDA_SEM_LEITURA, malformada: true };
  }

  let objeto: unknown;
  try {
    objeto = JSON.parse(cru);
  } catch {
    return { saida: SAIDA_SEM_LEITURA, malformada: true };
  }

  const lido = saidaEstruturadaSchema.safeParse(objeto);
  if (!lido.success) {
    return { saida: SAIDA_SEM_LEITURA, malformada: true };
  }
  return { saida: lido.data, malformada: false };
}

/** O JSON que o mock devolve — a forma exata que o prompt pede ao modelo real. */
export function comoTextoDoProvedor(saida: SaidaEstruturada): string {
  return JSON.stringify(saida);
}
