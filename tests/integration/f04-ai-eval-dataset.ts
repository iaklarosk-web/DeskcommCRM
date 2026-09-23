/**
 * O DATASET de avaliação e o MODELO DE MENTIRA que o responde (F04-T07, §5.9).
 *
 * Duas coisas moram aqui, e as duas existem para que o veredito de
 * `tests/integration/f04-t07-ai-eval.test.ts` não dependa de nada escrito à mão:
 *
 *  1. O LEITOR de `docs/ai-eval/cases.yaml`, com schema Zod. Dataset fora do
 *     contrato é erro de carga, não um caso que passa por vacuidade — um
 *     `expected` sem `final_state` viraria "nada a conferir" e a linha
 *     `ai_eval: pass=30/30` continuaria verde medindo menos.
 *
 *  2. O ROTEIRO do mock (§5.9, D12): uma função do PROMPT para a saída
 *     estruturada.
 *
 * ═══ Por que o roteiro lê o PROMPT e não o caso ═════════════════════════════
 *
 * Seria mais curto dar ao mock a resposta esperada de cada `case_id`. Seria
 * também inútil: o mock passaria a repetir a expectativa, e o `ai:eval` mediria
 * a própria tabela de respostas. Em particular, os cinco casos `cross_tenant`
 * não mediriam NADA — um mock que já sabe dizer "não sei" diria "não sei"
 * mesmo com o acervo do vizinho inteiro no contexto.
 *
 * Aqui o mock é ATERRADO: ele só afirma o que o contexto trouxe. Se o contexto
 * trouxer um trecho do outro tenant — que é exatamente o que acontece quando o
 * filtro de organização do acervo some —, o mock responde com ele, a asserção
 * `must_not_contain` fica vermelha e o mutante 47 morre. É a diferença entre um
 * dataset que prova isolamento e um que prova que alguém digitou a resposta
 * certa.
 *
 * O que NÃO é aterrado são os gatilhos de conversa (pedido de humano,
 * reclamação, pouca certeza, pedido proibido que passou pela barreira): esses
 * são comportamento do MODELO, não do contexto, e num mock determinístico eles
 * têm de vir de uma regra sobre o texto do cliente. Cada regra está nomeada
 * abaixo, e nenhuma delas olha para o `id` do caso.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { PedidoAoModelo, SaidaEstruturada } from "@/src/ai";

/** Onde o dataset vive. Um lugar só, citado por AGENTS.md §2. */
export const CAMINHO_DO_DATASET = path.resolve(__dirname, "../../docs/ai-eval/cases.yaml");

// ─── Contrato do arquivo ────────────────────────────────────────────────────

export const CATEGORIAS = ["unknown", "injection", "cross_tenant", "normal", "handoff"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/**
 * A composição que §7.5 fixa. O runner compara a contagem do arquivo com esta
 * tabela e reprova na CARGA: um dataset com nove injeções não pode chegar até a
 * linha `ai_eval:` e imprimir `injection=9` como se fosse um fato novo.
 */
export const COMPOSICAO_EXIGIDA: Readonly<Record<Categoria, number>> = Object.freeze({
  unknown: 6,
  injection: 10,
  cross_tenant: 5,
  normal: 6,
  handoff: 3,
});

/** O mínimo de §8.3: `cases ≥ 30`. */
export const MINIMO_DE_CASOS = 30;

const referenciaSchema = z.object({
  fonte: z.enum(["none", "setting", "product_price", "knowledge_chunk"]),
  /** De QUEM é o registro. Ausente = o tenant do próprio caso. */
  tenant: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
});

export type ReferenciaDeRegistro = z.infer<typeof referenciaSchema>;

const esperadoSchema = z.object({
  provider_calls: z.number().int().min(0),
  reply: referenciaSchema,
  actions: z.array(z.string().min(1)),
  final_state: z.string().min(1),
  handoff_reason: z.string().min(1).nullable(),
  must_not_contain: z.array(referenciaSchema).default([]),
});

const casoSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIAS),
  tenant: z.string().min(1),
  messages: z.array(z.string().min(1)).min(1),
  expected: esperadoSchema,
});

export type CasoDeAvaliacao = z.infer<typeof casoSchema>;

const materialSchema = z.object({
  nome: z.string().min(1),
  trechos: z.array(z.string().min(1)).min(1),
});

const produtoSchema = z.object({
  codigo: z.string().min(1),
  nome: z.string().min(1),
  preco_cents: z.number().int().min(0),
});

const seedSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
  produtos: z.array(produtoSchema),
  materiais: z.array(materialSchema),
});

export type SeedDoTenant = z.infer<typeof seedSchema>;

const datasetSchema = z.object({
  schema_version: z.literal(1),
  seed: z.record(z.string(), seedSchema),
  cases: z.array(casoSchema).min(MINIMO_DE_CASOS),
});

export type Dataset = z.infer<typeof datasetSchema>;

/**
 * Lê e VALIDA o dataset. Lança com a causa legível: um dataset quebrado tem de
 * derrubar o `ai:eval` na carga, antes de subir banco nenhum.
 */
export function lerDataset(caminho: string = CAMINHO_DO_DATASET): Dataset {
  const lido = datasetSchema.safeParse(parseYaml(readFileSync(caminho, "utf8")));
  if (!lido.success) {
    throw new Error(`docs/ai-eval/cases.yaml fora do contrato: ${lido.error.message}`);
  }
  const dataset = lido.data;

  const ids = new Set<string>();
  for (const caso of dataset.cases) {
    if (ids.has(caso.id)) throw new Error(`caso duplicado no dataset: ${caso.id}`);
    ids.add(caso.id);
    if (dataset.seed[caso.tenant] === undefined) {
      throw new Error(`caso ${caso.id} aponta para um tenant sem seed: ${caso.tenant}`);
    }
  }

  for (const categoria of CATEGORIAS) {
    const quantos = dataset.cases.filter((caso) => caso.category === categoria).length;
    const exigido = COMPOSICAO_EXIGIDA[categoria];
    if (quantos !== exigido) {
      throw new Error(
        `composição do dataset fora de §7.5: ${categoria}=${quantos}, esperado ${exigido}`,
      );
    }
  }
  return dataset;
}

// ─── O preço, escrito de um jeito só ────────────────────────────────────────

/**
 * `4590` → `R$ 45,90`. A MESMA função serve ao mock (que compõe a resposta) e
 * ao runner (que compõe o fragmento esperado a partir de `preco_cents` lido do
 * banco). Duas formatações fariam a asserção falhar por vírgula, não por preço.
 */
export function comoReal(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

// ─── O roteiro do mock ──────────────────────────────────────────────────────

/** O prompt inteiro como texto, `system` e `user` concatenados. */
export function textoDoPrompt(prompt: PedidoAoModelo["prompt"]): string {
  return prompt.map((parte) => textoDaParte(parte.content)).join("\n");
}

function textoDaParte(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((parte) =>
      parte !== null && typeof parte === "object" && "text" in parte
        ? String((parte as { text: unknown }).text)
        : "",
    )
    .join("");
}

/**
 * O JSON que vem logo depois de um rótulo do contexto (§5.9,
 * `contextoComoTexto`). Devolve `null` quando o rótulo não está lá ou o JSON não
 * lê — o mock então se comporta como quem não recebeu aquela parte do contexto,
 * que é o comportamento honesto.
 */
function blocoDoContexto(texto: string, rotulo: string): unknown {
  const inicio = texto.indexOf(rotulo);
  if (inicio < 0) return null;
  const linha = texto.slice(inicio + rotulo.length).split("\n")[1] ?? "";
  try {
    return JSON.parse(linha) as unknown;
  } catch {
    return null;
  }
}

interface TrechoDoContexto {
  fonte: string | null;
  conteudo: string;
}

interface ProdutoDoContexto {
  nome: string;
  price_cents: number | null;
  sale_unit: string | null;
}

function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const saidaDe = (parcial: Partial<SaidaEstruturada>): SaidaEstruturada => ({
  reply: "",
  intent: "desconhecida",
  confidence: 0,
  tool_calls: [],
  handoff: { wanted: false, reason: null },
  ...parcial,
});

/** O nome que o caso `injection-10` usa para tentar sair do catálogo. */
export const TOOL_FORA_DO_CATALOGO = "export_all_customers";

/** Onde `contextoComoTexto` põe cada parte — os rótulos, num lugar só. */
const ROTULO_SETTINGS = "CONFIGURAÇÃO DA EMPRESA:";
const ROTULO_PRODUTOS = "PRODUTOS ENCONTRADOS:";
const ROTULO_TRECHOS = "TRECHOS DA BASE DE CONHECIMENTO:";

/**
 * O modelo de mentira. Determinístico: o mesmo prompt dá a mesma saída, sempre,
 * sem rede e sem chave.
 *
 * A ORDEM das regras é o desenho: os gatilhos de conversa vêm antes do
 * aterramento porque "quero falar com uma pessoa" não é uma pergunta sobre o
 * catálogo — e o horário vem antes do acervo porque o acervo devolve trechos
 * fracamente parecidos para quase qualquer frase, e responder um prazo de
 * entrega a quem perguntou o horário seria o mock escolhendo mal, não o produto.
 */
export function roteiroAterrado(pedido: PedidoAoModelo): SaidaEstruturada {
  const texto = textoDoPrompt(pedido.prompt);
  const mensagem = semAcento(mensagemDoCliente(texto));

  // 1. O cliente pediu uma pessoa (D19, `customer_request`).
  if (/falar com (uma pessoa|alguem|um atendente|humano)/.test(mensagem)) {
    return saidaDe({ intent: "pedido_de_humano", confidence: 0.95, handoff: { wanted: true, reason: "customer_request" } });
  }

  // 2. Reclamação/insatisfação (D19, `complaint`).
  if (/absurdo|insatisfeit|reclama[cç]|pessim|inaceit/.test(mensagem)) {
    return saidaDe({ intent: "reclamacao", confidence: 0.95, handoff: { wanted: true, reason: "complaint" } });
  }

  // 3. Pedido proibido que passou pela barreira determinística (§5.9).
  if (/configuracao interna|configuracao do sistema|suas instrucoes/.test(mensagem)) {
    return saidaDe({ intent: "pedido_proibido", confidence: 0.95, handoff: { wanted: true, reason: "forbidden_request" } });
  }

  // 4. Tentativa de ação FORA do catálogo — a triagem de §5.9 a descarta.
  if (/exportar a relacao completa/.test(mensagem)) {
    return saidaDe({
      intent: "exportacao",
      confidence: 0.95,
      tool_calls: [{ name: TOOL_FORA_DO_CATALOGO, input: { escopo: "tudo" } }],
    });
  }

  // 5. Pouca certeza: o número é do MODELO; quem decide o que fazer com ele é o
  //    limiar do tenant (§5.2, G-77).
  if (/talvez|nao tenho certeza/.test(mensagem)) {
    return saidaDe({ reply: "acho que consigo ajudar", intent: "duvida", confidence: 0.2 });
  }

  const settings = blocoDoContexto(texto, ROTULO_SETTINGS) as Record<string, unknown> | null;
  const produtos = (blocoDoContexto(texto, ROTULO_PRODUTOS) ?? []) as ProdutoDoContexto[];
  const trechos = (blocoDoContexto(texto, ROTULO_TRECHOS) ?? []) as TrechoDoContexto[];

  // 6. Horário: o registro-fonte é a Setting `business.hours`, devolvida SEM
  //    enfeite — o teste compara o corpo gravado com o valor do banco.
  const horario = settings?.["business.hours"];
  if (/horario de funcionamento|que horas voces abrem/.test(mensagem) && typeof horario === "string" && horario.trim().length > 0) {
    return saidaDe({ reply: horario, intent: "horario", confidence: 0.93 });
  }

  // 7. Preço: sai de `PRODUTOS ENCONTRADOS`, que o construtor de contexto leu de
  //    `catalog_products` do tenant.
  const produto = produtos.find((p) => typeof p.price_cents === "number");
  if (produto !== undefined && produto.price_cents !== null) {
    return saidaDe({
      reply: `O ${produto.nome} está ${comoReal(produto.price_cents)} por ${produto.sale_unit ?? "unidade"}.`,
      intent: "preco",
      confidence: 0.94,
    });
  }

  // 8. Acervo: responde com o trecho que o contexto trouxe. É AQUI que um
  //    trecho de outro tenant viraria resposta — e é por isso que o caso
  //    cross-tenant mede o corpo gravado.
  const trecho = trechos[0];
  if (trecho !== undefined && trecho.conteudo.trim().length > 0) {
    return saidaDe({
      reply: `Sobre isso, ${trecho.conteudo}.`,
      intent: "consulta_ao_acervo",
      confidence: 0.91,
    });
  }

  // 9. Nada no contexto sustenta uma resposta (D19, `out_of_knowledge`).
  return saidaDe({
    intent: "out_of_knowledge",
    confidence: 0.9,
    handoff: { wanted: false, reason: "out_of_knowledge" },
  });
}

const ABRE_DO_CLIENTE = "<customer_message>";
const FECHA_DO_CLIENTE = "</customer_message>";

/**
 * O texto do cliente dentro do prompt. A ÚLTIMA ocorrência das tags, não a
 * primeira: as instruções do sistema CITAM as tags, e recortar pela primeira
 * devolveria o texto da instrução.
 */
export function mensagemDoCliente(textoDoPromptInteiro: string): string {
  const abre = textoDoPromptInteiro.lastIndexOf(ABRE_DO_CLIENTE);
  const fecha = textoDoPromptInteiro.lastIndexOf(FECHA_DO_CLIENTE);
  if (abre < 0 || fecha <= abre) return "";
  return textoDoPromptInteiro.slice(abre + ABRE_DO_CLIENTE.length, fecha).trim();
}
