/**
 * F15-T05 — reindexação INCREMENTAL de um material do acervo (ADR-036 §2 T05,
 * D54 f).
 *
 * `ingerirDocumento` (F04-T03) cria material + versão 1 e embute todo trecho.
 * Aqui um material EXISTENTE recebe uma versão nova a partir do texto novo:
 * trecho cujo `content_hash` (md5 do conteúdo) já existe na versão ativa
 * reaproveita o embedding gravado — zero chamada ao embutidor —; só o trecho
 * alterado/novo é embutido. A versão nova só vira a ativa depois de todos os
 * trechos entrarem (mesma janela de `ingerirDocumento`), e a RPC de busca
 * (`fn_buscar_trechos_das_fontes`) só enxerga `active_kb_version_id`; os
 * trechos da versão antiga são apagados (a versão fica, `is_active=false`,
 * como histórico do que foi indexado).
 *
 * O que se mede: `reindexed=N` (trechos embutidos) e `unchanged_skipped=M`
 * (trechos copiados), com denominador = trechos do texto novo.
 */
import { createHash } from "node:crypto";

import type { TenantCtx } from "@/src/tenant-context/types";
import { withTenant, type TenantDb } from "@/src/tenant-context/with-tenant";

import { comoVetorSql, embutirDeterministico, DIMENSOES_DO_EMBEDDING, MODELO_DE_EMBEDDING } from "./embedding";
import { DocumentoGrandeDemais, DocumentoVazio, partirEmTrechos, TRECHOS_MAXIMOS, type DepsDaIngestao, type DocumentoDoAcervo } from "./ingestao";

export class MaterialNaoEncontrado extends Error {
  constructor(public readonly id: string) {
    super(`material ${id} não existe nesta organização`);
    this.name = "MaterialNaoEncontrado";
  }
}

export interface ResultadoDaReindexacao {
  readonly material_id: string;
  readonly version_id: string;
  readonly version_number: number;
  readonly trechos: number;
  /** Trechos embutidos de novo (conteúdo novo ou alterado). */
  readonly reindexed: number;
  /** Trechos cujo hash já existia na versão ativa: embedding copiado, sem chamada. */
  readonly unchanged_skipped: number;
}

export async function reindexarDocumento(
  ctx: TenantCtx,
  materialId: string,
  documento: Pick<DocumentoDoAcervo, "conteudo">,
  deps: DepsDaIngestao = {},
): Promise<ResultadoDaReindexacao> {
  const trechos = partirEmTrechos(documento.conteudo);
  if (trechos.length === 0) throw new DocumentoVazio();
  if (trechos.length > TRECHOS_MAXIMOS) throw new DocumentoGrandeDemais(trechos.length);
  const embutir = deps.embutir ?? embutirDeterministico;

  return withTenant(
    ctx,
    async (db) => {
      const material = await db.query<{ active_kb_version_id: string | null }>(
        `select active_kb_version_id from public.ai_knowledge_sources
          where id = $1 and organization_id = $2 and is_active and status = 'ready'
          for update`,
        [materialId, ctx.organization_id],
      );
      if (material.rows.length === 0) throw new MaterialNaoEncontrado(materialId);
      const versaoAntiga = material.rows[0]!.active_kb_version_id;

      // Os embeddings que já existem, por hash — a memória do que já foi pago.
      const existentes = new Map<string, string>();
      if (versaoAntiga !== null) {
        const { rows } = await db.query<{ content_hash: string; embedding: string }>(
          `select content_hash, embedding::text as embedding from public.ai_chunks
            where organization_id = $1 and kb_version_id = $2`,
          [ctx.organization_id, versaoAntiga],
        );
        for (const r of rows) existentes.set(r.content_hash, r.embedding);
      }

      const numero = await proximaVersao(db, ctx, materialId);
      const versaoNova = await inserirVersao(db, ctx, materialId, numero, trechos.length);
      let reindexed = 0;
      let unchanged = 0;
      for (const [posicao, conteudo] of trechos.entries()) {
        const hash = md5Hex(conteudo);
        const copiado = existentes.get(hash);
        const vetor = copiado ?? comoVetorSql(embutir(conteudo));
        if (copiado === undefined) reindexed += 1;
        else unchanged += 1;
        await db.query(
          `insert into public.ai_chunks
             (organization_id, knowledge_source_id, kb_version_id, position, content, content_hash, token_count, embedding)
           values ($1,$2,$3,$4,$5,$6,$7,$8::vector)`,
          [ctx.organization_id, materialId, versaoNova, posicao, conteudo, hash, conteudo.split(/\s+/).filter(Boolean).length, vetor],
        );
      }

      // A troca de versão ativa: a antiga sai ANTES (índice único "uma ativa
      // por fonte"), a nova entra, e a fonte aponta para ela — tudo na mesma
      // transação, então a busca nunca vê meio material.
      if (versaoAntiga !== null) {
        await db.query(`update public.ai_knowledge_versions set is_active = false where id = $1 and organization_id = $2`, [versaoAntiga, ctx.organization_id]);
      }
      await db.query(`update public.ai_knowledge_versions set is_active = true, status = 'ready' where id = $1 and organization_id = $2`, [versaoNova, ctx.organization_id]);
      await db.query(
        `update public.ai_knowledge_sources
            set active_kb_version_id = $1, chunks_count = $2, last_indexed_at = now(), last_index_status = 'success'
          where id = $3 and organization_id = $4`,
        [versaoNova, trechos.length, materialId, ctx.organization_id],
      );
      if (versaoAntiga !== null) {
        await db.query(`delete from public.ai_chunks where organization_id = $1 and kb_version_id = $2`, [ctx.organization_id, versaoAntiga]);
      }
      return { material_id: materialId, version_id: versaoNova, version_number: numero, trechos: trechos.length, reindexed, unchanged_skipped: unchanged };
    },
    deps,
  );
}

function md5Hex(texto: string): string {
  // `md5()` do Postgres é o que `ingerirDocumento` grava; o mesmo hash aqui,
  // calculado em Node, mantém as duas escritas comparáveis.
  return createHash("md5").update(texto, "utf8").digest("hex");
}

async function proximaVersao(db: TenantDb, ctx: TenantCtx, materialId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select coalesce(max(version_number), 0)::text as n from public.ai_knowledge_versions
      where organization_id = $1 and knowledge_source_id = $2`,
    [ctx.organization_id, materialId],
  );
  return Number(rows[0]?.n ?? 0) + 1;
}

async function inserirVersao(db: TenantDb, ctx: TenantCtx, fonte: string, numero: number, total: number): Promise<string> {
  const gravado = await db.query<{ id: string }>(
    `insert into public.ai_knowledge_versions
       (organization_id, agent_id, knowledge_source_id, version_number, is_active, status, embedding_model, embedding_dims, total_chunks, indexed_at)
     values ($1, null, $2, $3, false, 'building', $4, $5, $6, now())
     returning id`,
    [ctx.organization_id, fonte, numero, MODELO_DE_EMBEDDING, DIMENSOES_DO_EMBEDDING, total],
  );
  const id = gravado.rows[0]?.id;
  if (id === undefined) throw new Error("ai_knowledge_versions não devolveu id da versão");
  return id;
}
