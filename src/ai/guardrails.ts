/**
 * Os GUARDRAILS do turno SaaS (§5.9, F04-T05; D18/D19).
 *
 * Funções puras, de propósito: cada decisão desta task é uma pergunta que se
 * responde com os números do turno, e uma função pura é o que permite ao teste
 * medir a decisão sem montar um banco para cada variação. Quem faz I/O é
 * `turno.ts`; quem decide é este arquivo.
 *
 * São quatro decisões, e cada uma existe porque o turno herdado não a tem:
 *
 *  1. SILÊNCIO — em que estados a IA pode falar (§5.8 inv. 3, D19).
 *  2. INJEÇÃO — pedido proibido vira handoff `forbidden_request` (§5.9).
 *  3. CONFIANÇA — abaixo do limiar do tenant vira `low_confidence` (D19).
 *  4. FORA DA BASE — `ai.unknown_answer` e, na segunda vez, `out_of_knowledge`.
 */
import { TRANSITIONS, type ConversationState } from "@/src/conversation";
import type { ToolSpec } from "@/src/actions";

import type { SaidaEstruturada, ToolCallPedida } from "./contrato";

// ─── 1. Silêncio ────────────────────────────────────────────────────────────

/**
 * Os estados de onde a IA pode PÔR TEXTO NO FIO, derivados da tabela D16.
 *
 * ⚠️ Derivados, nunca escritos à mão. O critério é o evento `ai.reply_sent`: se
 * a máquina não aceita "a IA respondeu" a partir de um estado, então a IA não
 * responde a partir dele — e a lista deixa de poder divergir da tabela no dia em
 * que alguém acrescentar uma linha. Uma constante
 * `["ai_handling"]` aqui envelheceria em silêncio, e o silêncio seria do lado
 * errado: a IA falando por cima de um atendente humano.
 *
 * Hoje isso dá exatamente `ai_handling`. `waiting_human` e `human_handling`
 * ficam de fora porque a conversa já é de uma pessoa — é a regra 19 do
 * AGENTS.md (`ai_messages_after_handoff = 0`) e o invariante 3 de §5.8.
 */
export const ESTADOS_EM_QUE_A_IA_FALA: readonly ConversationState[] = Object.freeze([
  ...new Set(
    TRANSITIONS.filter(
      (linha) => linha.event === "ai.reply_sent" && linha.actor.includes("ai"),
    ).map((linha) => linha.from),
  ),
]);

/** O complemento — os estados em que o turno é SILENCIADO. Também derivado. */
export function iaPodeFalar(estado: ConversationState): boolean {
  return ESTADOS_EM_QUE_A_IA_FALA.includes(estado);
}

// ─── 2. Injeção de prompt ───────────────────────────────────────────────────

/**
 * Os pedidos que §5.9 nomeia como proibidos: revelar configuração, pedir dado de
 * OUTRO cliente/empresa, e mandar ignorar as regras.
 *
 * ⚠️ Isto NÃO é um classificador de segurança: é uma barreira determinística que
 * roda ANTES do provedor, e o seu valor está em ser barata e reproduzível. A
 * defesa que não depende de reconhecer a frase é outra, e é a que sustenta a
 * garantia: o contexto do turno só contém dado do PRÓPRIO tenant (F04-T04) e o
 * modelo só alcança as nove tools do catálogo, cada uma escopada por
 * organização (F04-T06). Uma injeção que passe por aqui continua sem ter de onde
 * tirar dado alheio.
 *
 * Os padrões olham o texto do cliente como DADO — casam substring, não executam
 * nada, e nada do que casar entra em consulta, comando ou nome de tool.
 */
const PEDIDOS_PROIBIDOS: readonly RegExp[] = Object.freeze([
  /ignor[ae]\s+(as\s+|todas\s+as\s+|suas\s+)?(regras|instru[çc][õo]es|orienta[çc][õo]es)/i,
  /esque[çc]a\s+(as\s+|tudo\s+|suas\s+)?(regras|instru[çc][õo]es|o\s+que)/i,
  /(revele|mostre|me\s+d[êe]|imprima|repita|qual\s+[ée])\s+(o\s+|a\s+|as\s+|seu\s+|sua\s+)?(system\s*prompt|prompt\s+do\s+sistema|suas\s+instru[çc][õo]es|configura[çc][õo]es?\s+(do\s+)?(sistema|tenant|empresa))/i,
  /\b(system\s*prompt|prompt\s+de\s+sistema)\b/i,
  /(dados?|pedidos?|telefone|cadastro|informa[çc][õo]es)\s+(de|do|da|dos|das)\s+(outro|outra|outros|outras)\s+(cliente|clientes|empresa|empresas|tenant)/i,
  /(lista|liste|listar)\s+(todos\s+os\s+|todas\s+as\s+)?(clientes|empresas|tenants|organiza[çc][õo]es)/i,
  /\b(api[_\s-]?key|service[_\s-]?role|chave\s+(de\s+)?api|senha\s+do\s+banco|token\s+de\s+acesso)\b/i,
  /voc[êe]\s+agora\s+[ée]\s+/i,
  /\bDAN\b|\bjailbreak\b|developer\s+mode/i,
]);

export function pedidoProibido(texto: string): boolean {
  const alvo = (texto ?? "").trim();
  if (alvo.length === 0) return false;
  return PEDIDOS_PROIBIDOS.some((padrao) => padrao.test(alvo));
}

// ─── 3. Limiar de confiança ─────────────────────────────────────────────────

/** O default de §5.2 para `ai.confidence_threshold`. */
export const LIMIAR_PADRAO_DE_CONFIANCA = 0.6;

/**
 * O limiar do tenant, com o default quando o valor não é um número de [0,1].
 *
 * Valor fora do tipo NÃO vira "sem limiar": limiar ausente aceitaria qualquer
 * palpite do modelo, que é o lado errado para errar.
 */
export function limiarDoTenant(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor <= 1
    ? valor
    : LIMIAR_PADRAO_DE_CONFIANCA;
}

/**
 * §5.9: `confidence < ai.confidence_threshold` gera handoff `low_confidence`.
 *
 * A comparação é `<` e não `<=`: com o limiar em 0,6 uma resposta com confiança
 * exatamente 0,6 ESTÁ no limiar configurado, e recusá-la faria o tenant que
 * configurou 0,6 receber o comportamento de quem configurou 0,61.
 */
export function abaixoDoLimiar(confidence: number, limiar: number): boolean {
  return confidence < limiar;
}

// ─── 4. Fora da base ────────────────────────────────────────────────────────

/**
 * "A pergunta está fora da base" é decidida por DOIS sinais, e o que manda é o
 * do banco (G-35):
 *
 *  - o modelo DECLARA que responderia pela base e não achou (`out_of_knowledge`);
 *  - o acervo do tenant, consultado neste mesmo turno, devolveu ZERO trechos
 *    acima do limiar de similaridade.
 *
 * O segundo é o que impede a declaração do modelo de virar verdade sozinha: com
 * trechos na mão, "não sei" é palpite dele e não fato do acervo. O primeiro é o
 * que impede toda conversa sem material indexado (um pedido, por exemplo) de ser
 * respondida com "não sei" — a maioria dos turnos não pergunta nada à base.
 */
export function estaForaDaBase(saida: SaidaEstruturada, trechos: number): boolean {
  const declarou =
    saida.handoff.reason === "out_of_knowledge" || saida.intent === "out_of_knowledge";
  return declarou && trechos === 0;
}

/** O texto de "não sei" do tenant, ou `null` quando ele não configurou nenhum. */
export function textoDeDesconhecido(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0 ? valor : null;
}

// ─── Tool calls fora do catálogo ────────────────────────────────────────────

export interface TriagemDeToolCalls {
  readonly aceitas: readonly ToolCallPedida[];
  /** Os nomes DESCARTADOS — §5.9: "tool_call fora da lista é descartado e contado". */
  readonly descartadas: readonly string[];
}

/**
 * Separa o que o modelo pediu entre o que existe em `toolsFor(ctx,"ai")` e o
 * resto.
 *
 * Descartar e CONTAR, nunca lançar: um nome inventado é comportamento esperado
 * de modelo, e `execute()` também o negaria (§5.8, invariante 4). A diferença é
 * que descartar aqui não gasta uma ida ao banco por alucinação.
 */
export function triarToolCalls(
  pedidas: readonly ToolCallPedida[],
  tools: readonly ToolSpec[],
): TriagemDeToolCalls {
  const permitidas = new Set(tools.map((tool) => tool.name));
  const aceitas: ToolCallPedida[] = [];
  const descartadas: string[] = [];
  for (const pedida of pedidas) {
    if (permitidas.has(pedida.name)) aceitas.push(pedida);
    else descartadas.push(pedida.name);
  }
  return { aceitas, descartadas };
}
