# ADR-032 — F08: serviços reais e produção inicial nesta VPS (tasks, decisões D12/D52 e o que fica NOT VALIDATED)

Decisões da F08 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor a fase em tasks antes de executar; D12 lista o que a produção precisa
do proprietário; D13 mantém o BLOCKER-PROD (nenhum tenant real sem liberação
escrita); D51 (b) condicionou a F08 às credenciais — fornecidas em 13/09/2026
e registradas aqui como **D52**. O verificador muda em
[ADR-033](ADR-033-verify-v1.7-F08.md).

## Contexto

O staging (ADR-028) prova o produto com todos os provedores em MOCK: WhatsApp,
IA, e-mail (mailpit), Sentry desligado, gateway de cobrança fictício. A F08
sobe um SEGUNDO stack, `crm-prod`, nesta mesma VPS, com os provedores REAIS que
o proprietário forneceu, atrás do Caddy do host, no domínio
`crm.kntecnologia.app` — e mede, com denominador, que a configuração não tem
placeholder e que cada jornada real acontece uma vez, com o proprietário como
único destinatário (nunca uma pessoa que não seja ele — regra da casa).

A preparação fora da árvore (`~/projetos/CRM-OS/docs/f08/DECOMPOSICAO-F08-20260913.md`,
sessão de 13/09) já fez: DNS `crm.kntecnologia.app` (CNAME, resolvendo), o
env de segredos `/srv/secrets/crm-prod.env` (25 variáveis em 14/09; nomes em
§4), imagem `devlikeapro/waha:latest-2026.7.2` puxada, bloco do Caddy
rascunhado. O que a F08 NÃO faz: liberar o BLOCKER-PROD (texto do proprietário,
D13), criar o tenant Deka real (D04), parear número de WhatsApp (do
proprietário) — tudo isso continua NOT VALIDATED (real) ao fim da fase.

## Decisão

### 1. D52 — decisões do proprietário registradas nesta ADR (13–14/09/2026)

| # | Item | Decisão | Onde vale |
|---|---|---|---|
| D12-1 | Domínio e nome | `crm.kntecnologia.app`; `PLATFORM_NAME="CRM OS"` "por enquanto" — configuração, não código | `NEXT_PUBLIC_APP_URL`; `PLATFORM_NAME` → `APP_NAME` (§3) |
| D12-2 | Supabase de produção | Compose local nesta VPS, réplica do staging, serviço a serviço (ADR-028) | `compose.prod.yml` |
| D12-3 | IA real | Chat pela chave Anthropic da KN (reuso); embedding pela `OPENAI_API_KEY` com teto criado pelo proprietário | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_PROVIDER=anthropic` |
| D12-4 | WhatsApp | **Fica para depois**: container WAHA de pé, sem número; jornada `NOT VALIDATED (real)` | `waha` no compose; `WAHA_API_KEY` ausente até o número |
| D12-5 | E-mail | Conta Resend da KN (reuso), remetente `crm@mail.kntecnologia.app` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| D12-6 | Sentry | Projeto próprio `crm-os`; DSN gravado em 13/09 | `SENTRY_DSN` (§B11: sem DSN = desligado) |
| D12-7 | `platform_admin` | `OWNER_EMAIL=iaklarosk@gmail.com`, organização "KN Tecnologia", senha gerada (24 chars, nunca impressa) | `scripts/prod/bootstrap-owner.sh` |
| D14 | Gateway de cobrança | **Stripe**, numa fase posterior (F13+); até lá `BILLING_GATEWAY=mock` continua em produção inicial — assinaturas nascem `active/operator` pelo painel do dono | `lib/env.ts` (enum só com `mock`; Stripe entra por ADR própria) |
| D14 | Planos e preço | PLAN_A/B/C continuam **placeholder** (preço 0, limites declarados) até a fase do Stripe | `src/billing/planos.ts` |
| D44 | Carência e pró-rata | **7 dias**, **sem pró-rata** na troca de plano — confirmado; deixa de ser "padrão declarado" e vira decisão | `BILLING_GRACE_DAYS=7` |
| — | Caddy | Proprietário liberou o `reload` do Caddy do host (serve os outros OS) | F08-T03 |

### 2. Tasks (critério de saída com denominador)

"Real" = provedor de verdade. Destinatário de qualquer mensagem real = o
proprietário, e só ele.

| Task | Entrega | Critério de saída | Depende de |
|---|---|---|---|
| **F08-T00** | (feita em 13/09, fora da árvore) DNS, `crm-prod.env`, imagem WAHA, decisões | `dig` 2/2 resolvedores → IP da VPS; variáveis com tamanho > 0; `docker images` 1/1 | — |
| **F08-T01** | Esta ADR + ADR-033 (verify v1.7: `F08` em `GATED_PHASES`, régua `compose.prod.yml sem mock/placeholder`, mutante 65) + `next_task` | `pnpm test:unit -- tests/unit/f08-t01-compose-de-producao.test.ts` verde; `tests/verify/gate.cases.mjs` com o caso F08; mutante 65 morto | F11+F12 fechada (`1e13071d`) |
| **F08-T02** | `compose.prod.yml` + `scripts/prod/{up,down,status,backup,restore,prova}.sh`: Supabase local (db/auth/rest/storage/realtime/kong), app, 3 workers, redis, srh, scheduler, **waha real** no lugar do `waha-mock`, **sem mailpit** (GoTrue → Resend por SMTP); `env_file: /srv/secrets/crm-prod.env`; `mem_limit` em todo serviço; logs rotacionados; portas só em `127.0.0.1` + `PROD_BIND_IP` (3300/56431/56432) | `docker compose -p crm-prod ps`: running = declarados (N/N); `status.sh` mostra 0 portas em `0.0.0.0`; `restore: tables=T rows_diff=0` sobre um dump da própria produção | T01 |
| **F08-T03** | Bloco `crm.kntecnologia.app` no `/etc/caddy/Caddyfile` (rascunho da preparação) + `systemctl reload caddy`; robots privado; cabeçalhos | `curl -sI https://crm.kntecnologia.app/api/v1/health` = 200 com `strict-transport-security` (1/1); certificado emitido (1/1); os outros vhosts continuam 200 (K/K antes e depois) | T02 |
| **F08-T04** | `platform_admin` real: `scripts/bootstrap-owner.ts` DENTRO do container do app (env já resolvido pelo compose — §3 aspas); organização "KN Tecnologia" com assinatura `active/operator` PLAN_C; idioma pt-BR | Login pelo domínio com `OWNER_EMAIL` (1/1); `platform_admins=1`, `organizations=1`, `orgs_without_subscription=0/1` no banco de produção; senha nunca impressa | T03 |
| **F08-T05** | IA real: `AI_PROVIDER=anthropic` (registro real; a organização decide o vendor), embedding pela OpenAI | 1 turno real respondido (1/1, transcript sem PII na evidência), 1 documento indexado com `vector(1536)` (1/1), custo do turno em `ai_usage_events` (1/1) | T04 |
| **F08-T06** | E-mail real pela Resend (reset de senha do dono) | 1 e-mail entregue em `OWNER_EMAIL` (1/1) com `From: crm@mail.kntecnologia.app` — evidência = id da Resend, nunca o corpo | T04 |
| **F08-T07** | Sentry com DSN próprio (`isCommunityDsn=false`) | 1 evento de teste no projeto `crm-os` (1/1, id do evento); 0 campos de PII no payload (allowlist de `src/obs/erros.ts`) | T02 |
| **F08-T08** | WAHA real de pé, sessão NÃO criada (sem número), webhook assinado exigido | `health=1/1` do container; jornada `whatsapp=NOT VALIDATED (real)` — com número de teste do proprietário: 1 recebida + 1 enviada ao PRÓPRIO número (2/2), fase posterior | T03 |
| **F08-T09** | Operação: `~/bin/backup-crm-os` no cron (03:20) → `gdrive-crypt:crm-os/db`, marcador de sucesso; runbook `docs/ops/prod.md` (subir/derrubar/rotacionar/restaurar, 4/4 com comando); orçamento mensal declarado | 1 backup confirmado no remoto com o mesmo tamanho (1/1); restore desse backup `rows_diff=0` (1/1) | T02 |
| **F08-T10** | Fechamento: `prova.sh` grava a linha `prod:` (§4); smoke pelo domínio; gate v1.7 `READY (staging)` sobre o commit final; FINAL-VALIDATION §2/§3; BUILD-STATE; COMECE-AQUI; custo. **BLOCKER-PROD continua aberto** até o proprietário escrever `BLOCKER-PROD: liberado por <nome> em <data>, sha <hash>` (D13) | `prod:` com todos os campos medidos; `smoke: steps=k pass=k/k` contra `https://crm.kntecnologia.app` | T03–T09 |

### 3. Três achados da preparação, resolvidos aqui

- **Aspas do `segredo`.** `~/bin/segredo` grava `NOME='valor'`; `loadEnv` de
  `scripts/bootstrap-owner.ts` só tirava aspas duplas. Decisão: `loadEnv`
  passa a tirar aspas simples E duplas (uma linha), e o bootstrap de produção
  roda DENTRO do container do app, onde o compose já resolveu o env — as duas
  proteções, porque a segunda vale para produção e a primeira para quem roda o
  script na mão.
- **`PLATFORM_NAME` não é lido pelo código.** A variável que o produto lê é
  `APP_NAME` (`lib/env.ts`, `lib/branding.ts`; white-label em runtime pelo
  `PublicEnvScript`). D28 chama de `PLATFORM_NAME` o nome que o proprietário
  escolhe; o env de produção o guarda com esse nome e o compose o entrega ao
  código como `APP_NAME: ${PLATFORM_NAME}`. Nenhuma variável nova em
  `lib/env.ts` (régua `env-example-sync` intocada); o nome no `.env` do
  proprietário é o de D28, o nome no código é o herdado (G-27 continua: quem lê
  o env é o compose, e o compose diz qual é qual).
- **`docker-compose.prod.yml` herdado não serve.** Usa a imagem
  `ghcr.io/melgarafael/deskcommcrm:stable` (código de terceiro, não auditado,
  em produção) e um Caddy em container. A F08 usa o build local do fork (o
  mesmo `next build` que o gate valida, `Dockerfile.staging`) e o Caddy do
  host, que já serve os outros OS. O arquivo herdado fica no repositório como
  referência do self-host upstream; a régua de F08-T01 vale para
  `compose.prod.yml`.

### 4. A linha `prod:` — fora do bloco, ao lado de `restore:` e `smoke:`

Como ADR-028 §1 fez com `restore:`/`smoke:`, a prova de produção não entra no
`VERIFY SUMMARY`: o gate roda com `AI_PROVIDER=mock`/`WHATSAPP_MODE=mock`
(D12) e nunca toca produção. `scripts/prod/prova.sh` mede contra o stack
`crm-prod` de pé e grava no BUILD-STATE:

```
prod: compose=crm-prod services_running=N/N config_vars=V/V placeholders=0/V public_ports=0 https=1/1 hsts=1/1 vhosts_ok=K/K owner_login=1/1 platform_admins=1 orgs=1 orgs_without_subscription=0/1 ai_turn=1/1 embedding=1/1 email=1/1 sentry_event=1/1 whatsapp=health_only backup=1/1 restore_rows_diff=0 sha=<commit>
```

`config_vars=V/V`: cada variável de `scripts/prod/vars-obrigatorias.txt`
existe no env e tem tamanho > 0; `placeholders=0/V`: nenhuma contém
`placeholder`, `changeme`, `example` ou `staging`. `WAHA_API_KEY` não está na
lista obrigatória (D12-4) e a linha diz `whatsapp=health_only` até o número.
Cada `1/1` é uma jornada real executada UMA vez com evidência (id do provedor),
nunca o corpo. `email=1/1` é o reset de senha do próprio dono.

### 5. Segredos e portas 1-way (regras da casa)

Nenhum valor de `/srv/secrets/crm-prod.env` aparece em chat, commit, log ou
evidência — só nome e tamanho. `systemctl reload caddy` foi liberado pelo
proprietário para este bloco; `ufw`, `sshd`, Tailscale, rotação de segredo,
`docker compose down -v` de produção e qualquer gasto além do turno de IA e do
e-mail de teste continuam 1-way.

## Alternativas rejeitadas

- **Supabase gerenciado para produção.** D50 (a) escolheu o self-host local
  para o staging pelo controle de exposição (portas só em loopback +
  Tailscale); a produção herda a receita e o operador (ADR-028). Um projeto
  gerenciado entra quando houver mais de uma VPS — decisão futura.
- **`READY (prod)` como rótulo do gate.** O gate não roda contra produção e
  não pode dizer que a validou; o rótulo continua `READY (staging)` e a
  produção é medida pela linha `prod:` (§4), com denominador, ao lado.
- **Stripe já nesta fase.** O proprietário escolheu o gateway (D52) mas o
  contrato com o provedor, a conta e as chaves são dele; sem elas o código
  seria mock com outro nome. Fase própria, com ADR própria.
- **Reaproveitar o `waha-mock` em produção.** Um dublê que responde 200 num
  ambiente chamado produção é dado de mentira; o container real fica de pé,
  sem sessão, e a linha diz `health_only`.

## Consequências

- Dois stacks nesta VPS: `crm-staging` (3200/56421/56422/56424) e `crm-prod`
  (3300/56431/56432), ≈ 1,4 GB + ≈ 2,1 GB de memória (WAHA incluído).
- `verify.sh` v1.7 (ADR-033): F08 no gate com o inventário de F12 (12 specs)
  e a régua estática do compose de produção; nenhum campo novo no bloco.
- Documentação: `docs/ops/prod.md` (runbook), FINAL-VALIDATION §2 com a linha
  `prod:` e §3 com o que segue NOT VALIDATED (WhatsApp real, tenant Deka,
  Stripe, BLOCKER-PROD).

## Data

2026-09-14

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-032-F08-servicos-reais-e-producao-inicial.md`).
