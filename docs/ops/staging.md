# Runbook — staging do CRM SaaS nesta VPS (F06-T06, D50, ADR-027, ADR-028)

Staging = `compose.staging.yml` + Supabase LOCAL self-hosted, nesta máquina
(`srv1958191`), acessível SÓ por Tailscale. Não é produção (D13) e não é o
sandbox descartável do verificador (`scripts/verify/sandbox.sh`).

| Coisa | Onde |
|---|---|
| Compose | `compose.staging.yml`, projeto `crm-staging`, rede `crm-staging` |
| Scripts | `scripts/staging/{secrets,up,down,status,seed-users}.sh` |
| Segredos | `/srv/secrets/crm-staging.env` (root:klarosk 640; nunca em chat/commit) |
| App | `http://<IP Tailscale>:3200` (e `http://127.0.0.1:3200` na VPS) |
| Supabase API (kong) | `http://<IP Tailscale>:56421` |
| Postgres | `127.0.0.1:56422` (e o IP do Tailscale), usuário `postgres` |
| E-mail (mailpit) | `http://<IP Tailscale>:56424` |
| Volumes | `crm-staging_staging-db`, `crm-staging_staging-storage` |
| Arquivos gerados | `.staging/` (não versionado): `kong.yml` com chaves, árvore do build do app |

O IP do Tailscale desta VPS está em `STAGING_BIND_IP` no env de segredos
(`tailscale ip -4`).

## Subir (de clone limpo)

```bash
cd /home/klarosk/projetos/DeskcommCRM-v1.17.0
bash scripts/staging/secrets.sh      # uma vez; nada regravado se já existe
bash scripts/staging/up.sh           # build no host + camada Supabase + baseline + seeds + produto
bash scripts/staging/status.sh       # ps, memória por container, portas
```

`up.sh` é idempotente: baseline reaplicado (é idempotente por desenho, é o
que o self-host aplica), seeds com `on conflict do nothing`, senhas dos
usuários fictícios reatualizadas. `--skip-build` reaproveita `.next/`;
`--no-seed` não toca em seeds.

Ordem de subida e por quê: `db` → (`auth`, `rest`, `storage`, `realtime`,
`mailpit`) → espera `auth.users` e `storage.buckets` existirem (migrations
do GoTrue e do Storage) → `kong` → extensões + `supabase/baseline.sql` →
`restart realtime` (a publication nasce no baseline) → seeds → `app` →
workers → `scheduler`.

## Derrubar

```bash
bash scripts/staging/down.sh        # containers e rede; volumes FICAM
```

Apagar volumes (`down -v`) apaga o banco do staging: decisão do proprietário.

## Usuários fictícios (smoke e navegação)

Senha comum em `STAGING_SMOKE_PASSWORD` (env de segredos; `secrets.sh` a
gerou, nunca é impressa):

| Tenant | E-mail | Papel | Origem |
|---|---|---|---|
| deka | `admin@deka.staging.test` | tenant_admin | só staging (`seed-users.sh`); o seed versionado tem `TODO-DEKA` (D48) |
| demo2 | `admin@demo2.test` | tenant_admin | `docs/tenants/demo2.seed.yaml` |
| demo2 | `atende@demo2.test` | attendant | `docs/tenants/demo2.seed.yaml` |

Nenhum é pessoa. Nada aqui manda mensagem a ninguém: `WHATSAPP_MODE=mock`,
`AI_PROVIDER=mock`, e-mail no mailpit, `SENTRY_DSN=off`.

## Exposição de rede — o que ESTE staging faz sozinho

Toda porta do staging é publicada só em `127.0.0.1` e em `STAGING_BIND_IP`
(`ports: - "127.0.0.1:3200:3000"` e `- "${STAGING_BIND_IP}:3200:3000"`). O
Docker só cria DNAT para esses destinos; pacote que chega pela interface
pública para o IP público não casa. Conferência, na VPS:

```bash
ss -ltn | grep -E ':(3200|5642[124]) '     # só 127.0.0.1 e o IP do Tailscale
sudo iptables -t nat -S DOCKER | grep -E '5642[124]|3200'   # DNAT com -d 127.0.0.1 ou -d <IP Tailscale>
```

De fora (do seu computador, SEM Tailscale ligado), `curl -m 5 http://<IP público>:3200/` tem de falhar.

## Firewall — o que é do proprietário (porta 1-way; descrito, não aplicado)

Achado de 12/09/2026, medido: a cadeia `DOCKER-USER` está vazia e o Docker
faz DNAT por baixo do `ufw`. Portas publicadas em `0.0.0.0` por OUTROS
stacks desta máquina estão alcançáveis pela interface pública — entre elas
o Supabase de desenvolvimento do checkout antigo (`54321` API, `54322`
Postgres com a senha padrão do CLI) e os Postgres de outros projetos. Isto
NÃO é o staging da F06 e não foi tocado. A regra que fecha a interface
pública para todo container e deixa Tailscale e loopback passarem:

```bash
# aplica agora (revisar a interface pública: eth0)
sudo iptables -I DOCKER-USER -i eth0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -I DOCKER-USER 2 -i eth0 -p tcp -m multiport --dports 80,443 -j RETURN   # o que deve continuar público
sudo iptables -I DOCKER-USER 3 -i eth0 -j DROP
# persistir (Ubuntu): sudo apt install iptables-persistent && sudo netfilter-persistent save
```

Antes de aplicar, listar o que hoje é publicado e decidir o que deve
continuar público (80/443 do transportes-os, e o que mais):
`docker ps --format '{{.Names}}\t{{.Ports}}'`.

## Memória e capacidade

VPS: 2 núcleos, 7,9 GB, dividida com outros projetos. Reserva de swap de
2 GB em `/swapfile` (reativada em 12/09 com `swapon /swapfile`; sem
`fstab`, como na F02 — não persiste a reboot). `mem_limit` por serviço no
compose. Medição real: `scripts/staging/status.sh`. A primeira subida está
registrada em `docs/migration/evidence/construction-f06-<data>.txt`.

## Backup e restore (F06-T05)

```bash
bash scripts/backup.sh          # pg_dump --format=custom do banco do staging → backups/staging-<data>.dump
bash scripts/restore.sh <dump>  # restaura num banco VAZIO criado para o teste, compara e apaga o banco de teste
```

O restore NUNCA toca `postgres` (o banco em uso): cria `restore_<data>` no
mesmo Postgres, restaura, conta tabelas e linhas dos dois lados e grava
`docs/ops/restore-staging.log` (`tables=T rows_diff=0`). Restore sobre banco em
uso ou produção é humano (D11, D26).

## Smoke e p95 (F06-T07/T09)

```bash
bash scripts/smoke.sh http://127.0.0.1:3200
```

Seis passos, cada um comparando NÚMERO (não HTTP 200): login por tenant
(2/2), clientes = seed, produtos = seed, POST de webhook mock, mensagem no
inbox, lembrete listado; mais `p95_ms` de 3 endpoints. A linha
`smoke: steps=6 pass=6/6 …` vai para o BUILD-STATE.

## O gate dentro do staging (ADR-028 §2)

```bash
# .env.e2e apontado para o staging (56421/56422, app do gate em 3202):
STAGING=1 bash scripts/staging/env-e2e.sh
# gate
sed -i 's/^current_phase: .*/current_phase: F06/' BUILD-STATE.md
VERIFY_ENVIRONMENT=staging F02_E2E_SANDBOX_ID=crm-staging E2E_PORT=3202 \
  VERIFY_LOG_DIR=.verify-logs/f06-gate-01 bash scripts/verify.sh
```

`unit`, `db` e `integration` continuam no Postgres efêmero de
`scripts/test-db.sh`; o navegador roda contra o banco, a auth e o storage do
staging. O bloco sai com `environment=staging` e `STATUS: READY (staging)`.

## Logs

```bash
docker compose -f compose.staging.yml --env-file /srv/secrets/crm-staging.env -p crm-staging logs -f app
```

Linhas JSON com `request_id` e `organization_id` (F06-T01): `msg=api.request`
por requisição, `msg=job.run` por transição de job nos workers.
