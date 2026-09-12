/**
 * F04-T03 — o acervo é da ORGANIZAÇÃO, e nenhuma pergunta atravessa o tenant
 * (§5.10; ADR-021 decisão 4; ADR-023).
 *
 * ─── O que está sendo medido, e por que contra Postgres de verdade ─────────
 *
 * `fn_buscar_trechos_das_fontes` é `SECURITY DEFINER` e filtra por organização
 * DENTRO do banco; a pgvector calcula a similaridade. Nada disso tem
 * equivalente em memória — um fake aqui só provaria que o fake concorda com o
 * teste.
 *
 * ─── Três fatos medidos que este arquivo confirma ──────────────────────────
 *
 * 1. `ai_knowledge_sources.agent_id` já é ANULÁVEL neste baseline (a migration
 *    0181 fez isso; o `NOT NULL` do corpo do `pg_dump` é estado antigo, curado
 *    pelo apêndice mais adiante no mesmo arquivo). Sem isso não existe acervo da
 *    organização — e a F04-T03 não precisou de tabela nova por causa disso.
 * 2. O índice `(agent_id, source_type) where is_active` NÃO existe mais: com
 *    `agent_id` nulo ele deixaria de recortar o que prometia.
 * 3. `ai_chunks`/`ai_knowledge_sources` continuam sendo as tabelas — ADAPTAR,
 *    não recriar (ADR-023). Nenhuma tabela de conhecimento nasce nesta task.
 *
 * ─── A consulta ADVERSÁRIA ────────────────────────────────────────────────
 *
 * Quatro das cinco consultas usam o acervo resolvido pela organização, que já
 * vem filtrado. A quinta entrega DE PROPÓSITO uma lista de fontes envenenada
 * com o material do outro tenant — é o caso que o filtro da RPC existe para
 * barrar (`ai_agent_versions.knowledge_source_ids` é uma coluna `uuid[]`, que
 * uma escrita errada enche com id alheio). Sem essa consulta, o mutante
 * `tests/mutants/42-f04-acervo-filtro-de-organizacao.sh` sabotaria o filtro sem
 * que nada ficasse vermelho — e a "garantia de isolamento" seria suposição.
 *
 * Nada sai para rede: o embutidor é determinístico e local.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buscar, comoVetorSql, embutirDeterministico, MODELO_DE_EMBEDDING, resolverAcervoDaOrganizacao } from "@/src/knowledge";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

/** Duas organizações FICTÍCIAS — nenhum dado de cliente real (D06/D21). */
const ORG_A = "f0403333-0000-4000-8000-00000000000a";
const ORG_B = "f0403333-0000-4000-8000-00000000000b";

const ctxA: TenantCtx = { organization_id: ORG_A, source: "job" };

/**
 * Os materiais. `agent_id` NULO em todos: é exatamente isto que "acervo da
 * organização" quer dizer no schema herdado.
 */
const MATERIAIS = [
  {
    org: ORG_A,
    fonte: "f0403333-1000-4000-8000-00000000000a",
    versao: "f0403333-2000-4000-8000-00000000000a",
    nome: "Entregas e prazos",
    tipo: "policy",
    trechos: [
      "o prazo de entrega para Campinas e de dois dias uteis",
      "entregas em Valinhos saem as tercas e quintas pela manha",
    ],
  },
  {
    org: ORG_A,
    fonte: "f0403333-1000-4000-8000-00000000001a",
    versao: "f0403333-2000-4000-8000-00000000001a",
    nome: "Catálogo de cafés",
    tipo: "catalog",
    trechos: ["o cafe torrado premium e vendido em pacotes de um quilo"],
  },
  {
    org: ORG_B,
    fonte: "f0403333-1000-4000-8000-00000000000b",
    versao: "f0403333-2000-4000-8000-00000000000b",
    nome: "Operação interna",
    tipo: "policy",
    // O FATO PLANTADO: o termo não aparece em nenhum material da A.
    trechos: ["o codigo do armazem central e xilofonequantico e ele nao sai daqui"],
  },
] as const;

/** As cinco consultas da prova. A quinta é a adversária. */
const CONSULTAS = [
  { pergunta: "prazo de entrega para Campinas", adversaria: false },
  { pergunta: "cafe torrado premium pacotes", adversaria: false },
  { pergunta: "xilofonequantico", adversaria: false },
  { pergunta: "codigo do armazem central", adversaria: false },
  { pergunta: "xilofonequantico codigo do armazem", adversaria: true },
] as const;

const docsDe = (org: string) => MATERIAIS.filter((m) => m.org === org).length;

const umValor = async <T>(sql: string, valores: unknown[] = []): Promise<T | null> => {
  const r = await pool.query<{ v: T }>(sql, valores);
  return r.rows[0]?.v ?? null;
};

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const [i, org] of [ORG_A, ORG_B].entries()) {
      await client.query(
        `insert into public.organizations (id, slug, legal_name, display_name, status)
         values ($1,$2,$3,$3,'active')`,
        [org, `f04-acervo-${i}`, `F04 Acervo ${i}`],
      );
    }
    for (const m of MATERIAIS) {
      await client.query(
        `insert into public.ai_knowledge_sources
           (id, organization_id, agent_id, source_type, name, is_active, status)
         values ($1,$2,null,$3,$4,true,'ready')`,
        [m.fonte, m.org, m.tipo, m.nome],
      );
      await client.query(
        `insert into public.ai_knowledge_versions
           (id, organization_id, agent_id, knowledge_source_id, version_number,
            is_active, status, embedding_model, embedding_dims)
         values ($1,$2,null,$3,1,true,'ready',$4,1536)`,
        [m.versao, m.org, m.fonte, MODELO_DE_EMBEDDING],
      );
      await client.query(
        `update public.ai_knowledge_sources set active_kb_version_id = $1 where id = $2`,
        [m.versao, m.fonte],
      );
      for (const [posicao, texto] of m.trechos.entries()) {
        await client.query(
          `insert into public.ai_chunks
             (organization_id, knowledge_source_id, kb_version_id, position, content,
              content_hash, token_count, embedding)
           values ($1,$2,$3,$4,$5,md5($5),$6,$7::vector)`,
          [
            m.org,
            m.fonte,
            m.versao,
            posicao,
            texto,
            texto.split(" ").length,
            comoVetorSql(embutirDeterministico(texto)),
          ],
        );
      }
    }
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("F04-T03: o schema suporta acervo da organização (ADAPTAR, não recriar)", () => {
  it("ai_knowledge_sources.agent_id é anulável e o único por agente não existe", async () => {
    // Arrange + Act
    const anulavel = await umValor<string>(
      `select is_nullable as v from information_schema.columns
        where table_schema='public' and table_name='ai_knowledge_sources' and column_name='agent_id'`,
    );
    const indice = await umValor<string>(
      `select indexname as v from pg_indexes
        where schemaname='public' and indexname='ai_knowledge_sources_unique_per_agent'`,
    );

    // Assert
    expect(anulavel, "agent_id NOT NULL: acervo da organização não cabe no schema").toBe("YES");
    expect(indice).toBeNull();
  });

  it("nenhuma tabela de conhecimento nova: as herdadas continuam sendo as tabelas", async () => {
    // Arrange + Act
    const herdadas = await umValor<number>(
      `select count(*)::int as v from pg_tables
        where schemaname='public' and tablename in ('ai_chunks','ai_knowledge_sources')`,
    );
    const redundantes = await umValor<number>(
      `select count(*)::int as v from pg_tables
        where schemaname='public' and tablename in ('knowledge_documents','knowledge_chunks')`,
    );

    // Assert
    expect(herdadas).toBe(2);
    expect(redundantes, "tabela redundante criada só para engordar um contador (ADR-023)").toBe(0);
  });

  it("o acervo da organização são as fontes ATIVAS dela, e só as dela", async () => {
    // Arrange + Act
    const fontesDeA = await resolverAcervoDaOrganizacao(ctxA, { pool });

    // Assert
    expect(fontesDeA.sort()).toEqual(
      MATERIAIS.filter((m) => m.org === ORG_A)
        .map((m) => m.fonte)
        .sort(),
    );
  });
});

describe("F04-T03: cinco consultas da organização A, zero trecho da B", () => {
  it("knowledge: docs_a=2 docs_b=1 consultas=5 cross_tenant_hits=0/R", async () => {
    // Arrange — as fontes da B, para a consulta adversária
    const fontesDeB = MATERIAIS.filter((m) => m.org === ORG_B).map((m) => m.fonte);
    const fontesDeA = await resolverAcervoDaOrganizacao(ctxA, { pool });

    // Act
    const achados: string[] = [];
    for (const consulta of CONSULTAS) {
      const resultado = await buscar(
        ctxA,
        {
          pergunta: consulta.pergunta,
          topK: 10,
          limiar: 0.1,
          // A adversária entrega a lista ENVENENADA: as fontes da A mais as da B.
          ...(consulta.adversaria ? { escopo: { fontes: [...fontesDeA, ...fontesDeB] } } : {}),
        },
        { pool },
      );
      achados.push(...resultado.trechos.map((t) => t.chunk_id));
    }

    // Assert — a procedência de cada trecho é lida do banco, não do código sob
    // prova: perguntar ao próprio módulo de quem é o trecho seria pedir ao réu
    // que testemunhasse.
    const total = achados.length;
    const doOutroTenant =
      total === 0
        ? 0
        : Number(
            (
              await pool.query<{ v: string }>(
                `select count(*)::int as v from public.ai_chunks
                  where id = any($1::uuid[]) and organization_id <> $2`,
                [achados, ORG_A],
              )
            ).rows[0]?.v ?? 0,
          );

    expect(total, "cinco consultas não acharam nada: o denominador seria vazio (G-03)").toBeGreaterThan(0);
    expect(doOutroTenant, "trecho de outra organização vazou para a busca").toBe(0);

    const linha =
      `knowledge: docs_a=${docsDe(ORG_A)} docs_b=${docsDe(ORG_B)} ` +
      `consultas=${CONSULTAS.length} chunks=${total} cross_tenant_hits=${doOutroTenant}/${total}`;
    console.log(linha);
    gravarLinhaDoVerify("knowledge", linha);
  });

  it("o fato semeado só na B é ACHÁVEL de dentro da B — a busca não está muda", async () => {
    // Arrange — controle positivo: sem ele, "zero vazamento" ficaria verde
    // também se a busca simplesmente não devolvesse nada para ninguém.
    const ctxB: TenantCtx = { organization_id: ORG_B, source: "job" };

    // Act
    const daB = await buscar(ctxB, { pergunta: "xilofonequantico", topK: 5, limiar: 0.1 }, { pool });
    const daA = await buscar(ctxA, { pergunta: "xilofonequantico", topK: 5, limiar: 0.1 }, { pool });

    // Assert
    expect(daB.trechos.length).toBeGreaterThan(0);
    expect(daB.trechos[0]?.content).toContain("xilofonequantico");
    expect(daA.trechos).toHaveLength(0);
  });

  it("organização sem acervo devolve vazio, não erro nem acervo alheio", async () => {
    // Arrange
    const vazia: TenantCtx = {
      organization_id: "f0403333-0000-4000-8000-00000000000c",
      source: "job",
    };
    await pool.query(
      `insert into public.organizations (id, slug, legal_name, display_name, status)
       values ($1,'f04-acervo-vazio','F04 Acervo vazio','F04 Acervo vazio','active')
       on conflict (id) do nothing`,
      [vazia.organization_id],
    );

    // Act
    const r = await buscar(vazia, { pergunta: "xilofonequantico", topK: 5, limiar: 0.1 }, { pool });

    // Assert
    expect(r.fontesConsultadas).toBe(0);
    expect(r.trechos).toHaveLength(0);
    expect(r.melhorSimilaridade).toBeNull();
  });
});
