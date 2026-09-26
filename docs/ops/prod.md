# Runbook — produção inicial do CRM OS nesta VPS (F08, D52, ADR-032)

Produção = `compose.prod.yml` + Supabase LOCAL self-hosted, nesta máquina
(`srv1958191`), atrás do Caddy do host em `https://crm.kntecnologia.app`.
Segundo stack ao lado do staging (`docs/ops/staging.md`), com identidade,
volumes, rede, portas e segredos próprios. **BLOCKER-PROD continua aberto
(D13)**: nenhum tenant real nasce aqui antes da liberação escrita do
proprietário; o cadastro público está DESLIGADO no GoTrue até lá.

| Coisa | Onde |
|---|---|
| Compose | `compose.prod.yml`, projeto `crm-prod`, rede `crm-prod` |
| Scripts | `scripts/prod/{secrets,up,down,status,bootstrap-owner,backup,restore,backup-diario,prova}.sh`; jornadas reais: `jornada-sentry.ts`, `jornada-ia.mjs`, `jornada-email.sh` (rodam UMA vez, gravam `docs/ops/prod-jornadas.log`) |
| Segredos | `/srv/secrets/crm-prod.env` (root:klarosk 640; nunca em chat/commit) |
| Domínio | `https://crm.kntecnologia.app` (Caddy do host → app 3300; `/auth/v1`, `/rest/v1`, `/storage/v1`, `/realtime/v1` → kong 56431) |
| App na VPS | `http://127.0.0.1:3300` (e o IP do Tailscale) |
| Supabase API (kong) | `127.0.0.1:56431` (e o IP do Tailscale) |
| Postgres | `127.0.0.1:56432` (e o IP do Tailscale), usuário `postgres` |
| WhatsApp | container `crm-prod-waha` (WAHA real, sem número pareado — D12-4) |
| E-mail | Resend: GoTrue por SMTP (`smtp.resend.com:587`), app pela API. Modelos com `token_hash` em `/srv/prod/crm/email/` (renderizados por `hostgator-setup-kit/marca-emails.sh --render-em`, servidos pelo Caddy em `/email/`); allow list do GoTrue com `**` — ver "Links dos e-mails de acesso" abaixo |
| Sentry | DSN próprio (`SENTRY_DSN` no env); sem DSN = desligado (§B11) |
| Volumes | `crm-prod_prod-db`, `crm-prod_prod-storage`, `crm-prod_waha-data`, `crm-prod_waha-media` |
| Arquivos gerados | `.prod/` (não versionado): `kong.yml` com chaves, árvore do build do app |
| Backup diário | `~/bin/backup-crm-os` (= `scripts/prod/backup-diario.sh`) 03:20 → `gdrive-crypt:crm-os/db`, marcador `/var/tmp/crm-os-backup-success.marker` |
| Evidência | `docs/ops/restore-prod.log`, `docs/ops/prod-jornadas.log`, linha `prod:` no BUILD-STATE |

## Subir (de clone limpo)

```bash
cd /home/klarosk/projetos/DeskcommCRM-v1.17.0
bash scripts/prod/secrets.sh          # completa o env; nada regravado se já existe
bash scripts/prod/up.sh               # build no host + camada Supabase + baseline + produto (SEM seeds)
bash scripts/prod/bootstrap-owner.sh  # o platform_admin real (F08-T04), dentro do container
bash scripts/prod/status.sh           # ps, memória por container, portas, linha prod_stack:
```

`up.sh` é re-executável: baseline idempotente, imagens rebuildadas, volumes
preservados. `--skip-build` reaproveita `.next/`. Produção NÃO tem seed, tenant
fictício nem usuário de smoke: quem entra é o dono (`OWNER_EMAIL`) e quem ele
convidar. Ordem de subida: `db` → (`auth`, `rest`, `storage`, `realtime`) →
espera as migrations do GoTrue/Storage → `kong` → extensões + baseline →
`restart realtime` → `redis`/`srh`/`waha` → `app` → workers → `scheduler`.

Chaves do proprietário (nunca por script): `segredo crm-prod.env <NOME>` —
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN`; e
`WAHA_API_KEY` é gerada pelo `secrets.sh` (chave interna app ↔ WAHA).

## Derrubar

```bash
bash scripts/prod/down.sh             # containers e rede; volumes FICAM
```

Apagar volumes de produção (`down -v`) é porta 1-way do proprietário.

## Rotacionar

Rotação de segredo é porta 1-way do proprietário. Receita quando ele mandar:
`segredo crm-prod.env <NOME>` com o valor novo → `bash scripts/prod/up.sh
--skip-build` (o compose relê o env; os containers são recriados). Chaves JWT
(`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`) só rotacionam JUNTAS e
invalidam toda sessão aberta; `POSTGRES_PASSWORD` exige `alter user` no banco
antes do `up` (o initdb só roda no primeiro boot do volume).

## Backup e restore

```bash
bash scripts/prod/backup.sh           # pg_dump custom → ./backups/prod-<data>.dump (public, auth, storage)
bash scripts/prod/restore.sh backups/prod-<data>.dump   # num banco VAZIO novo, compara, apaga; grava docs/ops/restore-prod.log
```

Diário: `install -m 755 scripts/prod/backup-diario.sh ~/bin/backup-crm-os` e
no crontab do `klarosk`: `20 3 * * * /home/klarosk/bin/backup-crm-os >>
/home/klarosk/backup.log 2>&1`. O script confere o tamanho no remoto antes de
gravar o marcador; retenção 14 dias. Restaurar um backup do Drive:
`rclone copyto gdrive-crypt:crm-os/db/crm-db-<data>.dump backups/prod-<data>.dump`
→ `restore.sh`. Restore SOBRE o banco em uso é humano (D11, D26).

## Domínio (Caddy do host, F08-T03)

Bloco `crm.kntecnologia.app` no `/etc/caddy/Caddyfile` (`bind` no IP público,
HSTS/nosniff/DENY/referrer, `robots.txt` privado, `reverse_proxy 127.0.0.1:3300`
para o app e `127.0.0.1:56431` para `/auth/v1*`, `/rest/v1*`, `/storage/v1*`,
`/realtime/v1*`). Aplicar = `sudo caddy validate --config /etc/caddy/Caddyfile`
→ `sudo systemctl reload caddy` (reload liberado pelo proprietário, D52).

## Jornadas reais (F08-T05/T06/T07) — uma vez cada, com o proprietário como único destinatário

```bash
docker cp scripts/prod/jornada-sentry.ts crm-prod-worker:/app/scripts/prod-jornada-sentry.ts && \
  docker exec -w /app crm-prod-worker sh -c 'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/prod-jornada-sentry.ts'   # sentry: ok id=…
node scripts/prod/jornada-ia.mjs      # ai_turn: ok … / embedding: ok … (agente + FAQ do dono, reaproveitados pelo nome)
# F15-T06 (ADR-036 §3): o limite diário com o provedor REAL, na organização do dono, ≤ 20 turnos (D54 g) — a linha `ai_real:` do BUILD-STATE
docker cp scripts/prod/jornada-limite-ia.ts crm-prod-worker:/app/scripts/prod-jornada-limite-ia.ts && \
  docker exec -w /app crm-prod-worker sh -c 'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/prod-jornada-limite-ia.ts'   # ai_real: turns=3/3 … calls_after_limit=0/3 …
bash scripts/prod/jornada-email.sh    # email: ok id=… (reset de senha do dono pela Resend)
```

Cada linha `… : ok` vai para `docs/ops/prod-jornadas.log` (versionado; id do
provedor, nunca corpo), que `prova.sh` lê.

## Prova (a linha `prod:` do BUILD-STATE)

```bash
bash scripts/prod/prova.sh
```

Mede serviços, variáveis sem placeholder, portas públicas, HTTPS/HSTS, os
outros vhosts, login do dono pelo domínio, `platform_admins`, organizações
sem assinatura, turno de IA e embedding reais (`ai_usage_events`), e-mail e
Sentry (linhas `email: ok id=…`/`sentry: ok id=…` em
`docs/ops/prod-jornadas.log`, escritas pelas jornadas de F08-T06/T07), WAHA
de pé, backup confirmado no remoto e o último `rows_diff` do restore. Exit 1
se qualquer campo ficar fora do denominador.

## Orçamento mensal declarado (F08-T09)

| Serviço | Plano | Teto |
|---|---|---|
| Anthropic (chat) | chave da KN, pós-pago | acompanhado em `ai_usage_events` + console da Anthropic |
| OpenAI (embedding) | projeto `crm-os` com budget mensal (criado pelo proprietário) | o teto do projeto |
| Resend | free (3.000 e-mails/mês) | 0 |
| Sentry | free (5k erros/mês) | 0 |
| WAHA | Core (gratuito) | 0 |
| VPS | já paga (dividida com os outros OS) | 0 adicional |

## Criar uma empresa (tenant) na produção pelo painel do dono

```bash
node scripts/prod/criar-tenant.mjs <slug> "<nome>" [PLAN_A|PLAN_B|PLAN_C]   # idempotente pelo slug; admin = o proprietário; 0 e-mails a terceiros
```

É o `POST /api/v1/admin/tenants` da tela `/admin/tenants` (F11-T03): a
organização nasce `active/operator` no plano pedido. Convidar a equipe da
empresa é pelo painel (`/admin/tenants` → equipe), quando o proprietário
decidir. Feito em 14/09/2026 para `deka` ("Deka Sucos", PLAN_C) — D53. A busca
por texto do painel (`?q=`) responde 500 (VARREDURA §B17); a lista sem `q` funciona.

## Ligar o Stripe na produção (F19, ADR-042 §7; F19-T06, ADR-044 §4; D58)

A produção saiu da F19 com o CÓDIGO do Stripe e `BILLING_GATEWAY=mock`. Em
20/09/2026 (D58) o proprietário decidiu ligar em modo **LIVE** com a chave
restrita que ele mesmo gravou. O caminho, na ordem — tudo por script, nada de
valor no chat:

1. **Chave restrita live** (`rk_live_…`, Dashboard → Developers → API keys →
   Restricted keys): `segredo crm-prod.env STRIPE_SECRET_KEY`. Permissões que
   o script usa: Checkout Sessions, Subscriptions, Customers, Products/Prices,
   Billing Portal — write; **Webhook Endpoints — write** (para registrar o
   endpoint pela API; sem isso, o passo 2 para e pede o registro no Dashboard).
2. **`bash scripts/prod/stripe-live.sh ligar`** — registra o endpoint LIVE em
   `https://crm.kntecnologia.app/api/v1/webhooks/stripe` com os 7 tipos
   tratados (idempotente por URL; o `whsec_` só sai na criação), provisiona um
   Product por plano do DONO (`plans.source='owner'`, migration 9034 — nunca
   placeholder em live) com o Price do banco e a configuração do Portal, e
   grava no env: `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_IDS`,
   `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_MODE=live`,
   `BILLING_GATEWAY=stripe`. Preço mudado depois: Price novo entra como
   vigente e o antigo fica na lista como legado (o webhook de quem assinou
   no antigo continua aceito).
3. **`bash scripts/prod/up.sh`** (o app relê o env) e
   **`bash scripts/prod/prova.sh`** → `billing_gateway=stripe/live`; o smoke,
   `webhook_stripe_unsigned_rejected=1/1` com status 401.
4. **`bash scripts/prod/stripe-live.sh provar`** → a linha `stripe_live:`
   (chave responde, 3 Products, 3 Prices com o preço do banco, Portal,
   endpoint LIVE habilitado com os 7 tipos, webhook sem assinatura = 401,
   cockpit `gateway ok=true stripe/live`), **sem nenhum Checkout nem cobrança**:
   `checkout_paid=0/0` fica declarado até um cliente (ou o proprietário, com
   o próprio cartão: trial de 7 dias → R$ 0 no ato) pagar.
5. O cockpit da KN lê `GET /api/admin/summary` com `Authorization: Bearer
   <ADMIN_SUMMARY_TOKEN>` (gerado por `secrets.sh`; o valor é do proprietário).
6. Com o mesmo bearer, `GET /api/admin/handoffs` (F24, ADR-050) lista os casos
   que esperam uma pessoa em todas as organizações (`?slug=a&slug=b` filtra;
   `?limit=` 1..200), com `inbox_path` e `admin_path` — é o que a rotina de
   aviso do Núcleo lê. Só leitura. E `SUPPORT_WEBCHAT_SLUG=suporte-crm-os` no
   `crm-prod.env` liga o chat de suporte dentro da área logada do produto
   (vazia = nada muda); a organização precisa existir, ter `webchat.enabled` e
   assinatura provisionada na mão (`origin=operator`).

Registrar o endpoint no Dashboard (se a chave não tiver `webhook_endpoints:
write`): Developers → Webhooks → Add endpoint, modo LIVE, URL acima, eventos
`checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`; depois
`segredo crm-prod.env STRIPE_WEBHOOK_SECRET` e o passo 2 de novo (ele reaproveita
o endpoint e a chave gravada).

O que NÃO fazer: chave de teste em produção (`stripe-live.ts` recusa);
placeholder em live (idem); apagar o endpoint com assinaturas vivas (os
eventos param de chegar e as assinaturas ficam sem sincronizar).

## Liberar o BLOCKER-PROD geral (é do proprietário, D13)

Texto no BUILD-STATE: `BLOCKER-PROD: liberado por <nome> em <data>, sha <hash>`.
Só então: `GOTRUE_DISABLE_SIGNUP: "false"` no compose (por ADR), `up.sh`, e o
tenant Deka real pelo painel do dono (D04: aceite escrito do risco de ban).

## Links dos e-mails de acesso (recuperar senha, confirmar cadastro) — 25/09/2026

**O defeito.** O app pede `redirectTo` com query (`/auth/confirm?type=recovery`,
`?type=signup`) e o GoTrue compara com `GOTRUE_URI_ALLOW_LIST` por glob: a entrada
exata `…/auth/confirm` não casa, o redirect é descartado e o link do e-mail volta
para a raiz do site — onde `/` manda para `/app` e o código se perde. O e-mail
chegava (`jornada-email.sh` verde) e a pessoa caía em `/login` sem sessão.

**O conserto, em três partes:**

1. `compose.prod.yml`: `GOTRUE_URI_ALLOW_LIST` com `**` e
   `GOTRUE_MAILER_TEMPLATES_{RECOVERY,CONFIRMATION}` apontando para
   `${NEXT_PUBLIC_APP_URL}/email/*.html`. O GoTrue relê o env ao recriar o serviço:
   `docker compose -f compose.prod.yml --env-file /srv/secrets/crm-prod.env -p crm-prod up -d --no-deps auth`.
2. Modelos renderizados, com o nome e a cor do produto:
   `APP_NAME="CRM OS" APP_ACCENT_HEX="#0b7374" bash hostgator-setup-kit/marca-emails.sh --render-em /tmp/crm-email`
   e depois `sudo install -d /srv/prod/crm/email && sudo install -m 644 /tmp/crm-email/*.html /srv/prod/crm/email/`.
3. Caddy: dentro do bloco `crm.kntecnologia.app`, antes do `handle { reverse_proxy 127.0.0.1:3300 }`:
   ```
   handle_path /email/* {
       root * /srv/prod/crm/email
       file_server
   }
   ```
   e `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

**Prova:** `curl -sI ${NEXT_PUBLIC_APP_URL}/email/recovery.html` → 200;
`bash scripts/prod/jornada-email.sh` → e-mail ao proprietário cujo link tem
`token_hash=` e leva a `/login/reset`.

**Senha do proprietário.** `OWNER_PASSWORD` em `/srv/secrets/crm-prod.env` é a senha
real (o `prova.sh` entra com ela). Trocar: `segredo crm-prod.env OWNER_PASSWORD` e
`bash scripts/prod/bootstrap-owner.sh` — o script passa o valor por `-e` ao container
porque `compose exec` herda o ambiente de quando o container foi CRIADO (o defeito de
25/09: regravou a senha antiga).
