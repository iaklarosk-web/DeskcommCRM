# ADR-028 — verify.sh v1.4 (campos `logs`, `rate-limit`, `lgpd`; ambiente `staging`) e o desenho do staging nesta VPS

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-022](ADR-022-verify-v1.2.md) e [ADR-024](ADR-024-verify-v1.3.md). D25
permite mudança no `verify.sh` só por ADR; §8.3 manda acrescentar campos,
nunca remover. Decisões de F06 que afetam mais de um módulo ficam aqui
(AGENTS.md §8).

## Contexto

A F06 (§7.7) pede nove tasks e uma saída: `STATUS: READY (staging)` rodado
DENTRO do staging, mais as linhas `restore:` e `smoke:` no BUILD-STATE. Três
coisas do documento precisavam de decisão antes de o código existir:

1. **O verificador não conhece a F06.** `GATED_PHASES` termina em F05 e o
   inventário de navegador também. §8.3 não nomeia campo nenhum para a F06 —
   as provas de §7.7 (`logs`, `rate-limit`, `lgpd`, `restore`, `smoke`) não
   têm grafia no bloco.
2. **`READY (staging)` tem dois donos.** D25 e §8.3 dizem "só em F07 com todos
   os campos"; §7.7 e D50 dizem que é a saída da F06, "rodado dentro do
   staging". Contradição de nível (a) (D10): resolvida pela hierarquia, com
   D50 — decisão do proprietário, mais nova e específica — prevalecendo para a
   F06, sem tirar da F07 o que §8.4 lhe reserva.
3. **O que é "dentro do staging" numa VPS de 2 núcleos.** D50/ADR-027 fixam:
   esta máquina, Docker Compose, Supabase LOCAL, acesso só por Tailscale, e o
   sandbox descartável do gate NÃO é o staging. Faltava dizer como o Supabase
   local sobe sem expor porta na interface pública — o Supabase CLI publica em
   `0.0.0.0`, e o Docker entrega essas portas por baixo do `ufw` (cadeia
   `DOCKER-USER` vazia, medido em 12/09/2026: o stack de desenvolvimento de
   outro checkout já está assim, em 54321/54322). Regra de firewall é porta
   1-way do proprietário (regras da casa); o staging não podia depender dela
   para não estar exposto no momento em que subisse.

## Decisão

### 1. verify.sh v1.4 — F06 entra no gate com três campos novos

- `F06` entra em `GATED_PHASES` e no inventário fechado de navegador com as
  MESMAS dez specs e 41 testes de F05: a F06 não cria tela (a LGPD é ação de
  catálogo e rota de API), então não há spec nova a exigir. O denominador já
  provado não diminui (ADR-018).
- Três métricas passam a ser obrigatórias a partir de F06, gravadas pelas
  próprias suítes via `gravarLinhaDoVerify` (ADR-005), `pending` antes:
  - `logs: routes=R routes_logged=R workers=W workers_logged=W request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=K/N`
    — contrato: `routes ≥ 200`, `routes_logged = routes`, `workers ≥ 4`,
    `workers_logged = workers`, `request_log_org_id = 1`, `sentry_mock_captured ≥ 1`,
    `pii_fields = 4` (a allowlist de §5.17). A grafia de §7.7 T01 (`grep -rL logger`)
    é substituída por esta régua porque a linha sai do GUARDA (`requireRole`,
    `resolveActiveOrg`, `requirePlatformAdmin`) e não de um `import` por arquivo:
    269 rotas com a mesma linha num ponto só é mais forte que 269 imports.
  - `rate-limit: requests=101 status_429=K auth_requests=101 auth_blocked=B routes=R routes_with_schema=R routes_reading_input=I validated=I`
    — contrato: `requests ≥ 101`, `status_429 ≥ 1`, `auth_blocked ≥ 1`,
    `routes_with_schema = routes`, `validated = routes_reading_input`. §7.7 T02
    pedia `routes=R routes_with_schema=R`; os dois campos extras dizem quantas
    rotas de fato leem entrada — rota sem entrada é coberta por vacuidade, e o
    número deixa isso visível em vez de escondê-lo no `R`.
  - `lgpd: tables=T rows=N rows_remaining=0 audit_rows=2` — contrato: `tables ≥ 5`,
    `rows ≥ 5`, `rows_remaining = 0`, `audit_rows = 2`. É a grafia de §7.7 T03
    numa linha só.
- `restore:` e `smoke:` NÃO entram no bloco: §7.7 os põe no BUILD-STATE, ao
  lado do bloco, porque são provas de OPERAÇÃO (scripts rodados contra o
  staging), não de suíte. Continuam obrigatórios para fechar a fase — pela
  DIRETRIZ, não pelo verificador.

### 2. O bloco ganha `environment=`, e `READY (staging)` é a saída da F06 dentro dele

- A linha de escopo passa a `scope=phase phase=Fnn current_phase=Fnn environment=sandbox|staging`.
- O passo `environment` do gate (`scripts/verify/f02-e2e.mjs`) aceita dois
  perfis, escolhidos por `VERIFY_ENVIRONMENT`:
  - `sandbox` (padrão, inalterado): marcador `f02-crm-cadastros-disposable`,
    loopback 55421/55422/3102.
  - `staging`: marcador `crm-staging`, loopback **56421/56422** (o Supabase do
    staging) e app em **3202** — o `next start` que o Playwright sobe no HOST,
    do mesmo commit, apontado para o banco, a auth e o storage do staging.
    Continua loopback porque o `playwright.config.ts` recusa outra coisa (e
    porque o gate roda nesta máquina); o que muda é o alvo.
- `STATUS: READY (staging)` sai quando a fase é ≥ F06, o gate está limpo e o
  ambiente foi o `staging`. No sandbox, a F06 sai `READY (F06)` — prova de
  código, não de fase. A F07 continua sendo quem imprime `READY (staging)`
  com TODOS os campos de §8.4 (`replicability` em deka/demo2, `smoke: pass=6/6`);
  a F06 imprime o mesmo rótulo com os campos que ela tem, e o BUILD-STATE
  diz qual fase o produziu.
- O que "dentro do staging" NÃO cobre, declarado: as suítes `unit`, `db` e
  `integration` continuam no Postgres efêmero de `scripts/test-db.sh` (elas
  criam e destroem schema; rodá-las no banco do staging o deixaria irreconhecível);
  o container `crm-staging-app` não é o processo que o navegador do gate
  dirige — é o que o `smoke.sh` dirige. O gate prova o CÓDIGO contra a
  infraestrutura do staging; o smoke prova o CONTAINER.

### 3. Staging = `compose.staging.yml`, Supabase local escrito serviço a serviço

- **Sem o Supabase CLI.** Os serviços (db `supabase/postgres:15.8.1.085`, auth
  `gotrue:v2.196.0`, rest `postgrest:v16.1`, storage `storage-api:v1.70.3`,
  realtime `realtime:v2.129.3`, mailpit `v1.30.2`, kong `2.8.1`) são as MESMAS
  imagens e a mesma inicialização do banco que o CLI usa — derivadas de
  `docker inspect` do stack de desenvolvimento em 12/09/2026 —, escritas no
  compose para que cada porta seja publicada SÓ em `127.0.0.1` e no IP do
  Tailscale (`STAGING_BIND_IP`). Nada do staging escuta na interface pública, e
  isso não depende de firewall. O kong usa `key-auth` + `acl` por consumidor
  (o desenho do self-host oficial), com chaves PRÓPRIAS assinadas por um
  `JWT_SECRET` gerado — não as chaves de demonstração do CLI.
- **Portas:** API 56421, DB 56422, mailpit 56424, app 3200. Projeto Compose
  `crm-staging`, rede `crm-staging`, volumes `crm-staging_staging-db` e
  `crm-staging_staging-storage`.
- **App em imagem FINA** (`scripts/staging/Dockerfile.staging`): o `next build`
  roda no host com os mesmos placeholders de `NEXT_PUBLIC_*` da imagem genérica
  (os valores reais entram em runtime — `app/public-env-script.tsx`,
  `lib/env.ts`), e a imagem só copia `standalone`, `static` e `public`.
  Buildar dentro do Docker aqui repetiria `pnpm install` + `next build` numa
  VPS de 2 núcleos dividida com outros projetos.
- **Workers:** uma imagem (`Dockerfile.worker`, a de produção) e três
  processos — o agent-worker herdado, o worker de saída e o de lembrete
  (G-71: chamados por caminho absoluto, de `/tmp`).
- **WhatsApp:** `WHATSAPP_MODE=mock` (adapter mock, ADR-017). Não há container
  WAHA; `waha-mock` é um servidor HTTP de dez linhas que responde 200 ao
  health check herdado e não entrega nada. IA: `AI_PROVIDER=mock`. E-mail:
  mailpit. Sentry: `off`.
- **Segredos:** `/srv/secrets/crm-staging.env` (root:klarosk 640), gerado uma
  vez por `scripts/staging/secrets.sh` — nomes e tamanhos no log, valores
  nunca. Lido por `--env-file` (substituição) e `env_file` (serviços).
- **Memória:** `mem_limit` por serviço; medição real em `docs/ops/staging.md`
  e no `status.sh`. A reserva de swap de 2 GB existente foi reativada
  (`swapon /swapfile`, sem persistência — igual à F02).
- **Sobe de clone limpo** por `scripts/staging/up.sh`: build no host →
  camada Supabase → extensões + `supabase/baseline.sql` (idempotente) →
  seeds dos dois tenants + usuários fictícios com senha para o smoke →
  produto → conferência `running=S/S` com S lido de `compose config --services`.

### 4. Firewall, para o proprietário (descrita, não aplicada)

O staging não precisa de regra para não estar exposto (§3). A regra abaixo
é para o que JÁ está exposto nesta máquina e não é da F06 — os stacks de
outros checkouts/projetos com porta publicada em `0.0.0.0` — e fica em
`docs/ops/staging.md` §Firewall. Quem aplica é o proprietário.

## Alternativas rejeitadas

- **Supabase CLI para o staging** (`supabase start --workdir`): é a receita do
  sandbox e teria custado uma hora. Rejeitada porque publica em `0.0.0.0` e
  a única forma de fechar isso é regra em `DOCKER-USER`, que é do proprietário:
  o staging ficaria exposto (banco com senha conhecida, chaves de demonstração)
  entre subir e a regra ser aplicada.
- **Chamar o sandbox de staging.** Recusado na ADR-027 e na VARREDURA §C1.
- **Rodar `unit`/`db`/`integration` no banco do staging.** As suítes criam e
  destroem schema; o staging deixaria de ser reconhecível como staging.
- **Manter `READY (F06)` como saída e deixar `READY (staging)` só para F07.**
  Contraria D50 (a) — decisão do proprietário — e §7.7.
- **Container WAHA real em modo mock.** 900 MB de RAM medidos em produção para
  um serviço que, em mock, ninguém chama.

## Consequências

- Gate da F06 = gate da F05 + três métricas; custo de máquina igual (65–130 min).
- `.env.e2e` do gate em staging aponta para 56421/56422 e leva a senha do
  Postgres do staging; continua privado (`.gitignore`), nunca versionado.
- O staging acumula fixtures das jornadas do gate (organizações fictícias
  `fictitious_A_B`); o smoke conta só `deka` e `demo2`.
- Produção continua atrás de D12/D13: nada aqui a autoriza.

## Data

2026-09-12

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-028-verify-v1.4-e-staging-nesta-vps.md`).
