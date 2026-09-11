/**
 * Embedding da Fase 1 (§5.10, ADR-002) — dimensão fixa e embutidor
 * DETERMINÍSTICO para verificação.
 *
 * O modelo e a dimensão NÃO são escolha desta camada: `text-embedding-3-small`,
 * 1536, dos dois lados (indexação e busca). Trocar só um lado não dá erro
 * nenhum — o agente simplesmente para de achar o próprio conteúdo.
 *
 * ─── Por que as constantes são COPIADAS e não importadas ───────────────────
 *
 * A fonte é `lib/ai/embeddings/chave.ts:58-59`, mas aquele módulo importa
 * `@/lib/env` no topo: importá-lo aqui faria todo consumidor de `src/knowledge`
 * validar o ambiente inteiro no load — inclusive um teste de banco que não fala
 * com provedor nenhum. A cópia tem guarda própria contra divergência:
 * `tests/unit/f04-t03-embedding-mock.test.ts` lê aquele arquivo como TEXTO e
 * reprova se os dois números pararem de bater.
 */

/** Pin de contrato (cópia de `lib/ai/embeddings/chave.ts:58`). */
export const MODELO_DE_EMBEDDING = "openai/text-embedding-3-small";
/** ADR-002 (cópia de `lib/ai/embeddings/chave.ts:59`). */
export const DIMENSOES_DO_EMBEDDING = 1536;

/** Quem transforma texto em vetor. A produção injeta o real; a verificação, o mock. */
export type Embutidor = (texto: string) => readonly number[];

/** FNV-1a de 32 bits — pequeno, sem dependência, estável entre processos. */
function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    // Multiplicação por 16777619 em 32 bits sem estourar o double.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Termos comparáveis: minúsculas, sem acento, sem pontuação, sem vazios.
 * Acento fora porque "café" e "cafe" são a mesma pergunta para quem digita no
 * WhatsApp, e um acervo que só responde à forma acentuada parece vazio.
 */
function termos(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Embutidor determinístico: MESMO texto → MESMO vetor, sem rede e sem chave.
 *
 * É *hashing trick* clássico — cada termo cai num balde e soma 1; o vetor é
 * normalizado em L2, de modo que o produto interno que a pgvector calcula
 * (`1 - (a <=> b)`) já é a similaridade de cosseno. Consequências que tornam a
 * prova de acervo legível: textos sem nenhum termo em comum dão similaridade 0,
 * e um termo inventado semeado só num tenant é um eixo que só aquele tenant
 * ocupa.
 *
 * NÃO é semântico e não finge ser: não acha sinônimo nem paráfrase. Serve para
 * provar RECORTE (quais linhas voltam e de quem), que é o que §5.10 mede; a
 * qualidade do ranking é assunto do modelo real, item humano com orçamento (D12).
 *
 * Texto sem termo algum ocupa o balde 0 em vez de devolver o vetor nulo: o
 * operador `<=>` da pgvector é indefinido para norma zero, e uma pergunta em
 * branco viraria NaN no lugar de "não achei nada".
 */
export function embutirDeterministico(texto: string): number[] {
  const vetor = new Array<number>(DIMENSOES_DO_EMBEDDING).fill(0);
  const lista = termos(texto);
  if (lista.length === 0) {
    vetor[0] = 1;
    return vetor;
  }
  for (const termo of lista) {
    const balde = fnv1a(termo) % DIMENSOES_DO_EMBEDDING;
    vetor[balde] = (vetor[balde] ?? 0) + 1;
  }
  const norma = Math.sqrt(vetor.reduce((soma, v) => soma + v * v, 0));
  return norma === 0 ? vetor : vetor.map((v) => v / norma);
}

/**
 * O "ping" de §5.10 invariante 1, como FUNÇÃO e não como `process.exit`: quem
 * sobe o processo decide o que fazer com a falha (o boot sai com código 2; um
 * teste falha a asserção). Dimensão errada aqui é a falha mais cara do módulo —
 * ela não dá erro, só faz o acervo parecer vazio.
 */
export function conferirDimensao(embutidor: Embutidor = embutirDeterministico): number {
  const tamanho = embutidor("ping").length;
  if (tamanho !== DIMENSOES_DO_EMBEDDING) {
    throw new Error(
      `embedding com ${tamanho} dimensões; o acervo é vector(${DIMENSOES_DO_EMBEDDING}) (ADR-002)`,
    );
  }
  return tamanho;
}

/** O literal que a pgvector aceita como `vector`. */
export function comoVetorSql(vetor: readonly number[]): string {
  return `[${vetor.join(",")}]`;
}
