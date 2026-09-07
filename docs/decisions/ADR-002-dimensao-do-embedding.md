# ADR-002 — Dimensão do embedding (pgvector) e modelo de embedding

## Contexto
D02 fixa o provedor de IA (OpenAI) e diz que o modelo de embedding é configuração (`AI_EMBEDDING_MODEL`), mas a dimensão do vetor congela o schema pgvector e por isso fecha na F00. O que o Deskcomm já tem, medido @ `c85f7d7`:

- Única coluna pgvector: `ai_chunks.embedding "public"."vector"(1536) NOT NULL` — `supabase/baseline.sql:1058` (tabela em `:1049`; índice ivfflat cosine em `:2518`). Confirmado no banco de dev depois de aplicar o baseline: `information_schema.columns` → `ai_chunks.embedding vector 1536`.
- Modelo e dimensão fixados em código: `MODELO_DE_EMBEDDING = "openai/text-embedding-3-small"` e `DIMENSOES_DO_EMBEDDING = 1536` — `lib/ai/embeddings/chave.ts:58-59`; `lib/ai/embed.ts:97` rejeita vetor com dimensão diferente; `lib/ai/gateway.ts:34` (`DEFAULT_EMBEDDING_MODEL`).
- Busca por tenant: RPC `fn_buscar_trechos_das_fontes` filtra `organization_id` no corpo (`supabase/baseline.sql:16644`); RPC legada `retrieve_top_k_chunks` idem (`:897`). Worker de chunking/indexação: `workers/rag-indexer.ts:498`.
- Metadados por versão de base: `ai_knowledge_versions.embedding_model/embedding_dims` (`baseline.sql:16466-16468`).
- O proprietário ainda não escolheu os modelos (Etapa 5 da §11 pendente; sem chave OpenAI no ambiente em 2026-09-07).

## Decisão
- **DIM = 1536**, herdada. A coluna `ai_chunks.embedding vector(1536)` e o índice ficam como estão.
- **Modelo de embedding (default): `text-embedding-3-small`** (OpenAI; no Deskcomm a string vai pelo gateway como `openai/text-embedding-3-small`). `AI_EMBEDDING_MODEL` (D02) nasce na F01 como env var lida em um único lugar e alimenta `MODELO_DE_EMBEDDING`; qualquer modelo configurado tem de produzir 1536 dimensões, e o boot verifica com o "ping" da §5.10 (`length === 1536`, senão sai com código 2).
- **Status: PROVISÓRIO** até o proprietário fechar a Etapa 5 (chave + modelos). Se ele escolher outro modelo com outra dimensão, esta ADR é substituída e o custo abaixo se aplica.

## Alternativas rejeitadas
- `text-embedding-3-large` (3072 dims): melhor recall, mas exige `alter column ... type vector(3072)`, reconstrução do índice e reindex de toda a base de todos os tenants; sem dado real da Deka ainda, não há evidência que justifique o custo.
- Modelo de embedding da Anthropic: não existe; o provedor de chat (Anthropic no gateway do Deskcomm) e o de embedding (OpenAI) são independentes, o que é compatível com D02.
- Dimensão dinâmica (coluna `vector` sem tamanho): pgvector aceita, mas o índice ivfflat/hnsw exige dimensão fixa e a §5.10 exige `vector(DIM)`.

## Consequências
- Custo de mudar depois: 1 migration (`alter table ai_chunks alter column embedding type vector(N)` + `drop/create index`), reindex de 100% dos `ai_chunks` de todos os tenants (1 chamada de embedding por chunk, contada em `ai_usage_events`), e atualização de `DIMENSOES_DO_EMBEDDING`.
- F01/F04 gravam `ai_usage_events(operation=embedding)` por chamada — hoje `embedText` não grava uso (achado C-3 da auditoria).
- Sem chave OpenAI, a F04 fecha com `AI_PROVIDER=mock` e a linha `OpenAI (chat + embedding)` do BUILD-STATE fica `NOT VALIDATED (real)` (D12).

## Data
2026-09-07

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-002-dimensao-do-embedding.md`).
