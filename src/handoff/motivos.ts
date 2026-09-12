/**
 * Os OITO motivos de handoff de §5.11 e o que cada um significa (F05-T01).
 *
 * §5.11: "`reason` é enum com oito valores — as 7 entradas de D19 mais
 * `forbidden_request` (5.9, prompt injection)". Enum e NUNCA frase (G-78):
 * motivo em prosa não vira etiqueta de contador nem filtro de fila, e a
 * primeira frase livre gravada ali torna impossível responder "quantos handoffs
 * foram por falha do provedor?" sem ler texto a olho.
 *
 * ─── Por que este arquivo é um REGISTRO TOTAL, e não três listas soltas ────
 *
 * Cada `Record<MotivoDeHandoff, X>` abaixo é total sobre o enum. Motivo novo em
 * `HANDOFF_REASONS` vira erro de COMPILAÇÃO aqui — não um `undefined` viajando
 * até o dossiê que a pessoa vai ler. É o que faz "novo motivo = 1 valor no enum
 * + 1 caso no ai-eval" (§5.11, "Mudar X") continuar sendo verdade.
 *
 * ─── A lista mora em `src/actions/schemas.ts`, e não aqui ─────────────────
 *
 * Porque é de lá que sai o `input_schema` de `transfer_to_human`, que é a porta
 * por onde o motivo entra. Duplicar o array criaria duas verdades sobre quantos
 * motivos existem, e a prova `triggers=8` deixaria de medir a que importa.
 * Importamos o módulo-folha (`./schemas`) e não o barril de `src/actions` de
 * propósito: `src/actions/handoff-bridge.ts` importa daqui, e pelo barril isso
 * fecharia um ciclo de import.
 */
import { HANDOFF_REASONS } from "@/src/actions/schemas";

export type MotivoDeHandoff = (typeof HANDOFF_REASONS)[number];

/** Os oito, em ordem estável. Nunca escritos à mão em teste nenhum. */
export const MOTIVOS_DE_HANDOFF: readonly MotivoDeHandoff[] = HANDOFF_REASONS;

export function ehMotivoDeHandoff(valor: unknown): valor is MotivoDeHandoff {
  return typeof valor === "string" && (MOTIVOS_DE_HANDOFF as readonly string[]).includes(valor);
}

/**
 * A ORIGEM de cada motivo — quem o produz no turno.
 *
 * Não é enfeite de documentação: é o denominador da prova `triggers=8 pass=8/8`.
 * Um motivo de origem `deterministica` tem de poder ser disparado sem o
 * provedor; um de origem `modelo` só existe quando o modelo o declara; um de
 * `execucao` nasce de um desfecho (provedor caiu, saldo negado, risco alto da
 * ação pedida). Sem essa distinção, a prova dos oito gatilhos passaria mandando
 * o modelo declarar os oito — que mede o dublê, não o produto.
 */
export type OrigemDoMotivo = "deterministica" | "modelo" | "execucao";

export const ORIGEM_DO_MOTIVO: Record<MotivoDeHandoff, OrigemDoMotivo> = {
  /** Regex PT-BR sobre o texto do cliente (o gatilho herdado de D19, item 1). */
  customer_request: "deterministica",
  /** A tool pedida tem risco `high`/`blocked` no catálogo (§5.8). */
  high_risk_action: "execucao",
  /** `confidence < ai.confidence_threshold` (D19, G-77). */
  low_confidence: "execucao",
  /** Pergunta fora da base depois de uma tentativa (D19). */
  out_of_knowledge: "execucao",
  /** Regex PT-BR de insatisfação sobre o texto do cliente (D19). */
  complaint: "deterministica",
  /** O provedor falhou; nenhuma segunda tentativa (F04-T09). */
  provider_error: "execucao",
  /** `ai.forbidden_topics` do tenant, ou saldo negado (D36) — regra do tenant. */
  tenant_rule: "deterministica",
  /** Injeção de prompt reconhecida antes do provedor (§5.9). */
  forbidden_request: "deterministica",
};

/**
 * A INTENÇÃO que o dossiê carrega quando o turno não tem uma melhor.
 *
 * §5.11 exige o campo `intent` preenchido nos sete. Deixá-lo vazio quando o
 * modelo não respondeu (provedor fora do ar, injeção barrada antes da chamada)
 * faria `fields_present` cair por um campo que o produto SABE preencher — o
 * motivo já diz qual era a intenção da passagem.
 *
 * São etiquetas, não frases: `intent` é campo de filtro na fila.
 */
export const INTENT_PADRAO: Record<MotivoDeHandoff, string> = {
  customer_request: "pedido_de_atendimento_humano",
  high_risk_action: "acao_de_risco_alto",
  low_confidence: "resposta_sem_confianca",
  out_of_knowledge: "pergunta_fora_da_base",
  complaint: "reclamacao",
  provider_error: "erro_antes_da_resposta",
  tenant_rule: "regra_do_tenant",
  forbidden_request: "pedido_proibido",
};

/**
 * A primeira frase do resumo — o PORQUÊ, em português, para quem vai assumir.
 *
 * Saiu de `src/ai/turno.ts` (onde nasceu na F04 como `resumoDeterministico`)
 * para cá sem uma palavra alterada: o turno não é o único caminho de handoff
 * (há o do atendente e, na F05-T03, o da fila), e um texto que só existe lá
 * faria os outros caminhos chegarem ao dossiê sem explicação.
 */
export const PORQUE_DO_MOTIVO: Record<MotivoDeHandoff, string> = {
  customer_request: "O cliente pediu para falar com uma pessoa.",
  high_risk_action: "A ação pedida exige autorização humana.",
  low_confidence: "A IA não teve confiança suficiente na própria resposta.",
  out_of_knowledge: "A pergunta não é coberta pela base de conhecimento do tenant.",
  complaint: "O cliente demonstrou insatisfação.",
  provider_error: "O provedor de IA falhou nesta conversa; nenhuma nova tentativa foi feita.",
  tenant_rule: "Uma regra do tenant interrompeu o atendimento automático.",
  forbidden_request:
    "O texto recebido pediu configuração, dado de outro cliente ou quebra de regra.",
};

/**
 * O `suggested_next_step` de §5.11 — o que a pessoa faz AGORA.
 *
 * Determinístico por motivo, e determinístico de propósito: pedir a sugestão ao
 * modelo custaria uma chamada a mais por handoff (§5.11 permite UMA, e ela é o
 * resumo) e, nos dois motivos mais prováveis desta fase — provedor fora do ar e
 * injeção —, seria pedir ao componente que falhou ou ao texto que se tenta
 * conter.
 */
export const PROXIMO_PASSO_DO_MOTIVO: Record<MotivoDeHandoff, string> = {
  customer_request: "Assuma a conversa e se apresente ao cliente pelo nome.",
  high_risk_action:
    "Confira a ação pedida antes de executá-la; ela tem risco alto no catálogo.",
  low_confidence: "Releia as últimas mensagens e responda você; a IA não teve confiança.",
  out_of_knowledge:
    "Responda a pergunta e considere indexar o material que faltou na base do tenant.",
  complaint: "Assuma a conversa com prioridade e trate a reclamação antes de qualquer venda.",
  provider_error:
    "Assuma a conversa: a IA não voltará sozinha nesta passagem. Verifique o provedor.",
  tenant_rule: "Assuma a conversa; uma regra desta organização impediu o atendimento automático.",
  forbidden_request:
    "Leia o texto do cliente antes de responder: ele pediu configuração ou dado de terceiro.",
};

/**
 * O resumo determinístico de UMA frase — a base do campo `summary` de §5.11
 * quando não há checkpoint melhor, e o texto ÚNICO quando `reason` é
 * `provider_error` (§5.11: "com `reason=provider_error` usa template
 * determinístico sem provedor").
 */
export function resumoDeterministico(motivo: MotivoDeHandoff, intent: string): string {
  const rotulo = intent.trim().length > 0 ? intent.trim() : INTENT_PADRAO[motivo];
  return `${PORQUE_DO_MOTIVO[motivo]} Intenção lida: ${rotulo}.`;
}

/**
 * Quantas FRASES um texto tem — §5.11 pede `summary` com ≥1.
 *
 * "Frase" aqui é um trecho não-vazio terminado por `.`, `!`, `?` ou `…`. A
 * medida é grosseira de propósito: ela existe para reprovar o resumo que é uma
 * etiqueta solta (`"handoff"`, `"provider_error"`), não para arbitrar
 * gramática. Contar palavras aprovaria "erro provedor agora"; exigir o
 * terminador é o que separa uma frase de um rótulo.
 */
export function contaFrases(texto: string): number {
  return texto
    .split(/(?<=[.!?…])\s+|(?<=[.!?…])$/u)
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0 && /[.!?…]$/u.test(parte)).length;
}
