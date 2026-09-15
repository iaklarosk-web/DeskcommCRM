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
| E-mail | Resend: GoTrue por SMTP (`smtp.resend.com:587`), app pela API |
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

## Liberar o BLOCKER-PROD geral (é do proprietário, D13)

Texto no BUILD-STATE: `BLOCKER-PROD: liberado por <nome> em <data>, sha <hash>`.
Só então: `GOTRUE_DISABLE_SIGNUP: "false"` no compose (por ADR), `up.sh`, e o
tenant Deka real pelo painel do dono (D04: aceite escrito do risco de ban).
