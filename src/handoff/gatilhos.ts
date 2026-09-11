/**
 * Os GATILHOS de handoff (F05-T01; §5.11, D19, §5.9).
 *
 * D19 enumera sete gatilhos de negócio e §5.9 acrescenta o de segurança
 * (`forbidden_request`). Este arquivo tem as decisões que se tomam SEM banco e
 * SEM provedor — funções puras, para que o teste meça a decisão em vez de
 * montar um mundo inteiro por variação. Quem faz I/O é `src/ai/turno.ts`; quem
 * decide o que é gatilho é aqui.
 *
 * ═══ Onde cada um dos oito nasce ═══════════════════════════════════════════
 *
 * Três já existiam no turno da F04 e NÃO são reescritos aqui — o handoff é
 * ampliado, nunca substituído:
 *
 *   · `forbidden_request` — `pedidoProibido()` de `src/ai/guardrails.ts`, que
 *     roda ANTES do provedor (ali a razão da ordem é forte: o dado do tenant não
 *     chega a ser lido);
 *   · `low_confidence`    — `abaixoDoLimiar()`, com o limiar do tenant;
 *   · `out_of_knowledge`  — `estaForaDaBase()` mais a contagem de "não sei" já
 *     respondidos nesta conversa.
 *
 * Dois nascem de DESFECHO, não de texto, e por isso não têm função aqui:
 * `provider_error` (o SDK lançou) e a metade de `tenant_rule` que é saldo negado
 * (`EntitlementDenied`, D36). Quem os produz é o `catch` do turno.
 *
 * Os três deste arquivo são os que faltavam:
 *
 *   · `pedidoDeAtendenteHumano` → `customer_request`
 *   · `reclamacaoDetectada`     → `complaint`
 *   · `assuntoProibidoDoTenant` → `tenant_rule`
 *
 * mais `acoesDeRiscoAlto` → `high_risk_action`, que olha o CATÁLOGO e não o
 * texto.
 *
 * ═══ Por que a camada determinística roda DEPOIS do provedor ═══════════════
 *
 * Menos uma: `forbidden_request` continua antes, porque lá o ponto é o contexto
 * do tenant nunca ser lido. Para os outros três não existe esse perigo, e existe
 * uma razão para o contrário: o modelo enxerga a conversa inteira, e uma regex
 * que dispare primeiro tira dele a chance de declarar um motivo melhor fundado.
 * Rodando depois, esta camada é um PISO — ela só acrescenta o handoff que o
 * modelo deixou passar, nunca apaga o que ele pediu.
 *
 * ═══ Isto NÃO é um classificador ═══════════════════════════════════════════
 *
 * São barreiras determinísticas, conservadoras por construção: exigem o verbo
 * mais o alvo, ou a expressão inequívoca. Falso NEGATIVO cai no modelo, que
 * pode declarar o motivo; falso POSITIVO chama uma pessoa sem necessidade — e é
 * por isso que o lado conservador é o certo para errar aqui.
 *
 * O texto do cliente entra como DADO (D18, AGENTS.md regra 4): as regex casam
 * substring, nada do que casar vira consulta, comando ou nome de tool.
 */
import type { ToolSpec } from "@/src/actions/catalog";
import { nivelDeRisco } from "@/src/actions/catalog";

import type { MotivoDeHandoff } from "./motivos";

/**
 * Minúsculas e sem acento (NFD), o MESMO tratamento de
 * `lib/agent-engine/agent/human-handoff.ts:37-46`. Os padrões abaixo são
 * escritos sem acento, então "atendente"/"insatisfação" casam dos dois jeitos.
 */
export function normalizar(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "");
}

// ─── 1. customer_request ────────────────────────────────────────────────────

/**
 * Pedido explícito de atendimento humano (D19, gatilho 1).
 *
 * ⚠️ Os quatro padrões são os do gatilho HERDADO
 * (`lib/agent-engine/agent/human-handoff.ts:52-57`), copiados e não importados —
 * e a cópia tem preço declarado, pago em teste: `tests/unit/f05-t01-gatilhos`
 * roda um corpus de frases pelos DOIS e cobra concordância `N/N`. No dia em que
 * um lado mudar, o teste fica vermelho.
 *
 * O motivo de não importar é de dependência, não de gosto: aquele módulo puxa
 * `fronteira-server`, `agent-activity`, `cron/scheduler` e o cliente Postgres no
 * topo do arquivo, e §5.9 é explícita sobre o turno SaaS não alcançar nada
 * disso. Uma função de quatro regex não justifica arrastar o motor herdado
 * inteiro para dentro do caminho quente do turno.
 */
const PEDIDOS_DE_HUMANO: readonly RegExp[] = Object.freeze([
  /\b(?:falar|conversar)\s+com\s+(?:um[a]?\s+)?(?:atendente|humano|pessoa|gente|consultor|vendedor|representante|responsavel)\b/,
  /\bme\s+(?:passa|passe|transfere|transfira|encaminha|encaminhe|manda|mande)\s+(?:pra|para|pro)\s+(?:um[a]?\s+)?(?:atendente|humano|pessoa|gente|setor|comercial)\b/,
  /\batendimento\s+humano\b/,
  /\b(?:atendente|humano|pessoa)\s+de\s+verdade\b/,
]);

export function pedidoDeAtendenteHumano(texto: string): boolean {
  const alvo = normalizar(texto).trim();
  if (alvo.length === 0) return false;
  return PEDIDOS_DE_HUMANO.some((padrao) => padrao.test(alvo));
}

// ─── 2. complaint ───────────────────────────────────────────────────────────

/**
 * Reclamação ou insatisfação (D19, gatilho 5).
 *
 * Exige a MARCA de insatisfação, nunca o assunto: "o prazo atrasou" é
 * informação e segue com a IA; "o prazo atrasou e isso e um absurdo" chama
 * gente. Sem essa distinção, metade das perguntas de logística viraria handoff
 * e a fila do atendente deixaria de significar alguma coisa.
 *
 * `reclamar`/`reclamacao` entram só na primeira pessoa ("vou reclamar", "quero
 * reclamar"): "onde eu reclamo de uma entrega errada?" é pergunta de
 * procedimento, e a IA sabe respondê-la.
 */
const MARCAS_DE_INSATISFACAO: readonly RegExp[] = Object.freeze([
  /\binsatisfeit[oa]\b|\binsatisfacao\b/,
  /\b(?:isso|isto|esse|este)\s+(?:e|eh)\s+(?:um\s+)?absurdo\b|\bque\s+absurdo\b|\bum\s+absurdo\b/,
  /\b(?:pessim[oa]|horrivel|inaceitavel|vergonhos[oa]|uma\s+vergonha|descaso|descaso\s+total)\b/,
  /\b(?:vou|quero|pretendo)\s+(?:reclamar|cancelar\s+tudo|processar)\b/,
  /\bprocon\b/,
  /\bnunca\s+mais\s+compro\b|\bperdi\s+a\s+paciencia\b/,
]);

export function reclamacaoDetectada(texto: string): boolean {
  const alvo = normalizar(texto).trim();
  if (alvo.length === 0) return false;
  return MARCAS_DE_INSATISFACAO.some((padrao) => padrao.test(alvo));
}

// ─── 3. tenant_rule ─────────────────────────────────────────────────────────

/**
 * Assunto que ESTE tenant proibiu à IA (D19, gatilho 7 — "regra do tenant"),
 * lido de `ai.forbidden_topics` (§5.2).
 *
 * A regra é do TENANT e por isso não tem lista embutida: casa substring
 * normalizada de cada tópico configurado. Tenant sem tópicos (o default `[]`)
 * nunca dispara, e é o que deve acontecer — este gatilho existe para o tenant
 * que escreveu "cancelamento de contrato" na tela, não para uma opinião do
 * produto sobre o que não se fala.
 *
 * Tópico vazio ou em branco é IGNORADO: uma string vazia casaria com qualquer
 * mensagem e mandaria a conversa inteira do tenant para a fila humana — o modo
 * de falha silencioso mais caro que esta chave tem.
 */
export function assuntoProibidoDoTenant(texto: string, topicos: unknown): string | null {
  if (!Array.isArray(topicos)) return null;
  const alvo = normalizar(texto);
  if (alvo.trim().length === 0) return null;
  for (const bruto of topicos) {
    if (typeof bruto !== "string") continue;
    const topico = normalizar(bruto).trim();
    if (topico.length === 0) continue;
    if (alvo.includes(topico)) return bruto.trim();
  }
  return null;
}

// ─── 4. high_risk_action ────────────────────────────────────────────────────

/** O piso de risco que exige gente (D19, gatilho 2: `high` ou `blocked`). */
export const RISCO_QUE_EXIGE_HUMANO = "high" as const;

/**
 * Os nomes das tools pedidas cujo risco no CATÁLOGO é `high` ou `blocked`.
 *
 * Lê o risco de `ToolSpec`, que `toolsFor()` carrega junto — nunca uma lista de
 * nomes escrita aqui. "Mudar o risco de uma Action = 1 linha" (§5.19) continua
 * verdade: subir `create_order` para `high` passa a chamar gente sem tocar neste
 * arquivo.
 *
 * Devolve os NOMES e não um booleano porque o dossiê de §5.11 quer
 * `pending_action` preenchido — e a ação que provocou a passagem é exatamente
 * essa.
 */
export function acoesDeRiscoAlto(
  pedidas: readonly { readonly name: string }[],
  tools: readonly ToolSpec[],
): readonly string[] {
  const piso = nivelDeRisco(RISCO_QUE_EXIGE_HUMANO);
  const risco = new Map(tools.map((tool) => [tool.name, tool.risk]));
  const achadas: string[] = [];
  for (const pedida of pedidas) {
    const nivel = risco.get(pedida.name);
    if (nivel !== undefined && nivelDeRisco(nivel) >= piso) achadas.push(pedida.name);
  }
  return achadas;
}

// ─── A camada, em UMA chamada ───────────────────────────────────────────────

/** O que a camada determinística achou no texto do cliente, se achou algo. */
export interface GatilhoDeTexto {
  readonly motivo: Extract<MotivoDeHandoff, "customer_request" | "complaint" | "tenant_rule">;
  /** O tópico configurado que casou — só em `tenant_rule`. Nunca a frase do cliente. */
  readonly detalhe?: string;
}

/**
 * O primeiro gatilho de TEXTO, na ordem em que D19 os torna mais específicos.
 *
 * A ordem não é estética: um cliente irritado que pede uma pessoa dispara os
 * dois, e `customer_request` é o motivo mais fiel ao que ele escreveu — a
 * reclamação é o contexto, o pedido é a ação. `tenant_rule` fica por último
 * porque é a regra mais genérica: ela casa por assunto e passaria por cima de
 * um pedido explícito se viesse antes.
 */
export function gatilhoDeTexto(texto: string, topicosProibidos: unknown): GatilhoDeTexto | null {
  if (pedidoDeAtendenteHumano(texto)) return { motivo: "customer_request" };
  if (reclamacaoDetectada(texto)) return { motivo: "complaint" };
  const topico = assuntoProibidoDoTenant(texto, topicosProibidos);
  if (topico !== null) return { motivo: "tenant_rule", detalhe: topico };
  return null;
}
