# ADR-029 — verify.sh v1.5 (F07 no gate; `replicability` por tenant do seed), loader do seed completo (§B13) e tenant efêmero

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-022](ADR-022-verify-v1.2.md), [ADR-024](ADR-024-verify-v1.3.md) e
[ADR-028](ADR-028-verify-v1.4-e-staging-nesta-vps.md). D25 permite mudança no
`verify.sh` só por ADR; §8.3 manda acrescentar campos, nunca remover. Decisões
de F07 que afetam mais de um módulo ficam aqui (AGENTS.md §8).

## Contexto

A F07 (§7.8) é a validação final em staging. Quatro coisas do documento
precisavam de decisão antes de o código existir:

1. **O verificador não conhece a F07.** `GATED_PHASES` termina em F06; sem a
   F07 no gate, `verify.sh` com `current_phase: F07` sai `NOT READY` por
   "fase ainda sem gate completo".
2. **`replicability` nunca foi medido como §8.3 pede.** Desde a F02 o bloco
   imprime `replicability: e2e[fictitious_A_B]=N/N specs=S/S grep_deka_in_src=0`:
   as dez specs do gate criam as PRÓPRIAS organizações fictícias (A e B) e as
   apagam ao fim. §7.8 T02 e §8.4 exigem
   `replicability: e2e[deka]=ok e2e[demo2]=ok src_diff_lines=0 grep_deka_in_src=0`
   — "e2e em deka e depois demo2 na mesma árvore, sem commit entre elas".
   O que "e2e em deka" significa numa suíte que provisiona a própria
   organização tinha de ser decidido.
3. **O loader do seed pula `products`, `customers` e `faq`** (VARREDURA §B13):
   `create-tenant.ts` avisa "entra na fase que adapta a tabela (F02/F04)" e as
   fases passaram. §7.8 T03 manda executar "como criar um tenant novo" ao pé da
   letra e §8.7 §6 documenta esse caminho: um tenant criado pelo seed nascia
   sem clientes, sem produtos e sem acervo, e o smoke do staging comparava
   contra as fixtures fictícias da F02 em vez do seed. O proprietário deixou a
   escolha ao agente ("decida por ADR se conserta o loader ou declara").
4. **Um tenant criado pelo seed cai no onboarding.** `app/app/layout.tsx:47`
   redireciona para `/onboarding` toda organização com `onboarded_at` nulo, e o
   loader nunca o preenche (medido no staging em 12/09/2026: `deka` e `demo2`
   com `onboarded_at` nulo; o smoke não percebia porque só usa a API). O
   `tenant_admin` de um tenant semeado — o do demo3 da T03, e o proprietário ao
   entrar pelo Tailscale — veria o assistente de onboarding em vez do produto.

## Decisão

### 1. verify.sh v1.5 — F07 entra no gate; o navegador roda duas vezes

- `F07` entra em `GATED_PHASES` e no inventário fechado com as MESMAS dez
  specs e 41 testes de F05/F06: a F07 não cria tela. O denominador provado não
  diminui (ADR-018).
- Na F07 o passo de navegador roda **duas vezes na mesma árvore, sem commit
  entre elas**: `E2E_TENANT=deka` e depois `E2E_TENANT=demo2`, cada uma com o
  inventário inteiro (`e2e-deka.json`, `e2e-demo2.json`, ambos conferidos
  contra o MESMO `e2e-plan.json`). Entre as duas, `scripts/verify/replicability.mjs`
  tira a árvore de `src/` (`git write-tree` sobre um índice temporário — a
  árvore de trabalho não é tocada) antes da primeira e depois da segunda
  execução; `src_diff_lines` é `git diff --numstat <antes> <depois>` somado,
  exatamente a fórmula de §8.3. `grep_deka_in_src` continua o que era.
- O campo passa a ser obrigatório a partir de F07 e sai assim:
  `replicability: e2e[deka]=ok e2e[demo2]=ok src_diff_lines=0 grep_deka_in_src=0 (deka=41/41 demo2=41/41 specs=10/10 org_a=seed-replica)`.
  Contrato: cada `e2e[<tenant>]` é `ok` só com o inventário inteiro passado
  limpo (mesma régua de `parseF02E2E`), `src_diff_lines=0`, `grep_deka_in_src=0`;
  qualquer coisa fora disso é `NOT READY`. A F06 e anteriores continuam
  imprimindo `fictitious_A_B` — não é reescrita de histórico.
- `e2e=` e `e2e_scope:` do bloco passam a refletir a PRIMEIRA execução (deka);
  a segunda está no campo `replicability`.
- `restore:`, `smoke:` e o tenant efêmero (§3 abaixo) continuam FORA do bloco,
  no BUILD-STATE, como ADR-028 §1 fixou para provas de operação.

### 2. O que "e2e em deka" significa: organização A provisionada DO SEED

Com `E2E_TENANT=<slug>`, a organização **A** de cada fixture das dez specs
deixa de ser um `insert` solto em `organizations` e passa a ser criada por
**`scripts/create-tenant.sh`** — o mesmo caminho de §8.7 §6 — a partir de
`docs/tenants/<slug>.seed.yaml`, com três diferenças mecânicas gravadas num
YAML temporário fora da árvore: `tenant.slug` vira `<slug>-e2e-<sufixo>`
(a organização é apagável ao fim, como hoje), `users` saem (a spec traz os
próprios humanos com senha pela API de auth; o seed não tem senha e o do deka
só tem `TODO-`), e `channel_accounts[].account_ref` ganha o sufixo (o índice
único é global). O resto do seed — nome, fuso, marca, `settings`, `products`,
`customers`, `faq` — entra como está, pelo loader. A organização **B** continua
fictícia: é o outro lado da prova de isolamento, não um tenant.

Duas specs pressupunham organização vazia e reprovaram com A vinda do seed —
o total do catálogo na paginação (`f02-crm-navigation`) e "recém-criada =
IA desligada" (`f04-ai-settings`). As duas passaram a partir do estado que o
banco tem (baseline lido antes de inserir; ida e volta a partir do valor
inicial). Isso é conserto de replicabilidade, não afrouxamento: a asserção
continua a mesma para a organização fictícia, e passa a valer para qualquer
seed.

Assim `e2e[deka]` e `e2e[demo2]` medem o que D32 quer: a mesma suíte, sem
`if tenant ==`, sobre a configuração de cada tenant vinda só de
`docs/tenants/` — e `demo3` (T03) usa o mesmo mecanismo. O deka entra como
está no repositório (TODO-DEKA, D48): nome `TODO-DEKA`, settings pendentes
puladas, sem usuário do seed.

**Rejeitado — rodar DENTRO do deka/demo2 persistentes do staging.** As specs
apagam a organização A na limpeza (apagariam o tenant), assumem organização
vazia em vários pontos (`toHaveLength(500)`, `settings.count=0`), e rodar
em `demo2` com as fixtures fictícias exigiria editar specs para passar —
o fechamento preguiçoso que §8.5 nomeia. Também poluiria o staging quando
uma limpeza falhasse.

### 3. Loader do seed completo (§B13) e `onboarded_at`

`create-tenant.ts` passa a gravar os três blocos, idempotente por id
determinístico (`fixtureUuid(org, tipo, chave)` — a mesma função das
fixtures da F02; segunda execução cria 0 linhas):

| Bloco do seed (§5.21) | Tabela e colunas | Chave de idempotência |
|---|---|---|
| `products[]` | `catalog_products`: `codigo=sku`, `nome=name`, `preco_cents=price_cents`, `sale_unit=unit`, `ativo=active`, `origem='seed'` | `sku` |
| `customers[]` | `crm_companies` (`legal_name=company`, `trade_name=company`) quando `company` vem preenchido; `contacts`: `name=display_name=name`, `phone_number=phone`, `recurring`, `company_id`, `source='seed'`, `source_metadata.seed={recurring_weekday, notes}` | `phone` (contato), `company` (empresa) |
| `faq[]` | acervo da organização (ADR-023): um material `FAQ do seed` por `ingerirDocumento`, um parágrafo `P: … / R: …` por item, embutidor determinístico (ADR-002) | nome do material, `agent_id` nulo |

`products[].size` NÃO tem coluna em `catalog_products` (há `sale_unit`, não
tamanho); o loader declara `products: size sem coluna (n itens)` na saída em
vez de inventar destino. É lacuna de §5.21 × catálogo para o proprietário.

Ao INSERIR a organização (nunca em rerun de slug existente) o loader grava
`onboarded_at = now()`: o seed É o onboarding de um tenant provisionado pelo
operador; o assistente de `/onboarding` é o caminho self-service (F11). Para
os dois tenants já existentes no staging, `scripts/staging/seed-users.sh`
(script só de staging, que já escreve `auth.users`) preenche `onboarded_at`
onde estiver nulo. O contorno do telefone do contato fictício "Alfa" nesse
script passa a valer só quando nenhum contato da organização tem o telefone
do webhook do smoke — com o seed carregado, o remetente é o cliente do seed.

O smoke (`scripts/smoke.mjs`) passa a comparar `customers`/`products` com
**seed + fixture fictícia** e aceita `SMOKE_TENANTS=<slug,…>` (padrão
`deka,demo2`) para a T03; `scripts/staging/seed-users.sh` aceita a lista de
slugs pelo mesmo motivo.

### 4. Tenant efêmero e "do zero" ficam fora do bloco

- **T03**: `scripts/verify/tenant-efemero.sh <slug>` cria o tenant no staging
  (`create-tenant.sh` + `seed-users.sh`), roda o smoke com `SMOKE_TENANTS=<slug>`,
  roda o navegador com `E2E_TENANT=<slug>` contra o staging (ADR-028 §2) e
  remove o tenant (organização por cascata, usuários do seed, sessão de canal),
  imprimindo `demo3: created=1 smoke=pass=S/S e2e[demo3]=N/N specs=S/S removed=1 tenants=T`.
  A linha vai ao BUILD-STATE, ao lado de `restore:`/`smoke:`.
- **T04**: `scripts/from-scratch.sh` clona o repositório num diretório novo,
  instala, sobe o sandbox descartável (baseline = migração), semeia os dois
  tenants pelo loader, roda o `verify.sh` no clone e derruba o sandbox,
  imprimindo `steps=N pass=N/N verify_exit=E`. Roda no sandbox (`READY (F07)`),
  não no staging: "do zero" inclui o banco.

### 5. `next-env.d.ts` sai do snapshot de inputs (achado do from-scratch)

A segunda execução de `scripts/from-scratch.sh` (clone limpo de `15585bd2`)
terminou com todas as suítes verdes — unit 8492/8492, integração 155/155, banco
1651/1651, navegador 41/41 em deka e em demo2, mutantes 56/56 — e
`STATUS: NOT READY` por `inputs: files_before=3529 files_after=3530`. O arquivo
que apareceu foi `next-env.d.ts`: gitignorado, gerado pelo `next build` que o
próprio gate roda, e listado explicitamente em `snapshotF02Inputs`. Na árvore
de trabalho ele existe desde 08/09 e por isso nenhum gate anterior o viu
nascer. Arquivo gerado pelo gate não pode ser input do gate: sai da lista. O
caso "F02 input snapshot stays equal when only excluded artifacts change"
passa a criar `next-env.d.ts` depois do snapshot e exigir igualdade. Nenhum
outro input muda; a contagem de arquivos do bloco cai de 3530 para 3529.

## Alternativas rejeitadas

- **Imprimir `e2e[deka]=ok` a partir da execução fictícia de hoje**, só
  renomeando. Seria o campo sem a medida.
- **Rodar o navegador uma vez só com `E2E_TENANT=deka` e derivar demo2.**
  §8.3 define `src_diff_lines` ENTRE duas execuções; uma só não tem entre.
- **Declarar §B13 em vez de consertar.** T03 entregaria "criar um tenant
  novo" sem cliente, sem produto e sem acervo — o tenant que o proprietário
  veria pelo Tailscale seria vazio, e o smoke seguiria medindo fixture em vez
  de seed.
- **Gravar `size` em `descricao`.** Descrição é campo de tela; tamanho de
  embalagem em campo de texto livre vira dado com cara de confirmado.
- **Preencher `onboarded_at` no staging por `psql` solto.** Fica fora de
  script versionado; o `seed-users.sh` já é o lugar do que o staging faz com
  seus usuários fictícios.

## Consequências

- Gate da F07 = gate da F06 + segunda execução do navegador (≈ +30 min) +
  provisionamento de A pelo loader em cada spec (10 × `tsx`, ≈ +2 min).
- O staging ganha as linhas do seed no demo2 (1 produto, 1 cliente com
  empresa, 1 material com 7 trechos) ao rodar o loader de novo; os
  denominadores do smoke sobem de `2/2`/`3/3` para `3/3`/`4/4` e passam a ser
  seed + fixture, declarados.
- `deka` e `demo2` do staging deixam de cair em `/onboarding`.
- Mutantes novos: 58 (loader volta a pular os blocos do seed → o teste de
  integração fica vermelho) e 59 (`requiresReplicability` desligado → o caso
  do gate fica vermelho). `mutants_killed` sobe de 54 para 56.
- Usuários com e-mail `TODO-` deixam de virar `auth.users` (o staging tinha um
  `TODO-DEKA`, apagado por `seed-users.sh`).
- Produção continua atrás de D12/D13: nada aqui a autoriza.

## Data

2026-09-12

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md`).
