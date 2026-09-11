/**
 * INGESTÃO no acervo da ORGANIZAÇÃO (§5.10, F04-T10; ADR-021 decisão 4).
 *
 * ─── Por que existe, já que `lib/ai/rag/` ingere ───────────────────────────
 *
 * A ingestão herdada é do agente de lead: `lib/ai/rag/ingest/*` extrai o texto,
 * `workers/rag-indexer.ts` chunka e embeda em segundo plano, e o material nasce
 * amarrado a um `agent_id`. Para a tela de IA do tenant (F04-T10) isso é caro e
 * indireto: o `tenant_admin` sobe um documento e precisa VER que ele entrou no
 * acervo DA ORGANIZAÇÃO dele — não que uma fila vai processá-lo em algum
 * momento, e não no acervo de um agente que ele não configurou.
 *
 * O que nasce aqui é o caminho síncrono e escopado por organização: uma
 * transação, `agent_id = null` (o acervo do tenant, que a 0181 já permite), e o
 * mesmo par de tabelas que `src/knowledge/busca.ts` lê. Nenhuma tabela nova
 * (ADR-023).
 *
 * ─── O embutidor é PARÂMETRO ──────────────────────────────────────────────
 *
 * Fase 1 indexa com `embutirDeterministico` (ADR-002, D12): sem rede e sem
 * chave, o mesmo texto dá o mesmo vetor, e a busca acha o que acabou de entrar.
 * Quando o provedor real for ligado, ele entra por `deps.embutir` — e é por isso
 * que `ai_knowledge_versions.embedding_model` é gravado: um acervo indexado com
 * um modelo e consultado com outro não dá erro, só para de achar o próprio
 * conteúdo, que é a falha mais cara deste módulo.
 *
 * ─── O que este arquivo NÃO faz ───────────────────────────────────────────
 *
 * Não lê arquivo do disco, não fala com Storage e não extrai PDF: recebe TEXTO
 * já extraído. Quem converte bytes em texto é a rota (`app/api/v1/...`), que é
 * onde o limite de tamanho e o tipo de arquivo são política de borda.
 */
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import {
  comoVetorSql,
  embutirDeterministico,
  MODELO_DE_EMBEDDING,
  DIMENSOES_DO_EMBEDDING,
  type Embutidor,
} from "./embedding";

/** Alvo de tamanho de um trecho, em caracteres. */
export const TAMANHO_ALVO_DO_TRECHO = 700;

/** Teto de trechos por documento — acima disso é arquivo, não material. */
export const TRECHOS_MAXIMOS = 200;

/** O `source_type` do CHECK herdado que descreve material de política/texto. */
const TIPO_DE_MATERIAL = "policy";

export class DocumentoVazio extends Error {
  constructor() {
    super("documento sem texto aproveitável");
    this.name = "DocumentoVazio";
  }
}

export class DocumentoGrandeDemais extends Error {
  constructor(public readonly trechos: number) {
    super(`documento com ${trechos} trechos; o teto é ${TRECHOS_MAXIMOS}`);
    this.name = "DocumentoGrandeDemais";
  }
}

/**
 * Parte o texto em trechos.
 *
 * Quebra em PARÁGRAFOS primeiro e só então junta até o alvo: cortar por número
 * de caracteres direto partiria frase no meio, e um trecho que começa em "…dois
 * dias úteis." responde pior do que o parágrafo inteiro. Parágrafo maior que o
 * alvo é cortado em pedaços do tamanho do alvo — é o caso raro (tabela colada,
 * texto sem quebra) e vale mais indexá-lo picado do que descartá-lo.
 */
export function partirEmTrechos(texto: string): string[] {
  const paragrafos = texto
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter((p) => p.length > 0);

  const trechos: string[] = [];
  let acumulado = "";

  const fechar = () => {
    if (acumulado.length > 0) trechos.push(acumulado);
    acumulado = "";
  };

  for (const paragrafo of paragrafos) {
    if (paragrafo.length > TAMANHO_ALVO_DO_TRECHO) {
      fechar();
      for (let i = 0; i < paragrafo.length; i += TAMANHO_ALVO_DO_TRECHO) {
        trechos.push(paragrafo.slice(i, i + TAMANHO_ALVO_DO_TRECHO).trim());
      }
      continue;
    }
    const candidato = acumulado.length === 0 ? paragrafo : `${acumulado}\n${paragrafo}`;
    if (candidato.length > TAMANHO_ALVO_DO_TRECHO) {
      fechar();
      acumulado = paragrafo;
    } else {
      acumulado = candidato;
    }
  }
  fechar();
  return trechos.filter((t) => t.length > 0);
}

export interface DocumentoDoAcervo {
  readonly nome: string;
  /** Texto já extraído. Bytes e formato são política da borda, não daqui. */
  readonly conteudo: string;
}

export interface MaterialDoAcervo {
  readonly id: string;
  readonly nome: string;
  readonly trechos: number;
  readonly criado_em: string;
}

export interface DepsDaIngestao {
  pool?: ServicePool;
  embutir?: Embutidor;
}

/**
 * Põe um documento no acervo da organização do contexto.
 *
 * Tudo numa transação só: material, versão ativa e trechos. Um material sem
 * trechos seria um item na tela que a busca nunca alcança — pior que a recusa,
 * porque parece que funcionou.
 */
export async function ingerirDocumento(
  ctx: TenantCtx,
  documento: DocumentoDoAcervo,
  deps: DepsDaIngestao = {},
): Promise<MaterialDoAcervo> {
  const nome = documento.nome.trim();
  const trechos = partirEmTrechos(documento.conteudo);
  if (nome.length === 0 || trechos.length === 0) throw new DocumentoVazio();
  if (trechos.length > TRECHOS_MAXIMOS) throw new DocumentoGrandeDemais(trechos.length);

  const embutir = deps.embutir ?? embutirDeterministico;

  return withTenant(
    ctx,
    async (db) => {
      const fonte = await inserirMaterial(db, ctx, nome);
      const versao = await inserirVersao(db, ctx, fonte, trechos.length);

      for (const [posicao, conteudo] of trechos.entries()) {
        await db.query(
          `insert into public.ai_chunks
             (organization_id, knowledge_source_id, kb_version_id, position, content,
              content_hash, token_count, embedding)
           values ($1,$2,$3,$4,$5,md5($5),$6,$7::vector)`,
          [
            ctx.organization_id,
            fonte,
            versao,
            posicao,
            conteudo,
            conteudo.split(/\s+/).filter(Boolean).length,
            comoVetorSql(embutir(conteudo)),
          ],
        );
      }

      // A versão só vira a ATIVA depois que todos os trechos entraram: ativar
      // antes deixaria uma janela em que a busca enxerga meio material.
      await db.query(
        `update public.ai_knowledge_sources
            set active_kb_version_id = $1, chunks_count = $2,
                last_indexed_at = now(), last_index_status = 'success',
                ingested_at = now()
          where id = $3 and organization_id = $4`,
        [versao, trechos.length, fonte, ctx.organization_id],
      );

      const criadoEm = await db.query<{ created_at: string }>(
        `select created_at from public.ai_knowledge_sources
          where id = $1 and organization_id = $2`,
        [fonte, ctx.organization_id],
      );
      return {
        id: fonte,
        nome,
        trechos: trechos.length,
        criado_em: String(criadoEm.rows[0]?.created_at ?? ""),
      };
    },
    deps,
  );
}

async function inserirMaterial(db: TenantDb, ctx: TenantCtx, nome: string): Promise<string> {
  const gravado = await db.query<{ id: string }>(
    `insert into public.ai_knowledge_sources
       (organization_id, agent_id, source_type, name, is_active, status)
     values ($1, null, $2, $3, true, 'ready')
     returning id`,
    [ctx.organization_id, TIPO_DE_MATERIAL, nome],
  );
  const id = gravado.rows[0]?.id;
  if (id === undefined) throw new Error("ai_knowledge_sources não devolveu id do material");
  return id;
}

async function inserirVersao(
  db: TenantDb,
  ctx: TenantCtx,
  fonte: string,
  total: number,
): Promise<string> {
  const gravado = await db.query<{ id: string }>(
    `insert into public.ai_knowledge_versions
       (organization_id, agent_id, knowledge_source_id, version_number, is_active,
        status, embedding_model, embedding_dims, total_chunks, indexed_at)
     values ($1, null, $2, 1, true, 'ready', $3, $4, $5, now())
     returning id`,
    [ctx.organization_id, fonte, MODELO_DE_EMBEDDING, DIMENSOES_DO_EMBEDDING, total],
  );
  const id = gravado.rows[0]?.id;
  if (id === undefined) throw new Error("ai_knowledge_versions não devolveu id da versão");
  return id;
}

/**
 * O acervo da organização como a tela o mostra. Mesma pergunta de
 * `resolverAcervoDaOrganizacao`, com os campos que uma lista precisa — e o
 * MESMO predicado de organização, que é o que a tela do tenant A não pode
 * atravessar para ver o material do tenant B.
 */
export async function listarAcervo(
  ctx: TenantCtx,
  deps: DepsDaIngestao = {},
): Promise<MaterialDoAcervo[]> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<{
        id: string;
        name: string;
        chunks_count: number | string;
        created_at: string;
      }>(
        `select id, name, chunks_count, created_at
           from public.ai_knowledge_sources
          where organization_id = $1
            and is_active
            and status = 'ready'
          order by created_at desc, id`,
        [ctx.organization_id],
      );
      return rows.map((linha) => ({
        id: linha.id,
        nome: linha.name,
        trechos: Number(linha.chunks_count),
        criado_em: String(linha.created_at),
      }));
    },
    deps,
  );
}
