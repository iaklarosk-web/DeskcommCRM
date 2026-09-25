# ADR-023 — Acervo por organização sobre as tabelas herdadas, e um preço só

## Contexto

Duas tasks da F04 se cruzam num ponto: onde mora o número que diz o que a
organização tem e o que ela gastou.

**F04-T03 (acervo).** §5.10 quer acervo da ORGANIZAÇÃO. O enunciado de §7.5
descreve a entrega como `knowledge_documents` e `knowledge_chunks` por tenant e
fecha com `isolation: tables +2`. Só que `docs/migration/target-state.md:115`
decidiu **ADAPTAR**: `ai_chunks` (`vector(1536)`) e `ai_knowledge_sources` ficam,
`ai_knowledge_sources.agent_id` deixa de ser `NOT NULL`. As duas frases não
podem valer ao mesmo tempo — ou nascem duas tabelas e o contador cresce dois, ou
o acervo reusa as herdadas e o contador não cresce.

MEDIDO no baseline desta branch, contra Postgres com o `baseline.sql` aplicado:

- `ai_knowledge_sources.agent_id` **já é anulável**. A migration 0181
  (`supabase/baseline.sql`, apêndice "o acervo é da organização") executa
  `alter column agent_id drop not null` e troca a FK para `on delete set null`.
  O `NOT NULL` que se lê no corpo do `pg_dump` (`CREATE TABLE … "agent_id" "uuid"
  NOT NULL`) é estado ANTIGO, corrigido mais adiante no MESMO arquivo.
- O índice `ai_knowledge_sources_unique_per_agent (agent_id, source_type) where
  is_active` **já não existe**: a mesma 0181 o derruba.
- `ai_knowledge_versions.agent_id` também já é anulável, pelo mesmo apêndice —
  sem isso, material sem agente não teria como ser indexado.

Ou seja: o schema já suporta acervo de organização. O que faltava era o
RECORTE — a busca só sabia responder "os materiais DESTE agente".

**F04-T08 (consumo).** Havia duas contabilidades sem vínculo e duas tabelas de
preço: `llm_calls`, escrita dentro de `runModelCall`
(`lib/agent-engine/edge/llm/run-model-call.ts`) e lida pelo orçamento
(`lib/ai/budget/check.ts`), cotada por `lib/agent-engine/edge/llm/pricing.ts`
(USD por milhão, três modelos Claude); e `ai_usage_events` (F01-T08), **sem
nenhum chamador de produção**, cotada por `src/entitlement/pricing.ts` (cents por
mil, três modelos OpenAI).

## Decisão

1. **Uma tabela de preço, e é a do motor.** `src/entitlement/pricing.ts` deixa de
   ter tabela e vira fachada de `lib/agent-engine/edge/llm/pricing.ts`. As três
   linhas OpenAI mudam de arquivo, convertidas de unidade, com o mesmo valor. A
   escolhida é a do motor porque já é a que cota `llm_calls.cost_cents` — de onde
   o orçamento lê — e porque casa por PREFIXO, que é o que o sufixo de data dos
   vendors exige. O casamento passa a ser pelo MAIOR prefixo: com `gpt-4o` e
   `gpt-4o-mini` na mesma tabela, a ordem de inserção do objeto decidia o preço, e
   o mini podia ser cotado 16× mais caro em silêncio.
2. **`ai_usage_events` é projeção de `llm_calls`, não segunda cobrança.**
   `runModelCall` continua o único lugar que fala com o provedor e grava as duas
   linhas no MESMO statement (um CTE que escreve nas duas tabelas). A coluna nova
   `llm_call_id` (FK, com índice único parcial) amarra uma linha à outra:
   contagem igual deixa de ser coincidência e dupla contagem vira erro 23505.
   `estimated_cost_cents` passa de `int` a `numeric` para caber o mesmo número
   que a fonte guarda.
3. **A guarda continua sendo `withEntitlement`, e ela NÃO grava.**
   `src/ai/chamada.ts` é a porta do turno SaaS: pergunta ao entitlement antes,
   chama `runModelCall` no meio e devolve `{ result }` **sem `usage`**. Negado,
   `runModelCall` não é alcançado e nenhum byte sai (D36).
4. **O acervo da organização NÃO cria tabela.** A busca do turno SaaS
   (`src/knowledge/busca.ts`) aceita, além da lista explícita por agente, "todas
   as fontes ativas e prontas da organização" — uma lista a mais para a MESMA RPC
   `fn_buscar_trechos_das_fontes`. O filtro de `organization_id` dela não muda.
5. **Reconciliação do `isolation: tables +2`.** O contador de tabelas do
   `isolation` **não cresce dois** com a F04-T03. O `+2` do enunciado pressupunha
   `knowledge_documents`/`knowledge_chunks`; o target-state decidiu ADAPTAR, e
   criar tabela redundante para satisfazer um número seria trocar uma superfície
   provada (quatro tabelas de RAG com policies, RPC `SECURITY DEFINER` e prova
   comportamental em `tests/invariants/rag-acervo-da-organizacao.test.ts`) por
   outra sem prova — e ainda deixar duas verdades sobre onde mora o acervo. A
   migration 9018 reprova se `ai_chunks` ou a RPC sumirem, e a prova de acervo
   reprova se `knowledge_documents`/`knowledge_chunks` aparecerem.

## Alternativas rejeitadas

- **Criar `knowledge_documents`/`knowledge_chunks` para fechar o `+2`.** Dois
  acervos, dois caminhos de ingestão, dois lugares para o `organization_id`
  vazar. O número do enunciado descreveria o schema, e o schema descreveria duas
  verdades.
- **Manter as duas tabelas de preço e "só conferir que batem".** Bater hoje não
  é bater amanhã: quem adiciona um modelo adiciona numa, e a divergência aparece
  na fatura, não no teste. Duas fontes com uma prova de igualdade são duas fontes.
- **Ligar `withEntitlement` por fora de `runModelCall`** (a forma que a
  assinatura convida). Contaria a MESMA chamada duas vezes, com duas fórmulas, e
  o orçamento continuaria vendo só `llm_calls`. É o defeito que ADR-021 nomeia; o
  mutante `tests/mutants/43-f04-consumo-em-dobro.sh` existe porque ele não quebra
  nada visível.
- **Abrir transação explícita (`db.connect()` + `begin`) para as duas escritas.**
  Corretíssimo e caro: o seam recebe `pg.Pool` de chamadores que injetam fakes só
  com `query` (nove arquivos de teste do motor), e a mudança os quebraria sem
  ganho — um statement único já é atômico.
- **Apagar `agent_id` de `ai_knowledge_sources`.** A coluna tem leitores (a tela
  do agente, a ingestão, o backfill de `knowledge_source_ids`); anulável preserva
  o acervo por agente que existe e acrescenta o do tenant.
- **Reescrever a resolução por agente dentro de `src/knowledge/`.** Ela continua
  em `lib/ai/knowledge/busca.ts`, que é o dono dela e tem prova própria. O que
  nasce aqui é o recorte que não existia.

## Consequências

`isolation: tables` não cresce por causa da F04-T03; quem conferir o número
contra §7.5 encontra esta ADR. O acervo por organização passa a ter DOIS
recortes possíveis na mesma RPC — a lista do agente e a da organização — e a
prova de isolamento inclui uma consulta ADVERSÁRIA (lista de fontes envenenada
com material do outro tenant), porque sem ela o filtro da RPC ficaria não medido
e o mutante 42 não teria como ficar vermelho.

O livro-razão de uso passa a ter uma linha para cada `llm_calls` de sucesso.
Chamadas que FALHAM continuam gerando linha só em `llm_calls` (`status='erro'`):
o provedor pode ter consumido tokens, mas o SDK lançou e não há número honesto a
projetar — declarado como limite, não resolvido.

O registro de uso de embedding (`operation='embedding'`, §5.10 invariante 3)
continua sem chamador: o embutidor da Fase 1 é determinístico e local, sem
chamada a provedor. Quando o modelo real entrar (D12), quem o chamar registra
por `recordUsage`, com `llm_call_id` nulo — que é o caso para o qual o índice
único é parcial.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-023-acervo-por-organizacao.md`).
