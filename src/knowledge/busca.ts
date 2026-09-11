/**
 * Busca no acervo — com escopo de ORGANIZAÇÃO (§5.10, F04-T03, ADR-021 dec. 4).
 *
 * ─── O que este arquivo ADAPTA, e o que ele NÃO recria ─────────────────────
 *
 * `docs/migration/target-state.md:115` manda ADAPTAR: as tabelas continuam
 * `ai_chunks` (vector(1536)) e `ai_knowledge_sources`, e o motor continua a RPC
 * `fn_buscar_trechos_das_fontes` (`supabase/baseline.sql`), que é
 * `SECURITY DEFINER` e filtra `c.organization_id = p_organization_id` DENTRO do
 * banco. Esse filtro é a garantia de isolamento e não muda aqui — o mutante
 * `tests/mutants/42-f04-acervo-filtro-de-organizacao.sh` existe para que
 * removê-lo fique vermelho.
 *
 * O que muda é o RECORTE: o RAG herdado só sabia responder "os materiais DESTE
 * agente" (`lib/ai/knowledge/busca.ts:124-164`, que continua sendo o dono dessa
 * resolução). §5.10 quer o acervo da ORGANIZAÇÃO. Como `agent_id` é anulável, o
 * acervo do tenant é simplesmente "todas as fontes ativas e prontas da
 * organização" — uma lista a mais para a MESMA RPC, não uma segunda busca.
 *
 * ─── Por que `withTenant` e não o SupabaseClient ───────────────────────────
 *
 * §5.10 diz "busca pgvector via `withTenant`". O caminho herdado fala por
 * PostgREST com a chave de serviço; o turno SaaS já vive dentro de `withTenant`
 * (§5.1, D20), que abre transação e publica `app.organization_id`. Usar o mesmo
 * caminho evita uma segunda forma de conectar e deixa a busca herdar o tenant do
 * contexto em vez de recebê-lo por parâmetro de quem chama.
 *
 * ─── Duas defesas, de propósito ────────────────────────────────────────────
 *
 * A lista de fontes é resolvida com `organization_id` no predicado E a RPC
 * filtra por organização. Não é redundância desatenta: a lista pode chegar de
 * fora (`ai_agent_versions.knowledge_source_ids` é uma coluna `uuid[]`, que uma
 * escrita errada pode encher com id alheio), e é EXATAMENTE esse caso que o
 * filtro da RPC existe para barrar. A prova de acervo faz uma consulta
 * adversária com a lista envenenada, justamente para que a segunda defesa seja
 * medida em vez de suposta.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import {
  comoVetorSql,
  embutirDeterministico,
  MODELO_DE_EMBEDDING,
  type Embutidor,
} from "./embedding";

export interface TrechoEncontrado {
  chunk_id: string;
  knowledge_source_id: string | null;
  /** Nome do material de onde o trecho saiu — a resposta cita a origem. */
  source_name: string | null;
  content: string;
  similarity: number;
}

export interface ResultadoDaBusca {
  /** Trechos acima do limiar, do mais parecido para o menos. */
  trechos: TrechoEncontrado[];
  /**
   * Similaridade do MELHOR candidato, mesmo reprovado no limiar. Sem este
   * número, "a base não tem essa informação" e "a base tem algo perto, mas não o
   * bastante" chegam iguais a quem pergunta — e pedem ações opostas.
   */
  melhorSimilaridade: number | null;
  /** Quantos materiais o recorte alcançou. Zero = acervo vazio, não falha. */
  fontesConsultadas: number;
}

/**
 * QUAIS materiais esta consulta pode ler.
 *
 * - `fontes`: lista explícita (é o que a versão publicada do agente produz).
 * - ausente: o acervo da ORGANIZAÇÃO inteira — todas as fontes ativas e prontas.
 */
export interface EscopoDoAcervo {
  fontes?: readonly string[];
}

export interface ParametrosDaBusca {
  pergunta: string;
  topK: number;
  /** Piso de similaridade de cosseno para o trecho contar como achado. */
  limiar: number;
  escopo?: EscopoDoAcervo;
}

export interface DepsDaBusca {
  pool?: ServicePool;
  /** Fase 1: determinístico e local. A produção injeta o modelo real (D12). */
  embutir?: Embutidor;
}

interface LinhaDaRpc {
  chunk_id: string;
  knowledge_source_id: string | null;
  source_name: string | null;
  content: string;
  similarity: number | string;
}

/**
 * Piso REAL da similaridade de cosseno (1 − distância, distância em [0,2]).
 * Pedimos à RPC SEM limiar e cortamos aqui para conseguir enxergar o melhor
 * candidato reprovado — a RPC sozinha devolveria lista vazia sem dizer se faltou
 * pouco ou se não há nada parecido. Mesma escolha de `lib/ai/knowledge/busca.ts`.
 */
const PISO = -1;

/**
 * O acervo da organização: toda fonte ativa e pronta do tenant do contexto.
 *
 * `status = 'ready'` e `is_active` repetem o que a RPC já exige, e isso é
 * deliberado: sem eles a lista incluiria material em indexação, a RPC o
 * descartaria, e `fontesConsultadas` mentiria sobre o alcance da busca.
 */
export async function resolverAcervoDaOrganizacao(
  ctx: TenantCtx,
  deps: DepsDaBusca = {},
): Promise<string[]> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select id
           from public.ai_knowledge_sources
          where organization_id = $1
            and is_active
            and status = 'ready'
          order by created_at, id`,
        [ctx.organization_id],
      );
      return rows.map((r) => r.id);
    },
    deps,
  );
}

/**
 * Top-K do acervo, sempre dentro do tenant do contexto.
 *
 * Acervo vazio devolve resultado vazio em vez de chamar a RPC com lista vazia:
 * `s.id = any('{}')` nunca casa, e gastar uma ida ao banco para descobrir isso
 * é custo por nada.
 */
export async function buscar(
  ctx: TenantCtx,
  p: ParametrosDaBusca,
  deps: DepsDaBusca = {},
): Promise<ResultadoDaBusca> {
  const fontes = p.escopo?.fontes
    ? [...p.escopo.fontes]
    : await resolverAcervoDaOrganizacao(ctx, deps);

  if (fontes.length === 0) {
    return { trechos: [], melhorSimilaridade: null, fontesConsultadas: 0 };
  }

  const embutir = deps.embutir ?? embutirDeterministico;
  const vetor = comoVetorSql(embutir(p.pergunta));

  const linhas = await withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<LinhaDaRpc>(
        `select chunk_id, knowledge_source_id, source_name, content, similarity
           from public.fn_buscar_trechos_das_fontes($1, $2::uuid[], $3::vector, $4, $5, $6)`,
        [ctx.organization_id, fontes, vetor, p.topK, PISO, MODELO_DE_EMBEDDING],
      );
      return rows;
    },
    deps,
  );

  // `real` do Postgres pode chegar como string dependendo do serializador.
  const comNumero = linhas.map((l) => ({
    chunk_id: l.chunk_id,
    knowledge_source_id: l.knowledge_source_id,
    source_name: l.source_name,
    content: l.content,
    similarity: Number(l.similarity),
  }));

  return {
    trechos: comNumero.filter((l) => l.similarity >= p.limiar),
    melhorSimilaridade:
      comNumero.length > 0 ? Math.max(...comNumero.map((l) => l.similarity)) : null,
    fontesConsultadas: fontes.length,
  };
}
