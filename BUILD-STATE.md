---
updated_at: 2026-09-14T19:40:00Z
head_commit: 767d22a66d167fb28440d41a3b9a7b55237b6b07   # código validado pelo gate f13-gate-05 (READY (staging), dentro do staging, F13 — ADR-034/035); produção com o código da F13 (linha prod:)
f00_commit: c85f7d72eebe33649812fe5cae174b7dd80e0e9f   # HEAD auditado do Deskcomm; verify.sh conta tests_deleted a partir dele
plan_version: "2.8 (2026-09-14); D38–D53; ADR-006…035"
integrated_release: db58c3fb3ef7acbf6ae9d0eaec278cb968958c5d   # v1.17.0; revalidada com dívida nominal herdada
current_phase: F13
next_task: F14-T00             # F13 concluída (READY (staging) f13-gate-05, produção com o código da F13); nenhuma fase começa sem nova mensagem (D50 c/D53 c); F14 (WhatsApp, chat do site, agenda) depende de número (D12-4) e de D41
status: READY_STAGING          # IN_PROGRESS | BLOCKED | READY_STAGING — BLOCKER-PROD aberto por desenho não vira BLOCKED (§8.9, D26)
baseline_n0: 8997
baseline_detail: "unit=7502/7503 integration=n/a db=1236/1238 e2e=259/290 @ c85f7d72; comandos: pnpm test:unit / test:db / test:e2e (E2E_PORT=3101, VITEST_MAX_THREADS=2, VITEST_MAX_FORKS=2; 11 falhas de e2e por ambiente, cinco itens no deskcomm-audit.md §1)"
hosting_confirmed: yes         # D50 (11/09/2026): staging nesta VPS, Docker Compose com Supabase local, acesso só por Tailscale — ADR-027
build_env: "Claude Code na VPS (4 núcleos/16 GB desde o reboot de 13/09 03:24Z; era 2/7,9 GB), worktree DeskcommCRM-v1.17.0; validação em serviços/bancos descartáveis e no staging; WHATSAPP_MODE=mock AI_PROVIDER=mock"
verify_summary_last_context: "f13-gate-05 aprovado em 14/09/2026 sobre 767d22a6, 7111 s, exit 0, DENTRO do staging (VERIFY_ENVIRONMENT=staging, Supabase local 56421/56422, app do gate em 3202), current_phase=F13 com a spec f13-crm-comercial (13 specs, 58 testes, ADR-035 §1) e a linha crm: (ADR-035 §2); rbac: roles=4 (papel manager, ADR-034). Cinco tentativas: 01 typecheck (tests/ fora do tsc que o agente rodou) + 4 suítes herdadas (formulário da empresa, rotas de empresa, ficha do contato, resourceId de auditoria); 02 prova shell herdada do kit HostGator sob carga (isolada 3/3); 03 typecheck (os mesmos 8 erros, agora vistos); 04 commercial-settings (manager perdeu settings.manage — regressão consertada); 05 READY. mutants_killed=65/65. Produção recebeu o código DEPOIS do READY (scripts/prod/up.sh + prova.sh, linha prod:). READY (staging) = verificado em staging; owner_validated em branco; BLOCKER-PROD aberto (liberado só para o tenant Deka, D53)."
verify_summary_last: |
  VERIFY SUMMARY
  scope=phase phase=F13 current_phase=F13 environment=staging
  build=ok lint=ok typecheck=ok shell=ok
  unit=8521/8521 integration=186/186 db=1666/1666 e2e=58/58 baseline_n0=8997
  baseline_comparable: scope=unit+db passed=10187 required=8738 full_n0=pending
  e2e_scope: F13-required passed=58/58 specs=13/13
  isolation: tables=138 ops=4 dirs=2 leaks=0 (material_cross_org=97/138)
  rls-coverage: tables_with_org_id=138 policies_found=116 missing=0 service_only_with_grant=0
  rbac: roles=4 denied_expected=32 denied_actual=32
  entitlement: usage_events_written=23
  ai_eval: cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0
  handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7 assignee=3 notify=3 notify_rows=6 msgs_after=3 provider_calls_after=0
  reminder: runs=2 sent=1 duplicates=0 tables_summed=3
  webhook: replay=2 stored=1 tables_checked=7
  logs: routes=285 routes_logged=285 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=4/7
  rate-limit: requests=101 status_429=1 auth_requests=101 auth_blocked=1 routes=285 routes_with_schema=285 routes_reading_input=154 validated=154
  lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=2
  admin: tenants_listed=3/3 support_sessions=2 support_reason=2/2 support_scope_denied=25/32 support_writes_denied=5/5 full_mode_rejected=1/1 signup_awaiting_payment=1/1 orgs_without_subscription=0/3
  billing: plans=3 events=6 duplicates=1 out_of_order=1 activations=1/1 blocked_writes_denied=5/5 grace_days=7 reconciliation_mismatch=0/3 cancellations=1/1 data_preserved=7/7
  crm: fields_defined=6 values_rejected=3/3 values_preserved=4/4 queue_size=5 distributed=5/5 balanced=1 second_claim_rejected=1/1 history_types=3 orders_linked=1/1 cross_org_link_denied=1/1 report_indicators=14/14 roles_denied=3/3
  replicability: e2e[deka]=ok e2e[demo2]=ok src_diff_lines=0 grep_deka_in_src=0 (deka=58/58 demo2=58/58 specs=13/13 org_a=seed-replica)
  secrets: files_scanned=529 findings=0
  tests_deleted=0 tests_skipped=0 expected_failures=0 tests_failed=0 tests_pending=0 mutants_killed=65/65
  debt_known=0 skip_only_occurrences=15 violations=0
  STATUS: READY (staging)
restore: tables=183 tables_restored=183 rows=11450 rows_diff=0 dump=staging-20260914T193108Z.dump target=restore_20260914_193109 seconds=14 at=20260914T193109Z
smoke: steps=7 pass=7/7 customers[deka]=0/0 customers[demo2]=3/3 inbox_new=1 logins=2/2 products[deka]=0/0 products[demo2]=4/4 webhook_accepted=1/1 reminder_listed=1/1 owner_login=1/1 subscriptions[deka]=active/full subscriptions[demo2]=active/full orgs_without_subscription=0/2 tenants=deka,demo2
p95_ms: endpoints=3/3 health=30 contacts=447 conversations=426 samples=20 url=http://127.0.0.1:3200
staging: compose=crm-staging services_running=15/15 memory_mib=1484 ports=127.0.0.1+tailscale(3200,56421,56422,56424) public_ports=0 host=4c/16GB swap=off image=F13(767d22a6)
prod: compose=crm-prod services_running=14/14 config_vars=27/27 placeholders=0/27 public_ports=0 https=1/1 hsts=1/1 vhosts_ok=7/7 owner_login=1/1 platform_admins=1 orgs=2 orgs_without_subscription=0/2 ai_turn=1/1 embedding=1/1 email=1/1 sentry_event=1/1 whatsapp=health_only backup=1/1 restore_rows_diff=0 sha=767d22a6
tenant_deka: created=1 plan=PLAN_C subscription=active origin=operator admin=platform_admin invites_sent=0/0 orgs=2 orgs_without_subscription=0/2 (D53, 14/09/2026 10:40Z)
prod_stack: compose=crm-prod services_running=14/14 memory_mib=2051 ports=127.0.0.1+tailscale(3300,56431,56432) public_ports=0   # F13: scripts/prod/up.sh (rebuild + baseline com o apêndice 9026) em 315 s, 14/09 19:33Z→19:38Z, DEPOIS do READY (ADR-034 §2 T06); crm_companies.custom_fields=1/1 fn_crm_report=1/1 no banco de produção
restore_prod: tables=183 tables_restored=183 rows=449 rows_diff=0 dump=prod-20260914T193845Z.dump target=restore_20260914_193846 seconds=11 at=20260914T193846Z
demo3: created=1 smoke=pass=6/6 e2e[demo3]=41/41 specs=10/10 removed=1 tenants=2   # F07-T03: scripts/verify/tenant-efemero.sh demo3 (13/09 06:57Z); smoke: customers[demo3]=1/1 products[demo3]=2/2 webhook_accepted=1/1 reminder_listed=1/1
from-scratch: steps=7 pass=7/7 verify_exit=0 status="READY (F07)" clone=~/projetos/.from-scratch-mPYH commit=d7543c14   # F07-T04, tentativa 4 (13/09 11:22Z→13:04Z): clone 1 s · install 6 s · sandbox 43 s · env 3 s · seeds 5 s (deka 10, demo2 52, rerun 0/0) · verify 6033 s no clone (unit 8492/8492 integration 155/155 db 1651/1651 e2e[deka]=41/41 e2e[demo2]=41/41 mutantes 56/56 inputs 3529/3529) · down 3 s; clone removido
---

# BUILD-STATE

## Estado vigente — F13 concluída em 14/09/2026 (READY (staging), f13-gate-05); produção com o código da F13; F14+ aguarda o proprietário (D50 c)

Construída em 14/09/2026 na branch `feat/F13-crm-comercial` (a partir de
`187fde8f`), com tasks e critérios em ADR-034 e o verificador v1.8 em ADR-035,
autorizada por D53. Entregue (sobre o CRM herdado, sem renome físico — ADR-034
§1): **campos configuráveis por organização** para contatos e empresas
(`tenant_settings` `crm.fields.contacts|companies`, tipo `custom_fields`;
migration 9026 `crm_companies.custom_fields` + apêndice + MANIFEST; validador
ÚNICO `src/crm/campos/validar.ts` nas rotas de contato e empresa; apagar
definição preserva valor; tela `/app/settings/tenant/crm-fields`; formulário da
empresa e ficha do contato) (T01); **papel `manager`** como quarto papel D15
(ADR-003 reaberta: `pipelines.manage`, `fields.manage`, `opportunities.assign`,
`reports.read` + `settings.manage`; sem usuários/produtos/acervo) (T02);
**fila de oportunidades** (`crm.distribution` manual|round_robin,
`crm.queue_roles`; `src/crm/oportunidades`: fila, rodízio puro reusando
`selectRoundRobin`, claim com 409, `owner_assigned`/`owner_claimed` na linha do
tempo; rotas `/api/v1/crm/opportunities/{queue,distribute,[id]/claim}` e
`/api/v1/settings/crm`; tela `/app/crm/fila`) (T03); **vínculo oportunidade →
pedido** (`crm_lead_links` target `order`, único por par, mesma organização;
`order_linked`; ADR-012 intocado) (T04); **relatório comercial** (`fn_crm_report`
security invoker; `GET /api/v1/reports/crm`; tela `/app/reports/crm`; 14
indicadores conferidos com a origem) (T05); spec `f13-crm-comercial` (7
testes), suíte de integração com a linha `crm:`, mutantes 66–68, §B17
consertado (`slug.ilike`) (T00/T06).

`./scripts/verify.sh` com `VERIFY_ENVIRONMENT=staging` e `current_phase: F13` saiu 0
com `STATUS: READY (staging)` sobre `767d22a6` (gate f13-gate-05, 7111 s), zero
violações: unit 8521/8521, integração 186/186, banco 1666/1666, navegador 58/58
em TREZE specs duas vezes (`E2E_TENANT=deka` 1346 s, `demo2` 1334 s, mesma
árvore, `src_diff_lines=0`), mutantes 65/65, `rbac: roles=4
denied_expected=32 denied_actual=32`, linha nova `crm: fields_defined=6
values_rejected=3/3 values_preserved=4/4 queue_size=5 distributed=5/5 balanced=1
second_claim_rejected=1/1 history_types=3 orders_linked=1/1
cross_org_link_denied=1/1 report_indicators=14/14 roles_denied=3/3`. Os 3.626
arquivos de entrada conservaram o SHA-256. Quinta tentativa: 01 typecheck
(`tests/` fora do `tsc` que o agente rodava) + quatro suítes herdadas
consertadas; 02 prova shell herdada do kit HostGator sob carga; 03 typecheck;
04 `commercial-settings` (manager sem `settings.manage` — regressão
consertada); 05 READY — detalhe na
[evidência F13](docs/migration/evidence/construction-f13-20260914.txt). Fora
do bloco: `restore:`/`smoke:`/`p95_ms:`/`staging:` (staging com a imagem da
F13) e `prod:`/`prod_stack:`/`restore_prod:` (produção com o código da F13,
subida DEPOIS do READY) no cabeçalho.

Defaults declarados, nunca fato (ADR-034 §5): `crm.distribution=manual`,
`crm.queue_roles=["attendant"]`, nenhum campo nasce definido, funil padrão
herdado ("Pedidos", 8 etapas), relatório sem meta nem alerta.

O que NÃO é fato: teste visual das três telas novas (proprietário); campos
configuráveis de OPORTUNIDADE continuam por funil (herdado); papéis
personalizados (D15) e `handoff.assignment=round_robin` (F15) não
construídos; relatório com dados reais da Deka; WhatsApp real, liberação
geral, Stripe (D12-4, D13, D52); `demo3`/`from-scratch` nesta fase.

## Estado vigente — F08 concluída em 14/09/2026 (READY (staging) + produção inicial de pé, f08-gate-03); histórico

Construída em 14/09/2026 na branch `feat/F08-producao-inicial` (a partir de
`dc45a638`), com tasks e critérios em ADR-032 e o verificador v1.7 em ADR-033,
autorizada por D52. Entregue: `compose.prod.yml` — stack `crm-prod` (14
serviços: Supabase local serviço a serviço, WAHA REAL no lugar do dublê, sem
mailpit — GoTrue pela Resend por SMTP, `AI_PROVIDER=anthropic`, Sentry próprio,
`mem_limit` em todos, portas só em `127.0.0.1` + Tailscale 3300/56431/56432,
`GOTRUE_DISABLE_SIGNUP=true` enquanto o BLOCKER-PROD estiver aberto) +
`scripts/prod/{secrets,up,down,status,bootstrap-owner,backup,restore,backup-diario,prova}.sh`
e as três jornadas versionadas (T02); domínio `crm.kntecnologia.app` no Caddy
do host — HTTPS/HSTS, robots privado, `/auth/v1`…`/realtime/v1` → kong (T03);
`platform_admin` real criado pelo proprietário (organização "KN Tecnologia",
PLAN_C `active/operator`) (T04); turno de IA pela Anthropic (`claude-haiku-4-5`,
5 chamadas por turno em `ai_usage_events`) e FAQ indexado com embedding da OpenAI
(`ai_chunks` 3/3, `vector(1536)`) (T05); e-mail real ao dono pela API do produto
(id da Resend) + recuperação de senha pelo GoTrue (T06); 1 evento no Sentry
próprio, `community=false`, 0/4 campos de PII (T07); WAHA real de pé, sessão
criada pelo produto aguardando QR (T08); backup diário 03:20 → Drive (1/1
confirmado), restore `rows_diff=0`, runbook `docs/ops/prod.md`, orçamento
declarado (T09); linha `prod:` por `scripts/prod/prova.sh` (T10). Achado da
primeira conexão real: o nome da sessão gerado pela reserva herdada (69 chars)
era recusado pelo WAHA 2026.7.2 (> 54) — migration 9025 conserta (ADR-032 §3).

`./scripts/verify.sh` com `VERIFY_ENVIRONMENT=staging` e `current_phase: F08` saiu 0
com `STATUS: READY (staging)` sobre `dc39424a` (gate f08-gate-03, 6007 s), zero
violações: unit 8508/8508, integração 175/175, banco 1661/1661 (com a prova da
9025), navegador 51/51 em DOZE specs duas vezes (`E2E_TENANT=deka` 1190 s,
`demo2` 1190 s, mesma árvore, `src_diff_lines=0`), mutantes 62/62, nenhum
teste apagado, pulado ou pendente. Nenhum campo novo no bloco (ADR-033). Fora
do bloco: `restore:`/`smoke:`/`p95_ms:`/`staging:` (staging) e `prod:`/
`prod_stack:`/`restore_prod:` (produção) no cabeçalho. Tentativas: 01 uma
régua real (comentário do compose), 02 uma prova sob carga (auditoria
fire-and-forget), 03 READY — detalhe na
[evidência F08](docs/migration/evidence/construction-f08-20260914.txt).

O que NÃO é fato: produção LIBERADA (D13 — o texto é do proprietário),
WhatsApp com número (D12-4), Stripe (D52, fase própria), a caixa de entrada
do proprietário, o cron do backup (primeira execução agendada), `demo3`/
`from-scratch` nesta fase. Cadastro público DESLIGADO no GoTrue até a
liberação.

## Estado vigente — F11+F12 concluídas em 13/09/2026 (READY (staging), f12-gate-05); histórico

Construídas em 13/09/2026 na branch `feat/F11-F12-admin-e-assinatura` (a partir de
`cfb3c34a`), com tasks e critérios em ADR-030 e o verificador v1.6 em ADR-031.
Entregue (F11): §B11/§B15/`size` (T00); dono fictício do staging
`owner@platform.staging.test` e coluna de assinatura em `/admin/tenants` (T01);
acompanhamento com motivo (10–500), escopo (`all|inbox|crm|settings|billing`),
vencimento (≤ 60 min) e SÓ leitura — migration 9024 `fn_start_support_saas`,
`rotaNoEscopo` no guarda (403 `support_scope`), banner com os três campos (T02);
empresa do admin nasce `active/operator` e convite passa por
`entitlement(users.invite)` — 402 `limit_reached` (T03); cadastro nasce
`pending_payment` com compensação, `/app` e `/onboarding` gateados
(`billing_only` → `/app/billing`), `requireRole` nega escrita com 402 (T04);
wizard conclui o telefone pelo canal de TESTE em `WHATSAPP_MODE=mock` (T05);
spec `f11-admin-e-entrada` (6 testes), mutantes 60–61 (T06). Entregue (F12):
migration 9023 `plans`/`subscriptions`/`billing_events`/`invoices` service_only,
prova de RLS 8/8+4/4 por tabela, backfill declarado (T01); resolver do
Entitlement por assinatura+plano+uso com `reason` enum (T02); checkout e webhook
do gateway MOCK assinado, idempotente por `(gateway, event_ref)`, fora de ordem
por `occurred_at`, ativa uma vez (T03); `/app/billing` e `GET/POST
/api/v1/billing/*` (T04); mudança de plano sem pro-rata e cancelamento
preservando dados (T05); inadimplência D44 — `past_due` com aviso,
`BILLING_GRACE_DAYS=7` (default declarado), varredura por tenant no worker do
lembrete → `blocked` só leitura, reativação pelo pagamento (T06); conciliação
faturas × eventos e `/admin/billing` (T07); spec `f12-assinatura` (4 testes),
mutantes 62–64, smoke com passo de cobrança (T08).

Defaults DECLARADOS, nunca fato (D14/D44/D51): `PLAN_A/B/C` com `name = code`,
`price_cents = 0`, `source = placeholder`, limites placeholder (A: 3 membros,
500 `ai.reply`/mês; B: 10/5000; C: sem limite); carência 7 dias; gateway `mock`;
ciclo 30 dias; sem pro-rata. Organização herdada sem assinatura =
`legacy_without_subscription` (permitida, medida pelo smoke).

Staging (13/09): baseline com 9023/9024 aplicado (`F12-T01 backfill: 2` — deka e
demo2 `active/backfill/PLAN_A`), seeds reexecutados (`rows_created=0`, sem
`fixture_existing_row_mismatch` — §B15 provado no staging tocado pelo smoke),
`seed-users.sh` com o dono, `BILLING_MOCK_WEBHOOK_SECRET` em
`/srv/secrets/crm-staging.env` (48 chars). Specs novas conferidas contra o
staging antes do gate: `f12-assinatura` 4/4, `f11-admin-e-entrada` 6/6
(`E2E_TENANT=demo2`; dois defeitos de prova consertados — corpo da resposta
descartado pela navegação, usuário sem organização não cai em `/get-started`).

`./scripts/verify.sh` com `VERIFY_ENVIRONMENT=staging` e `current_phase: F12` saiu 0
com `STATUS: READY (staging)` sobre `1e13071d` (gate f12-gate-05, 6261 s), zero
violações: unit 8500/8500, integração 175/175, banco 1660/1660, navegador 51/51
em DOZE specs duas vezes (`E2E_TENANT=deka` 1048 s, `demo2` 1109 s, mesma árvore,
`src_diff_lines=0`), mutantes 61/61, nenhum teste apagado, pulado ou pendente.
Campos novos (ADR-031): `admin: tenants_listed=3/3 support_sessions=2
support_reason=2/2 support_scope_denied=25/32 support_writes_denied=5/5
full_mode_rejected=1/1 signup_awaiting_payment=1/1 orgs_without_subscription=0/3`
e `billing: plans=3 events=6 duplicates=1 out_of_order=1 activations=1/1
blocked_writes_denied=5/5 grace_days=7 reconciliation_mismatch=0/3
cancellations=1/1 data_preserved=7/7`. `isolation` cresceu de 135 para 138
tabelas (`subscriptions`, `billing_events`, `invoices`), leaks=0. Os 3.573
arquivos de entrada conservaram o SHA-256. Quinta tentativa: 01 três réguas
reais, 02 uma prova real, 03/04 timeouts de 30 s no navegador sob carga de
outros projetos (deka 50/51 nos dois; a mesma jornada verde em demo2) mais dois
mutantes com alvo desatualizado, 05 READY — detalhe na
[evidência F11+F12](docs/migration/evidence/construction-f11-f12-20260913.txt).
Fora do bloco: ver `restore:`, `smoke:` (7 passos, com o de cobrança) e
`p95_ms:` no cabeçalho.

Limites de F11/F12: gateway, preço, nome dos planos e dias de carência são do
proprietário; nenhuma cobrança real, nenhum provedor real, nenhuma mensagem a
pessoa (D11/D51); a jornada paga REAL e o suporte sobre dados reais continuam
`NOT VALIDATED (real)`; as asserções de modo de edição das specs herdadas de
suporte (fora do gate) são §B16; o acesso do proprietário pelo navegador via
Tailscale não foi exercido (§8.6). A F08 tem preparação pronta FORA da árvore
(`~/projetos/CRM-OS/docs/f08/DECOMPOSICAO-F08-20260913.md`, `/srv/secrets/crm-prod.env`,
DNS `crm.kntecnologia.app`) e começa em branch nova a partir do HEAD final desta.


## Estado vigente — F07 concluída em 13/09/2026 (READY (staging) com os campos de §8.4); marco técnico do piloto; F08+ aguarda o proprietário (D50 c)

`./scripts/verify.sh` com `VERIFY_ENVIRONMENT=staging` saiu 0 com
`STATUS: READY (staging)` sobre `d7543c14` (gate f07-gate-07, 6196 s; o mesmo
bloco saíra no f07-gate-06 sobre `7632a058`, 5654 s — a diferença entre os dois
commits é a ADR-029 §5, que tira `next-env.d.ts` do snapshot de inputs), com zero
violações: unit 8492/8492, integração 155/155, banco 1651/1651, navegador
41/41 em dez specs **duas vezes** — `E2E_TENANT=deka` (1108 s) e `E2E_TENANT=demo2`
(1138 s) na mesma árvore, sem commit entre elas, contra o Supabase do staging —
mutantes 56/56, nenhum teste apagado, pulado ou pendente. O campo
`replicability` foi medido pela primeira vez como §8.3 pede:
`e2e[deka]=ok e2e[demo2]=ok src_diff_lines=0 grep_deka_in_src=0 (deka=41/41
demo2=41/41 specs=10/10 org_a=seed-replica)` — a árvore de `src/` tem o mesmo
sha antes da primeira e depois da segunda execução (`c527a699…`). Os 3.529
arquivos de entrada conservaram o SHA-256 (`65f0bfe6…`). Fora do bloco: `restore: tables=179
rows_diff=0` (banco vazio criado para o teste, D36), `smoke: steps=6 pass=6/6`
e `p95_ms: endpoints=3/3` contra o container do staging, `demo3: created=1
smoke=pass=6/6 e2e[demo3]=41/41 removed=1 tenants=2` (T03) e `from-scratch:
steps=7 pass=7/7 verify_exit=0` (T04, clone novo + sandbox novo + seeds +
`verify.sh` → `READY (F07)`). [Evidência F07](docs/migration/evidence/construction-f07-20260913.txt);
[FINAL-VALIDATION](FINAL-VALIDATION.md) com as oito seções de §8.7.

Sétima tentativa (a sexta já era READY; a sétima revalidou o commit final),
nenhuma reclassificada: a 01 achou um defeito real numa
prova (o pdf.js parte "779c2395" em "7 79c2395" e a spec do PDF diário
comparava com espaço exato — consertada) e duas falhas por carga; a 02 e a 03
reprovaram no banco por timeouts com a VPS de 2 núcleos em thrash (load
average 100–300, swap cheio, builds/instalações/Playwright de outras sessões);
a 04 achou o segundo defeito real de replicabilidade (a prova de acervo exigia
o outro tenant VAZIO; com A vinda do seed do demo2 ele tem o "FAQ do seed" —
consertada tela contra banco); a 05 reprovou em duas provas shell herdadas do
kit HostGator truncadas por carga (o próprio teste documenta o modo de falha);
a 06 saiu READY sobre `7632a058`; o from-scratch sobre esse commit achou que
`next-env.d.ts` (gerado pelo `next build`) estava na lista de inputs e reprovava
um clone limpo — a 07 revalidou o commit com o conserto (ADR-029 §5). Entre a
03 e a 04 o proprietário reiniciou a VPS, que voltou com 4 núcleos e 16 GB.

T01–T09 entregues (ordem impressa em §7.8): verify v1.5 (ADR-029) com F07 no
gate e o navegador rodando uma vez por tenant do seed — a organização A de
cada fixture nasce por `scripts/create-tenant.sh` a partir de
`docs/tenants/<slug>.seed.yaml` (`E2E_TENANT`), B continua fictícia; loader do
seed completo (§B13: `products`, `customers`/`crm_companies`, `faq` no acervo,
`onboarded_at`, sentinelas `TODO-` contadas e não gravadas); tenant efêmero
`demo3` por YAML novo criado, coberto por smoke e navegador e removido
(`scripts/verify/tenant-efemero.sh`); `scripts/from-scratch.sh`; invariantes
`tests_deleted=0 tests_skipped=0 mutants_killed=56/56`; FINAL-VALIDATION.md;
`docs/ai-eval/pilot-queries.sql` (4 medidas, cada uma devolve uma linha em
staging); README do fork; BLOCKER-PROD aberto (abaixo) em `blocker/PROD`.
Duas specs deixaram de pressupor organização vazia e duas provas de
replicabilidade ganharam o mesmo tratamento — o conserto é de prova, não de
expectativa (ADR-029 §2).

**D50 (c)**: F08+ não começa antes da próxima mensagem do proprietário. F08
depende dos sete itens de D12 e da aprovação de produção (D13) — é o
BLOCKER-PROD. `status: READY_STAGING` é o nível "verificado em staging" de
§8.1; "validado pelo proprietário" (`owner_validated`) continua em branco.

Limites de F07: nenhum provedor real (WhatsApp adapter mock, IA mock, e-mail
no mailpit, `SENTRY_DSN=off`); o acesso do proprietário pelo navegador via
Tailscale não foi exercido (teste visual é humano, §8.6); o run do
`verify.yml` no GitHub e o link são do proprietário; `e2e[<tenant>]` significa
"organização A provisionada do seed daquele tenant pelo loader" (ADR-029 §2),
não "dentro do tenant persistente"; o deka entra como está (59 `TODO-DEKA`);
`products[].size` não tem coluna e é declarado; swap não reativado após o
reboot (VARREDURA §B14); §B15 (rerun do `up.sh` com fixtures em staging tocado
pelo smoke da F06) e §B12 (firewall dos outros stacks) são do proprietário.
Decisões que continuam do proprietário: §B5/§C6, §C5, §B11, §B12, §B14, §B15.


## Estado anterior — F06 concluída em 12/09/2026 (READY (staging), dentro do staging); construção PAUSADA antes da F07 (D50 c)

`./scripts/verify.sh` com `VERIFY_ENVIRONMENT=staging` saiu 0 com
`STATUS: READY (staging)` sobre `270852a6`, em 6094 s (101,6 min), com zero
violações: unit 8491/8491, integração 153/153, banco 1651/1651, navegador
41/41 em dez specs contra o Supabase do STAGING desta VPS (loopback
56421/56422, app do gate em 3202), mutantes 54/54, nenhum teste apagado,
pulado ou pendente. As três métricas de F06 (ADR-028) foram medidas: `logs:
routes=270 routes_logged=270 workers=4 workers_logged=4 request_log_org_id=1/1
sentry_mock_captured=1 pii_fields=4/7`, `rate-limit: requests=101 status_429=1
auth_blocked=1 routes=270 routes_with_schema=270 routes_reading_input=143
validated=143`, `lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=2`. Os 3.522
arquivos de entrada conservaram o SHA-256. Fora do bloco, como §7.7 manda:
`restore: tables=179 rows_diff=0` (banco vazio criado para o teste, D36) e
`smoke: steps=6 pass=6/6` contra o container do staging, com `p95_ms:
endpoints=3/3`. [Evidência F06](docs/migration/evidence/construction-f06-20260912.txt).

Segunda tentativa: a 01 foi interrompida em unit (8487/8490) por três réguas
reais — o scanner de segredos casava as URLs de Postgres montadas por
interpolação nos scripts novos, e o job `verify.yml::verify` não estava no
mapa de jobs do CI — consertadas em `270852a6`; nenhuma falha foi de carga
(load average 1 no lançamento, com o Supabase de desenvolvimento do checkout
antigo parado).

T01–T09 entregues: logs JSON com `organization_id` e `request_id` em toda rota
(linha no guarda de papel + 30 rotas explícitas) e nos workers, captura de
erro com allowlist de quatro campos (§5.17); rate limit no webhook SaaS por
(provedor, IP) e schema em toda rota que lê entrada, mais o conserto do §B10
(`Idempotency-Key` no `POST /api/v1/messages`); LGPD mínima por duas ações
`high` só humanas do catálogo D17 sobre o grafo de FKs lido do catálogo;
varredura de segredos e inventário do `.env.example` no CI (e a guarda G-51 do
scanner, morta desde F01, consertada); `verify.yml` rodando o gate em todo PR;
`backup.sh`/`restore.sh`; `compose.staging.yml` (15 serviços, Supabase local
escrito serviço a serviço, portas só em loopback e Tailscale) com
`scripts/staging/*` e runbook `docs/ops/staging.md`; `smoke.sh` com seis
passos e p95. verify v1.4 (ADR-028): F06 no gate, três campos novos,
`environment=` no bloco e `READY (staging)` a partir de F06 dentro do staging.

**D50 (c)**: a F07 não começa antes da próxima mensagem do proprietário;
`next_task: F07-T01` é retomada, não autorização. O staging fica de pé
(`scripts/staging/status.sh`); o Supabase de desenvolvimento do checkout
antigo ficou parado (`supabase start` em `~/projetos/DeskcommCRM` o devolve).

Limites de F06: nenhum provedor real (WhatsApp adapter mock, IA mock, e-mail
no mailpit, `SENTRY_DSN=off`); acesso do proprietário via Tailscale não
exercido nesta sessão (URL e usuários fictícios no runbook); o run do
`verify.yml` no GitHub e o link são do proprietário (§7.7 T08); regra de
firewall para os outros stacks desta máquina (VARREDURA §B12) e persistência
do swap (§B14) são portas 1-way do proprietário; `READY (staging)` aqui é a
saída da F06 (D50/§7.7) — a F07 imprime o mesmo rótulo com os campos de §8.4.
Decisões que continuam do proprietário: §B5/§C6, §C5, §B11 (DSN da comunidade
por padrão), §B13 (seed `customers`/`products` não carregados).


## Estado vigente — F05 concluída em 12/09/2026; construção PAUSADA antes da F06 (D50)

`./scripts/verify.sh` saiu 0 com `STATUS: READY (F05)` sobre `5aa5de54`, em
7616 s (126,9 min), com zero violações: unit 8472/8472, integração 148/148,
banco 1651/1651, navegador 41/41 em dez specs, mutantes 49/49, nenhum teste
apagado, pulado ou pendente. `handoff` e `reminder` deixaram de ser `pending`
e foram medidos: `handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7
assignee=3 notify=3` e `reminder: runs=2 sent=1 duplicates=0`. `isolation`
cresceu de 132 para 135 tabelas (`notifications`, `email_outbox`,
`reminder_runs`), leaks=0. Os 3.492 arquivos de entrada conservaram o SHA-256.
[Evidência F05](docs/migration/evidence/construction-f05-20260912.txt).

Foi a sétima tentativa, e nenhuma foi reclassificada: a 01 e a 03 foram
interrompidas ao ver a falha; a 02 apontou dois defeitos reais (a constraint
`job_queue_kind_check` reconstruída em dois blocos do baseline; a FK composta
nova presa ao índice que o replay da 9005 derruba) — consertados em `5aa5de54`;
a 04, a 05 e a 06 reprovaram só no navegador, com a VPS dividida com outros
projetos (load average 12–21). A única falha recorrente foi explicada pelo
trace: o `POST /api/v1/messages` herdado não honra `Idempotency-Key` e o
`apiClient` repete o POST após 10 s — mensagem duplicada sob latência
(VARREDURA §B10, não aplicado).

T05–T09 entregues: notificações por usuário para os seis eventos de §5.16 com
e-mail mock (`notifications`, `email_outbox`); lembrete recorrente PJ por
período (`reminder_runs`, cron por tenant em `job_queue`/`job_runs`, conversa
criada ou reaberta em `waiting_customer` com a tag `awaiting_quantity`, envio
só pelo catálogo com executor `automation`); resposta do cliente virando
`update_order_quantity` com confirmação `by_risk`, corte sem resposta com aviso
e tentativa de tarefa registrada, resposta tardia para gente; tela de uso de
IA do `tenant_admin` sobre `ai_usage_events`. Decisões em ADR-026; hosting em
ADR-027.

**D50 (11/09/2026)**: `hosting_confirmed: yes` — staging nesta VPS, Docker
Compose com Supabase local, acesso só por Tailscale; o PR em rascunho da branch
é aberto após este READY; **a F06 não começa antes da próxima mensagem do
proprietário** (a pausa de D47 volta a valer para F05→F06). `next_task` aponta
F06-T01 como retomada, não como autorização.

Limites de F05: tudo com `WHATSAPP_MODE=mock` e `AI_PROVIDER=mock`, duas
empresas fictícias; nenhuma mensagem saiu para pessoa e nenhum provedor real
foi contatado (e-mail e IA reais: NOT VALIDATED (real)). A tarefa do corte do
lembrete é recusada pelo domínio (executor não-humano — decisão do
proprietário, VARREDURA §B5/§C6) e a recusa fica gravada e auditada. A
exceção configurável para resposta tardia (§7.6 T08) não existe: o desfecho é
humano. O sandbox descartável foi derrubado ao fim.


## Estado vigente — F04 concluída em 11/09/2026; F05 parcial; construção pausada para troca de sessão

`./scripts/verify.sh` saiu 0 com `STATUS: READY (F04)` sobre `76c0b00b`, em
5143 s (85,7 min), na primeira tentativa e com zero violações: unit 8462/8462,
integração 128/128, banco 1637/1637, navegador 37/37 em nove specs, mutantes
46/46, nenhum teste apagado, pulado ou pendente. `ai_eval` foi medido:
`cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=5
provider_calls_at_zero_balance=0`. Os 3.463 arquivos de entrada conservaram o
SHA-256 antes e depois. [Evidência F04](docs/migration/evidence/construction-f04-20260911.txt).

F05 tem T01–T04 (handoff: oito motivos em enum, dossiê de sete campos, fila de
claim, guarda pós-handoff) e T10 (verificador v1.3) na árvore, provados
focalmente e cobertos pelo gate acima como código, **não** como fase: as
linhas `handoff` e `reminder` seguem `pending` de propósito. Faltam T05
(notificações), T06–T08 (lembrete recorrente) e T09 (tela de uso de IA).
`next_task: F05-T05`.

F06 está bloqueada por `hosting_confirmed: no` (§7.7, D03, D11). F07 depende
dela. Portões do proprietário, achados abertos e o mapa de retomada estão em
[VARREDURA-MELHORIAS](docs/migration/VARREDURA-MELHORIAS.md) e
[RETOMADA-20260911](docs/migration/RETOMADA-20260911.md).

O push da branch está bloqueado por falta do escopo `workflow` no token do
`gh`; tudo está commitado localmente. Sandbox descartável derrubado, zero
containers e portas livres.


## Estado vigente — F03 concluída em 11/09/2026

`./scripts/verify.sh` saiu 0 com `STATUS: READY (F03)` sobre
`6d742a6bc2f6c080055c9200c2b0aaf613b1b75b`, em 4031 s (67,2 min), com zero
violações: unit 8408/8408, integração 87/87, banco 1616/1616, navegador 27/27
em oito specs, mutantes 36/36, nenhum teste apagado, pulado ou pendente. Os
3.394 arquivos de entrada conservaram o mesmo SHA-256 antes e depois
(`f323a031…f27c0f4`). O campo `webhook` deixou de ser `pending` e foi medido:
`replay=2 stored=1 tables_checked=7`.
[Evidência F03](docs/migration/evidence/construction-f03-20260911.txt).

Duas tentativas anteriores reprovaram e nenhuma foi reclassificada. A primeira
apontou `mock_outbox` e `job_runs` como tabelas tenant-aware sem prova
comportamental de RLS — os testes conferiam catálogo, não comportamento; a
prova de verdade foi escrita em dois tenants e o anti-vácuo foi medido nas
duas tabelas. A segunda apontou uma corrida de deadlock nossa, de F02-T03, que
afirmava ordem de chegada em vez de partição; a asserção passou a ser mais
forte que a anterior. As duas medições estão na evidência versionada.

T01–T10 entregues: máquina de estados D16 sobre o ciclo herdado por coluna
própria e projeção total; contrato de canal com adapter WAHA embrulhado e
adapter mock; tenant do webhook por `channel_accounts` com quarentena contada;
idempotência de entrada aditiva; pipeline de entrada preservando demanda e
revisão; envio humano pelo catálogo de ações; fila de saída com retry,
`blocked` e worker que sobe solto; inbox operando pelas transições com o estado
visível e filtrável; e o verificador v1.1 com o campo `webhook` medido.
Decisões em ADR-016 a ADR-021.

D49 (11/09/2026) suspendeu a pausa por fase de D47: a construção segue para F04
sem aguardar nova mensagem. Continuam do proprietário, e viram pendência
declarada: produção, mensagem real a pessoa, número real da Deka, gasto novo,
gateway de pagamento e preço/plano/nome da plataforma.

Limites de F03: tudo com `WHATSAPP_MODE=mock` e duas empresas fictícias;
nenhuma mensagem saiu para pessoa e nenhum provedor real foi contatado. A
conversa nova a partir de `archived` que D34 pede não foi entregue e depende de
decisão do proprietário (ADR-019). O sandbox descartável foi derrubado ao fim.


## Estado vigente — F02 concluída e construção pausada em 10/09/2026

O gate integral07 sobre `03ec6a3b56826ab882782efb1dd5185f47e52a8c` encerrou
com exit0 e `STATUS: READY (F02)` em 10/09/2026 às 06:11:30 UTC (03:11:30 de
Brasília). Tipos, lint, build e shell passaram; unit8380/8380, integração72/72,
banco1585/1585, navegador13/13 em sete specs e mutantes27/27, sem falhas,
skips ou violações. Os 3.336 arquivos de entrada conservaram o mesmo SHA-256
antes/depois da execução. A CI34439000032 e o Docker34439000033 passaram.
[Evidência T13](docs/migration/evidence/construction-f02-t13-20260909.txt).

T01–T13 estão concluídas: contatos/empresas/catálogo, pedidos e itens, notas e
tarefas, configuração comercial, auditoria/API, relatório diário, impressão e
conferência por revisão. A consulta exige data e critério explícitos; as regras
comerciais da Deka serão configuradas após seu acesso (D48).

D47: a construção está pausada antes da F03. `next_task` registra a próxima tarefa,
mas sua execução exige nova mensagem do proprietário. O status geral permanece
`IN_PROGRESS`: F07 é o marco de staging e F17 reúne o aceite comercial do SaaS.
Consumo observado e equivalência de API constam no [relatório de construção](https://github.com/iaklarosk-web/CRM-OS/blob/codex/plano-saas-v1.17.0/docs/custos/construcao-uso.md);
Snapshot de 10/09/2026 às 06:18:16 UTC (03:18:16 de Brasília): 529,767,815 tokens
observados desde 09/09 às 15:07:45 UTC, incluindo 514,087,424 tokens de entrada em
cache; equivalência de API Standard US$509.445639. Modelos/esforços observados:
Astra ultra, Sol high e Terra medium, em 11 rollouts pertencentes à construção.
O snapshot não inclui mensagens posteriores ao corte e não representa cobrança
da assinatura, custo interno do provedor nem saldo semanal.

Limites: fixtures fictícias em duas empresas, WhatsApp/IA mock e sandbox local.
Aceite visual/humano, operação Deka, provedores reais, produção e E2E integral do
upstream não foram validados. Os campos de aceite humano permanecem em branco.
Os indicadores de IA/handoff/lembrete/webhook pendentes pertencem a fases futuras.

A VPS foi reiniciada manualmente pelo painel; Git e migrations foram preservados,
sem indício identificado de corrupção. A causa original não foi estabelecida.
Os testes pesados rodaram em série, com a reserva de swap existente reativada;
a reserva não tem ativação persistente configurada para o próximo reboot.
Os seis containers, dois volumes e a rede descartáveis da F02 foram removidos
após arquivar as evidências. Arquivos privados de ambiente e metadados foram
preservados. `tos-postgres-dev` e `run-u1201.service`, externos a esta tarefa,
continuavam parados/com falha na checagem final e não foram alterados.
[Recuperação](docs/migration/evidence/construction-f02-recovery-20260909.txt).

## Histórico da recuperação e dos checkpoints parciais de 09/09/2026

D47 exige pausa ao concluir F02, com evidências e consumo; F03 só começa após
nova mensagem do proprietário. D48 determina que a Deka informará seus dados
ao receber acesso: nenhuma pendência da entrevista bloqueia a engenharia genérica.
Estas decisões substituem as dependências antigas de dados Deka descritas abaixo.

T04–T08 estão integradas localmente, com [evidência parcial](docs/migration/evidence/construction-f02-t04-t08-20260909.txt).
T10/T11 têm consulta/tela/impressão integradas; unit focal 17/17, integração diária
3/3, mutantes de truncamento de backend e UI 1/1 cada. T12 recebeu core, migration
9012 e tipos gerados; unit21/21, integração12/12, banco120/120 e export3/3
mais coletor6/6 passaram. O gate integral T13 segue em andamento: a tentativa
f02-final-04 já aprovou tipos/lint/build/shell, com build444s.
Nenhuma dessas contagens declara F02 pronta. O resumo F01 abaixo é histórico.

A VPS foi reiniciada manualmente pelo painel em 09/09, por volta de 19:50 de
Brasília. Git, migrations aplicadas e dados do sandbox foram preservados; o
conteúdo temporário de /tmp foi perdido. [Recuperação](docs/migration/evidence/construction-f02-recovery-20260909.txt).
Preparação dos subagentes passou a diretórios persistentes, e verificações
pesadas são executadas em série. A causa do travamento original não foi estabelecida.

A CI do checkpoint publicado 5f879175 concluiu com sucesso (run 34408643274),
após corrigir as três falhas do checkpoint T03 anterior. A continuação T04–T12
precisa de nova validação; esse resultado não se transfere ao código não publicado.

O checkpoint T13 `aa831343` corrige os testes legados do novo painel/contrato
canônico, registra a diária no hub CRM e ajusta a fixture de upgrade para T12.
A CI anterior `34421338576` mediu unit8366/8376 e DB1584/1585; esses resultados
não eram verdes. Os 77 casos focais foram reconciliados (75/77 inicial +27/27
na rechecagem de navegação) e DB8/8 passou, incluindo o upgrade duplo.
A tentativa local04 foi encerrada após obter esse inventário completo da CI;
sua suíte unitária parcial não é contada como aprovação integral. A CI nova `34422892675` passou: unit8376/8376 e DB1585/1585; Docker34422892627 também passou. O navegador final01 mediu9/13: navegaçãoB, extração do PDF A/B e captura da resposta de suporte falharam e estão em reparo. Navegador/PDF A/B e novo gate completo seguem pendentes.
[Evidência T13](docs/migration/evidence/construction-f02-t13-20260909.txt).

As rechecagens aprovaram navegaçãoA/B e daily/checksA/B com PDF completo. O suporte revelou diferença entre o identificador do header e o registrado em auditoria; a [ADR-015](docs/decisions/ADR-015-request-id-canonico-F02.md) orienta a correção. Novo navegador e gate integral seguem obrigatórios. F03 não iniciada.

## Checkpoints anteriores (estado histórico)

Plano vigente: [DIRETRIZ v2.2](docs/DIRETRIZ.md), decisões D45–D46 e [ADR-011](docs/decisions/ADR-011-construcao-por-fases-e-consumo.md). **A construção por fases está autorizada e F02 está em andamento** na branch `codex/f02-crm-pedidos`. Cadastros/API/UI e saneamento das três dívidas estão implementados com provas focais. Pedidos operacionais já têm domínio, migrations, comandos transacionais, API, telas e histórico. As jornadas de cadastros e pedidos passaram no navegador. Tipos, lint e build passaram; as dez falhas da regressão global passaram nas rechecagens focais. Os checkpoints T01/T02 e T03 estão registrados, com revisão independente e provas locais. F02 e as partes ainda incompletas de T04–T06 não recebem `done` por esse checkpoint.

O destino é um SaaS comercial com marca do proprietário, painel/login da administração da plataforma e identidade própria dos clientes. O onboarding inclui cadastro, contratação, conexão WhatsApp e configuração guiada de IA, com ajuda opcional; o acesso operacional depende de confirmação confiável da assinatura/pagamento. A primeira versão comercial inclui WhatsApp, chat do site, agenda de clientes/equipe com Google Agenda sincronizada e e-mail transacional. Instagram/e-mail de entrada e ERP/adjacentes são evolução posterior. F07 é marco técnico em staging; F17 é aceite comercial da versão.

## Construção F02 — evidência parcial de 09/09/2026

Checkpoint de código `c81a59b8`, precedido por saneamento em `30b693ae` e backend em `d06ad310`. [Evidência e proveniência](docs/migration/evidence/construction-f02-t01-t02-20260909.txt). As contagens abaixo não substituem o resumo histórico nem representam `READY`:

| Recorte medido | Resultado observado | Limite |
|---|---|---|
| Cadastros: schema/RLS, instalação e reaplicação | 93/93 | Banco descartável; não valida regras comerciais da Deka |
| Pedidos: schema/RLS, instalação e reaplicação | 107/107 | Migrations 9006/9007; tipos gerados no sandbox local |
| Serviço de pedidos | 20/20; mutante de troca de contato 1/1 | Transações, concorrência, replay, isolamento, snapshots e LGPD. Ampliação do export também passou novamente em 20/20 |
| Cadastros no navegador | 1/1, três etapas internas, zero skips/retries | Empresas, produtos/unidades e vínculo do contato; duas organizações fictícias e viewer |
| Regressão unitária, três partes | 8.079/8.089, 761 arquivos, zero testes pendentes | Dez falhas localizadas; todas passaram nas rechecagens focais, não é uma execução integral verde |
| Primeiras correções de compatibilidade | 25/25 | UUID em HTTP/local e identidade auditada de empresa |
| API, suporte, CI, inventário e export focal | 20/20 | Registro de specs no CI não comprova execução no GitHub |
| Pedidos no navegador | 2/2, zero skips/retries/flaky | Duas jornadas A/B; quatro organizações/quatro usuários removidos, oito tabelas de domínio sem resíduos por jornada |
| Build atual, tipos e lint | exit 0 nos três | Build 358,5s, 1.908 entradas sem alteração, bundle com host local; lint 356 warnings herdados |

A tentativa unitária única terminou externamente com código 143 e sem relatório final; causa não estabelecida. As três partes seguintes cobriram os 761 arquivos do manifesto. As partes 1/2 precedem as correções de UUID/auditoria; a parte 3 as sucede. Relatórios e tentativas permanecem em `.verify-logs/f02-global-current/`; rechecagens focais têm nomes próprios. Nenhum resultado parcial é apresentado como uma execução integral verde.

A rechecagem final de UI/i18n e guardas passou em 67/67; mutantes de confirmação com pendência, de suporte e de escopo do export passaram em 1/1 cada. As dez falhas originais foram reconciliadas por arquivo/nome com casos aprovados nas rechecagens. A proteção nova contra descarte de item sem descrição também passou. As três dívidas herdadas foram transformadas em casos normais, corrigidas e verificadas focalmente; o verificador de F02 ainda precisa ser ampliado na T13. No checkpoint T01/T02, T03 ainda tinha propostas em diretório temporário: serviço/schema 13/13 e 7/7, API 15/15 e export 3/3. A promoção e as provas atuais estão na seção T03 abaixo; aquelas provas preparatórias não concluíam a task. A data que rege a lista, unidades/preços reais, impressão e conferência permanecem pendentes com a Deka. F03 segue dependente da conclusão de F02.

## F02-T03 — checkpoint local validado

Código `e14c72c5`, precedido pelo backend `b7054be0`. A [ADR-013](docs/decisions/ADR-013-notas-e-tarefas-de-pedidos.md) e as migrations 9008/9009 acrescentam notas humanas, tarefas vinculadas, histórico canônico e proteção das tarefas legadas. A 9009 repara vínculos cruzados antes da FK da 9008 e impede texto pessoal tardio após anonimização; a 9008 aplicada permaneceu imutável. [Evidência T03](docs/migration/evidence/construction-f02-t03-20260909.txt): integração 37/37, schema/RLS/LGPD 146/146 reconciliados em duas execuções, UI 55/55, unit final 56/56 e mutantes de banco 3/3 + UI 3/3. Falhas de preparação e rechecagens estão preservadas. Build final estável (1.927 entradas), typecheck e lint global/focal saíram 0. Browser final A/B: 2/2 numa execução após as correções, sem retries/skips/flaky; por jornada, 2 organizações/2 usuários removidos e 12 tabelas de domínio sem resíduos. Tipos regenerados coincidem com a árvore. T04–T08 seguem com trabalho preparado e pendências próprias; não é um gate integral F02.

A CI do checkpoint T03 `ef4e32ec` aprovou **1.556/1.556 invariants em 191 arquivos**, tipos, lint e o verificador de provedores. A regressão unitária aprovou **8.190/8.193** em 767 arquivos e encontrou três falhas de integração: posição da varredura anon, declaração redundante de FK no baseline e quatro labels de UI sem display. Os reparos estão sendo tratados junto da continuação F02; a CI completa ainda não está verde.

O GitHub concluiu uma regressão integral do checkpoint anterior `4b70c929`: **761 arquivos e 8.100 testes unitários aprovados**, além de tipos, lint, shell e imagens Docker. A suíte de banco desse checkpoint teve seis falhas; as correções estão identificadas e revalidadas localmente na evidência T03. Isso não substitui a próxima execução de CI nem o gate F02. A execução de imagens em PR constrói e testa, sem publicar ou promover `stable`.

## Revalidação da F01 sobre v1.17.0 — 08/09/2026

**REVALIDATED WITH DEBT (F01)** no commit de código `a86ca7c4234722d8422e833dbefcaf986fad1797`: build/lint/typecheck/shell aprovados; unitários 7965/7966, integração 6/6, banco 1499/1501, mutantes 2/2 e nenhuma nova violação. [Evidência e proveniência](docs/migration/evidence/revalidation-f01-v117.txt). As três dívidas herdadas são a classificação de compromisso em andamento, opt-out de acompanhamento pausado e o skip de rate limit; naquele resultado impediam READY no gate normal. Na árvore atual foram corrigidas, com casos antes marcados convertidos em testes normais e mutantes; falta publicar o novo gate completo. Isolamento: 117 tabelas, quatro operações em duas direções, leaks=0; provas com linhas entre empresas em 90/117 tabelas. A contagem de policies do verificador não é o total de policies do catálogo. E2E da combinação e serviços reais continuam pendentes.

A [ADR-006](docs/decisions/ADR-006-integracao-v1.17.0.md) fixa a release `db58c3fb` e preserva a fundação de `960a469`. A [ADR-007](docs/decisions/ADR-007-verify-revalidacao.md) distingue revalidação de F01, dívida nominal e prontidão: resultado com dívida não é `READY`, e revalidar F01 não conclui F02. Tentativas que falharam e repetições permanecem identificadas na evidência. O cabeçalho preserva o resultado composto histórico de 08/09/2026. O resumo literal de **07/09/2026** foi preservado na seção histórica abaixo, com sua terminologia e contagens antigas.

A prova reproduzível de atualização a partir do baseline F01 está em [scripts/verify/upgrade-f01-v117/README.md](scripts/verify/upgrade-f01-v117/README.md), com [evidência observada](docs/migration/evidence/upgrade-f01-v117.txt). Ela cobre o banco descartável e não substitui a bateria completa nem demonstra serviços reais.

## Fases (D07; plano v2.3)

`done` em F00/F01 registra o fechamento histórico de 07/09/2026. A revalidação da combinação com v1.17.0 está separada acima. F08–F17 têm objetivos e critérios em DIRETRIZ §7.9; suas tasks serão decompostas antes da execução.

| Fase | Nome/entrega | Estado |
|---|---|---|
| F00 | Auditoria, verificador, ADR-001…003 e baseline N0 | done(verify=2026-09-07 2a23537e) |
| F01 | TenantContext, TenantConfiguration, Entitlement mínimo, seeds deka/demo2 e criação de tenant | done(verify=2026-09-07 6f7c56fc) — histórico; revalidação v1.17.0 com dívida em 08/09/2026 |
| F02 | CRM mínimo e pedidos do dia: clientes/empresas, catálogo, pedidos/itens, histórico, tarefas/notas, lista por produto/entrega, impressão e conferência | done(verify=2026-09-10 03ec6a3b) — T01–T13 concluídas; construção pausada antes de F03 |
| F03 | WhatsApp de entrada/saída via WAHA, adaptação do ChannelAdapter, Inbox e ciclo das conversas | done(verify=2026-09-11 6d742a6b) |
| F04 | Adaptar o motor de IA/RAG, Action Policy e nove ferramentas ao contrato CRM-OS | done(verify=2026-09-11 76c0b00b) |
| F05 | Adaptar handoff e notificações; criar regra de lembrete PJ sobre infraestrutura existente | done(verify=2026-09-12 5aa5de54) — T01–T10 concluídas; pausada antes de F06 (D50 c) |
| F06 | Deploy de staging, mocks, segurança/observabilidade e smoke | done(verify=2026-09-12 270852a6) — READY (staging) dentro do staging; T01–T09 concluídas; pausada antes de F07 (D50 c) |
| F07 | Validação técnica do piloto, replicabilidade deka/demo2 e abertura de BLOCKER-PROD | done(verify=2026-09-13 d7543c14) — READY (staging) com os campos de §8.4; T01–T09 concluídas; BLOCKER-PROD aberto; F08+ aguarda o proprietário (D50 c) |
| F08 | Serviços reais e produção inicial: WAHA/IA, e-mail, domínio, orçamento, backup/retorno e onboarding configurável | done(verify=2026-09-14 dc39424a) — READY (staging) no f08-gate-03 (inventário de F12, ADR-033) + produção inicial DE PÉ em `https://crm.kntecnologia.app` medida pela linha `prod:` (ADR-032 §4); T00–T10 concluídas; WhatsApp `health_only` (D12-4); BLOCKER-PROD segue aberto (D13) |
| F09 | Piloto Deka acompanhado, com baseline/metas, pedidos, separação, tempo e qualidade/custo da IA medidos | pending |
| F10 | Segunda empresa real operando por configuração, com preço aceito; gate da expansão comercial | pending |
| F11 | Administração da plataforma, empresas/equipes, suporte limitado e auditado, cadastro e entrada guiada | done(verify=2026-09-13 1e13071d) — READY (staging) no f12-gate-05 (inventário de F12 contém o de F11, ADR-031); T00–T06 concluídas; `admin:` medido |
| F12 | Planos/assinatura/cobrança, confirmação de pagamento, acesso, limites/uso, inadimplência e conciliação | done(verify=2026-09-13 1e13071d) — READY (staging) com gateway MOCK e planos placeholder (D14); T01–T08 concluídas; `billing:` medido; cobrança REAL é NOT VALIDATED (real) |
| F13 | CRM comercial: funis/oportunidades, campos, papéis/filas, histórico, tarefas, pedidos e relatórios | done(verify=2026-09-14 767d22a6) — READY (staging) no f13-gate-05 (13 specs, linha `crm:`, `roles=4`; ADR-034/035); T00–T06 concluídas; produção com o código da F13 (linha `prod:`); §B17 consertado |
| F14 | WhatsApp, chat do site e agenda de clientes/equipe sincronizada com Google Agenda | pending |
| F15 | Automações e autonomia de IA por empresa/ação, aprovação/handoff, limites, auditoria e conhecimento | pending |
| F16 | Marca do SaaS e presets configuráveis; profundidade de templates, white-label e domínios por cliente a definir | pending |
| F17 | Operação, capacidade/recuperação, suporte, atualização, regressão e aceite comercial pelo proprietário | pending |

Dependência técnica: F00/F01 → F02 → F03 → F04 → F05 → F06 → F07 → (D51) F11+F12. F11/F12 fecharam juntas o onboarding pago em staging (13/09/2026); F13 fechou em 14/09/2026; F14–F16 avançam com contratos definidos. F08 depende das entradas/autorização para serviços reais. D48 permite concluir a construção F11–F17 antes das evidências reais F09/F10; piloto e validação de mercado permanecem marcos separados, sem bloquear o software. F17 reúne a jornada comercial e os critérios de operação. Nenhuma fase futura recebe `done` por existir código equivalente no upstream.

## Módulos — orientação vigente e estado da integração

As classes abaixo expressam o destino aprovado, não uma nova medição de prontidão. Evidências estáticas da release e mapa detalhado estão em [target-state](docs/migration/target-state.md); os números da [auditoria F00](docs/migration/deskcomm-audit.md) continuam históricos. As classificações antigas de refazer motor/handoff e remover dados de pedidos não são instruções vigentes.

| Módulo | Classe vigente | Referência/decisão | Estado e trabalho restante |
|---|---|---|---|
| Auth, papéis e isolamento | ADAPTAR | `lib/auth/`, `src/rbac/`, `src/tenant-context/`; ADR-003/006 | Gate F02 aprovado: isolamento/RLS/RBAC, suporte somente leitura e identificação correlacionada de requisições F02. Ampliação comercial de suporte continua na F11/F12 |
| TenantContext, TenantConfiguration e Entitlement mínimo | ADAPTAR | `src/tenant-context/`, `src/tenant-config/`, `src/entitlement/`; fundação F01 | Fundação integrada e gate F02 aprovado, sem dívida nominal restante no gate. Configuração comercial canônica concluída; F03/F04 ligam canais, agentes e uso; F11/F12 ampliam capacidades comerciais |
| WhatsApp/ChannelAdapter | ADAPTAR | `lib/channels/`, `lib/waha/`; target-state §5.7 | Deka usará WAHA agora. Adaptar entrada/saída, resolução de tenant, mocks e fixtures na F03; API oficial não é requisito desta etapa |
| Inbox/conversas | ADAPTAR | `lib/inbox/comando-da-conversa.ts`, `lib/atendimento/fronteira.ts`; ADR-006/008 | Preservar conversas, demandas, revisões, ServiceBoundary e silêncio. Conciliar transições sem segunda máquina concorrente na F03 |
| Motor de IA e RAG | ADAPTAR | `lib/agent-engine/`, `lib/ai/embeddings/`; ADR-002/006/008 | Reutilizar motor único e proveniência; completar contexto/ferramentas de pedido, provedor/mock, conhecimento e contabilização de uso na F04 |
| CRM comercial (F13) | CRIAR sobre o herdado | `src/crm/{campos,oportunidades,relatorio}`, `src/rbac/matrix.ts` (manager), migration 9026, telas `/app/settings/tenant/crm-fields`, `/app/crm/fila`, `/app/reports/crm`; ADR-034/035 | F13 concluída (14/09): campos por organização, fila por rodízio, vínculo com pedido, relatório conferido com a origem; oportunidade continua sendo `crm_leads` (D22), pedido continua ADR-012 |
| CRM existente | ADAPTAR | `contacts`, `catalog_products`, `crm_tasks` e contrato herdado de `orders`; ADR-008/desenho F02 | F02 concluída: IDs e contrato externo preservados; empresas, catálogo, pedidos/itens, notas/tarefas e histórico integrados e validados. Inventário e provas em T04/T09/T13 |
| Lista do dia, impressão e conferência | CRIAR | [Desenho F02](docs/design/F02-pedidos-do-dia.md), DIRETRIZ §7.3 | F02-T10…T13 concluídas: uma fonte para lista/totais/impressão completa, revisão e conferência rastreável. Data/critério explícitos; regras Deka são configuração futura, sem bloquear engenharia |
| Action Policy | ADAPTAR | Política/preview e executores do motor; target-state §5.8 | Completar catálogo, aprovação e auditoria no mesmo caminho de execução. Aprovação de texto não confirma pedido |
| Handoff | ADAPTAR | `lib/agent-engine/agent/human-handoff.ts`; ADR-006/008 | Completar resumo, motivos, claim e provas D19 preservando guardas, silêncio e episódio existentes; F05 |
| Lembrete PJ | CRIAR | target-state §5.12; desenho F02 | Regra específica sobre filas/envio existentes; timeout sem resposta é distinto do corte de produção. Construção genérica na F05; datas/janelas/exceções da Deka serão configuradas após acesso (D48) |
| Workers/filas e observabilidade | ADAPTAR | `event_log`, `job_queue`, `workers/`, `lib/audit/`; target-state §5.13/5.17 | Preservar infraestrutura e provar tenant, repetição segura, trabalhos antigos e rastreabilidade nas F03–F06 |
| Notificações do contrato CRM-OS | CRIAR | target-state §5.16; canais/avisos herdados reaproveitáveis | Completar avisos por usuário e e-mail transacional com mocks na F05; entregas reais continuam pendentes |
| Banco/RLS/migrations | ADAPTAR | `supabase/baseline.sql`, [MANIFEST](supabase/migrations/MANIFEST.md), ADR-010 | 225 arquivos SQL em migrations no checkpoint 03ec6a3b; instalação/upgrade pelo baseline e reaplicação provados em banco descartável. Gate F02: banco1585/1585, RLS127 tabelas, nenhuma dívida nominal; serviços reais pendentes |
| Administração, onboarding e cobrança comerciais | ADAPTAR (+ `src/billing` CRIAR) | D38/D39/D44; ADR-009; ADR-030/031; DIRETRIZ §7.9 | F11/F12: painel do dono com estado da assinatura e `/admin/billing`; suporte com motivo/escopo/vencimento só leitura (9024); cadastro nasce `pending_payment`, `/app` e `/onboarding` gateados pela assinatura, `requireRole` nega escrita com 402; wizard conclui pelo canal de teste em mock; planos placeholder, gateway mock, carência 7 (declarados); jornada paga REAL continua `NOT VALIDATED (real)` (gateway, D12) |
| Canais comerciais, agenda, automação e marca | ADAPTAR | D40/D41; ADR-009; DIRETRIZ §7.9 | Recorte confirmado para F14–F16; regras de sincronização, limites e profundidade de white-label ainda serão definidos |
| Produção inicial nesta VPS | CRIAR | `compose.prod.yml`, `scripts/prod/*`, `docs/ops/prod.md`; ADR-032/033; D52 | F08 concluída (14/09): stack `crm-prod` de pé com provedores reais, domínio, dono real, backup diário, linha `prod:`; falta: liberação do BLOCKER-PROD (D13), número de WhatsApp (D12-4), Stripe (D52) |

A [ADR-010](docs/decisions/ADR-010-rotulos-das-migrations-F01.md) resolve as colisões de rótulos F01 com o upstream. O mapa abaixo é de nomes de arquivo: **timestamps e todos os bytes SQL permanecem iguais**, inclusive os comentários antigos. Não se executa repair nem atualização de histórico em uso; o `name` antigo de uma versão aplicada pode permanecer informativo.

| Timestamp/versão preservada | Rótulo histórico F01 | Rótulo atual |
|---|---|---|
| `20260907150000` | `0219_channel_accounts_e_webhook_quarantine` | `9001_channel_accounts_e_webhook_quarantine` |
| `20260907170000` | `0220_rls_fundacao` | `9002_rls_fundacao` |
| `20260907190000` | `0221_tenant_settings` | `9003_tenant_settings` |
| `20260907210000` | `0222_ai_usage_events` | `9004_ai_usage_events` |

## BLOCKERS abertos

| Id | Tipo (D11) | O que precisa | Desde | Branch |
|---|---|---|---|---|
| **BLOCKER-PROD** | `production` (+ `real_message`, `real_data`) | Aprovação escrita do proprietário para LIBERAR a produção e criar o tenant Deka real (D13, D26, D04). Os 7 itens de D12 estão fornecidos e aplicados na F08 (D52), exceto o número de WhatsApp (adiado pelo proprietário): produção inicial DE PÉ em `crm.kntecnologia.app` com cadastro público desligado; **D53 (14/09)**: liberado SÓ para o tenant Deka — organização `deka` criada pelo painel do dono (PLAN_C, admin = proprietário, 0 e-mails a terceiros). Liberar = escrever `BLOCKER-PROD: liberado por <nome> em <data>, sha <hash>` nos registros humanos → `GOTRUE_DISABLE_SIGNUP=false` por ADR → tenant Deka. Não muda `status` para BLOCKED (§8.9, D26) | 2026-09-13 (F07-T07); revisto 2026-09-14 (F08) | `blocker/PROD` |

Tipos: `credential_real`, `commercial`, `cost`, `production`, `real_message`, `restore_prod`, `real_data`, `contradiction_b`, `awaiting_owner`. `BLOCKER-PROD` é o único bloqueio aberto (F07-T07); nenhum bloqueio de engenharia está ativo. Produção continua sem autorização nesta revisão; o proprietário fecha o BLOCKER-PROD por escrito (D13, D26) e os sete itens viram evidência real (F08).

## Registros humanos (só o proprietário escreve; o agente nunca preenche)
| Chave | Valor | Data |
|---|---|---|
| `visual:` | (ex.: 14/14) | |
| `restore_prod:` | (tables=T rows_diff=0) | |
| `deploy_prod:` | (commit) | |
| `channel_account:` | (deka real; aceite recebido em <data>, por <nome>) | |
| `BLOCKER-PROD:` | (liberado por <nome> em <data>, sha <hash> — a liberação GERAL; a parcial para o tenant Deka está em D53) | |
| `owner_validated:` | | |
| `pilot_read:` | (leitura da meta D27) | |
| `verify_sh_frozen:` | (sha do verify.sh revisado — Etapa 9) | |
| `baseline_n0_owner:` | (Etapa 3: `unit=N/N typecheck=… tests_files=… last_commit=…` medido pelo dono) | |

## Decisões pendentes do dono/Deka

| Id | Tema | Situação vigente | Necessário antes de |
|---|---|---|---|
| P-F02-01 | Data que organiza pedidos do dia | Pendente de configuração pela Deka após receber acesso. D48: a consulta exige critério explícito, sem assumir uma regra comercial | Uso operacional pela Deka; não bloqueia a construção |
| P-F02-02…P-F02-08 | Unidades/embalagens, preço PJ, confirmação, corte/janelas, exceções, impressão, áudio e metas | Perguntas e cenários no desenho F02; configuração futura sem inventar conversões, preços, prazo ou liberação parcial | Operação dependente da configuração e avaliação real do piloto; não bloqueia a engenharia genérica |
| D03 | Hosting/staging | **Decidido (D50, 11/09/2026)**: staging nesta VPS por Docker Compose com Supabase local, acesso só por Tailscale (ADR-027). Capacidade da VPS é limite declarado para a F06; produção continua decisão separada (D12/D13) | F08 (produção) |
| Orçamento | Custos mensais e contratação | [Orçamento proposto](docs/product/ORCAMENTO-PROPOSTO.md) aberto para revisão: até R$300/mês adicionais no piloto, condicionado à capacidade da VPS e à ausência de nova assinatura de banco; R$600–1.200/mês na preparação comercial. Nenhum valor aprovado ou gasto autorizado | Contratação e serviços reais |
| Prazo | Início e datas | Desejo de começar o quanto antes; nenhuma data calendário, duração de fase ou prazo final foi fixado | Compromissos de entrega |
| D02/E5 | Credenciais/modelos de IA e dimensão do embedding | `AI_PROVIDER=mock`; ADR-002 provisório, seleção de modelo e orçamento real pendentes | F04 real/F08 |
| D27 | Metas/baseline do piloto Deka | Fixar indicadores, denominadores, janela, critérios de invalidação e decisão do piloto | F09 |
| D28 | Nome/domínio da plataforma | Marca do proprietário confirmada; nome/domínio e profundidade por cliente ainda não escolhidos | Produção/F16 |
| D04 | Número WhatsApp real e aceite de risco | WAHA confirmado para Deka; número/credenciais e aceite necessário à operação real ainda não validados | F08 |
| D14/D32 | Segunda empresa, planos, preços e gateway | Segmentos e preços não escolhidos. F10 exige segunda empresa real e preço aceito; planos/gateway precisam de decisão para F12 | F10/F12 |
| D41 | Google Agenda sincronizada | Integração confirmada; desenhar direção/fonte de autoridade, conflitos, fusos, disponibilidade e reconexão/revogação | F14 |
| D44 | Inadimplência | Aviso e prazo de regularização antes de bloquear novas operações; preservar dados e acesso à cobrança. Dias, notificações, reativação e retenção ainda indefinidos | Cobrança real/F12 |
| D25 | Revisão do verificador pelo dono | ADR-005/007 registram o desenho técnico; não preencher o registro humano como se a revisão tivesse ocorrido | Aceite formal da régua |
| E3 | Baseline medido pelo dono | N0 histórico medido pelo agente permanece; registro humano não foi preenchido nesta revisão | Comparação/aceite do N0 |
| D13/D26 | Produção e tenant Deka real | Integração/desenho não autorizam deploy nem uso de dados reais | Aceite expresso de produção/F08 |
| Deka seed | Cadastro e dados reais | Placeholders do seed continuam dependentes da entrevista/validação; nenhum dado real é adicionado nesta revisão | Carga autorizada e piloto |
| D40/F16 | Versatilidade e white-label | Primeiro CRM completo; nichos e profundidade de templates/domínios/marca por cliente ainda não escolhidos. ERP/adjacentes ficam para evolução futura | F13/F16 |

## NOT VALIDATED (real)

A integração e as provas com mocks/bancos descartáveis não comprovam as jornadas abaixo. A coluna de validação permanece vazia até evidência autorizada; nenhum registro humano é preenchido pelo agente.

| Integração/jornada | Validação necessária | Validado em |
|---|---|---|
| WAHA com número real autorizado | Conectar, receber/enviar, reconectar e conferir mensagem/tenant e ausência de duplicação | |
| IA real: chat e embedding | Casos aprovados contra o provedor, uso/custo conferidos e limites/autonomia respeitados | |
| E-mail transacional | Entrega real de autenticação/cobrança e rastreio do provedor | |
| Piloto Deka com dados reais | Operação autorizada, recorte de pedidos confirmado e indicadores com denominadores | |
| Segunda empresa e preço aceito | Operação por configuração, sem código específico, e evidência comercial | |
| Assinatura/pagamento/inadimplência | Confirmação confiável, conciliação, ativação, repetição/ordem de eventos, aviso/carência/bloqueio e cancelamento (F12: provado com gateway MOCK — `billing: duplicates=1 out_of_order=1 activations=1/1`; gateway real e cobrança real são humanos) | |
| Onboarding e suporte comerciais | Cadastro → contratação → acesso → conexão/configuração, com suporte limitado/auditado (F11: provado em staging com WhatsApp/IA mock — `admin:`; número/IA reais são humanos) | |
| Chat do site | Mensagens reais, identidade, isolamento e continuidade do atendimento | |
| Agenda/Google Agenda | Criar/alterar/cancelar, disponibilidade/fuso, conflitos, reconexão e revogação reais | |
| Produção | Aceite, deploy e smoke da versão com domínio, monitoração e operador definidos | |
| Recuperação/capacidade | Backup/restauração em destino autorizado, retorno e carga medidos contra critérios acordados (F06: restore em banco vazio de staging tables=179 rows_diff=0; produção continua humana) | |
| Teste visual/celular | Checklist da fase nos dispositivos previstos e registro do proprietário | |

## Histórico original F00/F01 — encerramentos de 07/09/2026

Este quadro preserva os resultados então registrados, incluindo `READY (F01)` e a antiga contagem textual de skips. Não aplica retroativamente a terminologia da ADR-007 nem afirma que esses números validam a v1.17.0 combinada. O N0 integral do cabeçalho também é histórico; a nova comparação deve usar somente suítes efetivamente executadas conforme ADR-007, sem somar E2E antigo ao resultado novo.

| Fase | Data | Commit de referência registrado | VERIFY SUMMARY histórico resumido |
|---|---|---|---|
| F00 | 2026-09-07 | 2a23537e | build/lint/typecheck ok; unit=7502/7503 db=1236/1238 N0=8997 (e2e do N0: 259/290, 11 falhas de ambiente); STATUS READY (F00) |
| F01 | 2026-09-07 | 6f7c56fc | T01–T11 completas; unit=7536/7537 integration=6/6 db=1264/1266; isolation tables=110 leaks=0; rbac 17/17; secrets 337/0; mutants 1/1; STATUS READY (F01) |

O cabeçalho original referenciava F01-T11 em `6f7c56fc`; o fechamento F01 usado como origem da integração é `960a46907449fcd4a7e773e40016742c25c0a09d`. Resumo literal original preservado:

```text
VERIFY SUMMARY
build=ok lint=ok typecheck=ok
unit=7536/7537 integration=6/6 db=1264/1266 e2e=pending baseline_n0=8997
isolation: tables=110 ops=4 dirs=2 leaks=0 (material_cross_org=86/110)
rls-coverage: tables_with_org_id=110 policies_found=106 missing=0 service_only_with_grant=0
rbac: roles=3 denied_expected=17 denied_actual=17
entitlement: usage_events_written=2
ai_eval: cases=pending pass=pending unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=pending
handoff: ai_msgs_after_handoff=pending summary=pending assignee=pending notify=pending
reminder: runs=pending sent=pending duplicates=pending
webhook: replay=pending stored=pending tables_checked=pending
replicability: e2e[deka]=pending e2e[demo2]=pending src_diff_lines=pending grep_deka_in_src=0
secrets: files_scanned=337 findings=0
tests_deleted=0 tests_skipped=15 mutants_killed=1/1
STATUS: READY (F01)
```

## Regra de atualização

Migrations distinguem `escrita`, `aplicada` e `verificada` (G-24), sempre indicando o ambiente: uma aplicação descartável não significa aplicação em banco de cliente. Ao fechar task/fase ou revalidação, registrar commit, comandos, contagens/denominadores, limites e evidência observada; o fechamento atual seguirá ADR-007. Alterar `verify_summary_last` somente com resultado real, preservando o histórico anterior separadamente. Registros humanos continuam exclusivos do proprietário. Esta revisão atualiza planejamento e estado documental, sem concluir fase, aprovar custo ou produzir validação real.


## Resumo preservado da revalidação de 08/09/2026

Histórico anterior à F02, preservado do cabeçalho.

```text
VERIFY SUMMARY
scope=revalidation phase=F01 current_phase=F02
build=ok lint=ok typecheck=ok shell=ok
unit=7965/7966 integration=6/6 db=1499/1501 e2e=pending baseline_n0=8997
baseline_comparable: scope=unit+db passed=9464 required=8738 full_n0=pending
isolation: tables=117 ops=4 dirs=2 leaks=0 (material_cross_org=90/117)
rls-coverage: tables_with_org_id=117 policies_found=109 missing=0 service_only_with_grant=0
rbac: roles=3 denied_expected=17 denied_actual=17
entitlement: usage_events_written=2
ai_eval: cases=pending pass=pending unknown=pending injection=pending cross_tenant=pending provider_calls_at_zero_balance=pending
handoff: ai_msgs_after_handoff=pending summary=pending assignee=pending notify=pending
reminder: runs=pending sent=pending duplicates=pending
webhook: replay=pending stored=pending tables_checked=pending
replicability: e2e[deka]=pending e2e[demo2]=pending src_diff_lines=pending grep_deka_in_src=0
secrets: files_scanned=361 findings=0
tests_deleted=0 tests_skipped=1 expected_failures=2 tests_failed=0 tests_pending=0 mutants_killed=2/2
debt_known=3 skip_only_occurrences=16 violations=0
debt: unit expected_failure tests/unit/agenda-separar-historico.test.tsx :: o compromisso EM ANDAMENTO ainda é Próximos — começou, mas não terminou
debt: db expected_failure tests/invariants/followup-reactivity.test.ts :: STOP alcança também o enrollment PAUSADO MANUALMENTE — opt-out não abre exceção de estado
debt: db skipped tests/invariants/webhooks-inbound.test.ts :: rate limit 429 após estourar a janela — coberto por unit test do fallback in-memory
STATUS: REVALIDATED WITH DEBT (F01)
```
