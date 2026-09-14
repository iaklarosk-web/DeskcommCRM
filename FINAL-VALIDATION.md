# FINAL-VALIDATION — Fase 1 (F00–F07) do CRM SaaS multi-tenant sobre o DeskcommCRM, em staging

Relatório final único (D08, §8.7). Oito seções, nesta ordem. Tudo aqui foi
medido com `WHATSAPP_MODE=mock` e `AI_PROVIDER=mock`, sobre empresas fictícias,
no staging desta VPS (D50, ADR-027/028). O agente não escreve "projeto
concluído": escreve o bloco, as oito seções e a lista do que NÃO foi verificado;
o proprietário decide o resto (D26). Histórico por fase: [BUILD-STATE.md](BUILD-STATE.md).

- Código validado: `d7543c1463242b0fdc0b9fd5f8b0722ed9cb4532` (branch `feat/F03-conversation-inbox`); o mesmo bloco saiu antes sobre `7632a058` (gate 06) — a diferença é a ADR-029 §5.
- Gate: `f07-gate-07`, `2026-09-13 09:27Z → 11:10Z (06:27 → 08:10 de Brasília)`, `6196` s, exit 0, dentro do staging (`environment=staging`); inputs 3529/3529 com SHA-256 igual.
- Ambiente: `compose.staging.yml`, projeto `crm-staging`, 15 serviços, Supabase local (56421/56422), app do gate em 3202, acesso só por loopback e Tailscale.

## 1. O que foi reutilizado, adaptado, refeito e criado do Deskcomm

Classe vigente por módulo (D29), com a referência ao código. A matriz
histórica da F00 (`docs/migration/deskcomm-audit.md` §2, @ `c85f7d72`) contava
`reutilizar=6 adaptar=13 refazer=2 criar=3 remover=1` (25 linhas). A matriz
atualizada — revisões registradas em ADR-008 (Action Policy CRIAR→ADAPTAR),
ADR-021 (AI Agent REFAZER→ADAPTAR), ADR-025 (Handoff REFAZER→ADAPTAR), ADR-012
(contrato de `orders` preservado: Nuvemshop deixa de ser REMOVER) e a linha
"Lista do dia" criada na F02 — contava **`reutilizar=7 adaptar=16 refazer=0 criar=3 remover=0`**
(26 linhas) ao fechar a F07. A F11/F12 (ADR-030) mudou o wizard de REUTILIZAR para
ADAPTAR e acrescentou duas linhas (administração/suporte ADAPTAR; planos e
cobrança CRIAR): **`reutilizar=6 adaptar=18 refazer=0 criar=4 remover=0`** (28 linhas),
a mesma da tabela "Módulos" do BUILD-STATE mais os módulos herdados sem
correspondente na Fase 1.

| Módulo (§5) | Classe vigente | Código | Fase |
|---|---|---|---|
| 5.1 TenantContext | ADAPTAR | `src/tenant-context/` (`fromSession`, `fromJob`, `fromWebhook`, `withTenant`) sobre `lib/supabase/admin.ts` | F01 |
| 5.2 TenantConfiguration | ADAPTAR | `src/tenant-config/` (`schema.ts`, `validate-seed.ts`, `canonical-seed.ts`) sobre `organizations.settings` + `tenant_settings` | F01/F02 |
| 5.3 Entitlement | ADAPTAR | `src/entitlement/` sobre `lib/ai/budget/`, `llm_calls` → `ai_usage_events` (ADR-023) | F01/F04 |
| 5.4 Identity & RBAC | ADAPTAR | `src/rbac/matrix.ts` sobre `lib/auth/require-role.ts` (ADR-003) | F01 |
| 5.5 CRM Core | ADAPTAR (+ pedidos criados) | `contacts`/`catalog_products`/`crm_tasks` preservados; `src/crm/` com `crm_companies`, `crm_orders`, `crm_order_items` (ADR-012/013) | F02 |
| Lista do dia, impressão e conferência | CRIAR | `src/crm/daily/`, `app/app/orders/daily/` (desenho F02) | F02 |
| 5.6 Conversation | ADAPTAR | `src/conversation/` (D16 sobre `lib/inbox/comando-da-conversa.ts`, ADR-016) | F03 |
| 5.7 Channel Adapter | ADAPTAR | `src/channels/` sobre `lib/channels/` + `lib/waha/ingest.ts`; adapter mock (ADR-017) | F03 |
| 5.8 Action Policy | ADAPTAR | `src/actions/` (catálogo D17, nove tools D18) sobre `applyPreviewPolicy` do motor | F04 |
| 5.9 AI Agent | ADAPTAR | `src/ai/` sobre `lib/agent-engine/` (ADR-021) | F04 |
| 5.10 Knowledge/RAG | ADAPTAR | `src/knowledge/` sobre `ai_knowledge_sources`/`ai_chunks` (ADR-023) | F04 |
| 5.11 Handoff | ADAPTAR | `src/handoff/` (dossiê D19, fila de claim) sobre `human-handoff.ts` (ADR-025) | F05 |
| 5.12 Recurring Reminder | CRIAR | `src/reminder/` (`reminder_runs`, cron por tenant, envio pelo catálogo — ADR-026) | F05 |
| 5.13 Workers & Jobs | ADAPTAR | `src/jobs/` sobre `job_queue`/`event_log`; `job_runs`; workers de saída e lembrete | F03/F05 |
| 5.14 API | REUTILIZAR | `lib/api/wrappers.ts`, `lib/api/errors.ts`, `proxy.ts` (`X-Request-Id`, ADR-015) | — |
| 5.15 Banco/RLS/migrations | ADAPTAR | `supabase/baseline.sql` + migrations 9001–90xx em par com apêndice idempotente + `MANIFEST.md` (ADR-010) | F01–F06 |
| 5.16 Notificações | CRIAR | `src/notifications/` (`notifications`, `email_outbox`; e-mail mock — ADR-026) | F05 |
| 5.17 Observabilidade | ADAPTAR | `src/obs/` (`log.ts`, `erros.ts`, `counters.ts`) sobre `lib/logger.ts` e Sentry herdado | F06 |
| 5.18 Segurança/LGPD | ADAPTAR | `src/lgpd/` (duas ações `high` só humanas) sobre a cascata herdada; rate limit no webhook SaaS; scanner de segredos e inventário do `.env.example` no CI | F06 |
| MCP server | REUTILIZAR sem tocar | `app/api/mcp/route.ts`, `lib/mcp/` | — |
| Instalador/self-host | REUTILIZAR | `docker-compose.prod.yml`, `entrypoint.sh`, `hostgator-setup-kit/`; staging por `compose.staging.yml` (ADR-028) | F06 |
| White-label | ADAPTAR | `lib/branding/resolve.ts`; `settings.branding` do seed (D28 mínimo) | F02 |
| Nuvemshop / `orders` externo | REUTILIZAR sem tocar (REMOVER revogado) | contrato de `orders` preservado; pedidos operacionais em `crm_orders` (ADR-012, D46) | F02 |
| LGPD herdada | REUTILIZAR | `export-collector.ts`, `redact-cascade.ts`, 7 rotas, 2 workers — usada pela F06-T03 | F06 |
| Flywheel | REUTILIZAR sem tocar | `flywheel/live.ts`, `FLYWHEEL_INTERVAL_MS=0` (OFF) | — |
| Onboarding wizard | ADAPTAR (era REUTILIZAR sem tocar) | 9 páginas; o loader grava `onboarded_at` (ADR-029 §3); F11-T05: passo do telefone conclui pelo canal de TESTE em `WHATSAPP_MODE=mock` (`conectarCanalMock`), e o wizard só abre com assinatura que permite uso (ADR-030 §1) | F07/F11 |
| Administração da plataforma e suporte | ADAPTAR | `/admin` herdado + coluna de assinatura, `/admin/billing`; acompanhamento com motivo/escopo/vencimento só leitura (`fn_start_support_saas`, 9024; `rotaNoEscopo` no guarda) — ADR-030 §4 | F11 |
| 5.3 Entitlement (planos) e cobrança | CRIAR | `src/billing/` (`plans`, `subscriptions`, `billing_events`, `invoices` — 9023; gateway mock, acesso, carência, conciliação) e `src/entitlement/plano.ts` (resolver por plano, D14) — ADR-030 §3 | F12 |

## 2. VERIFY SUMMARY final

Bloco colado na íntegra, rodado DENTRO do staging (ADR-028 §2: navegador
contra o Supabase do staging, unit/db/integration no Postgres efêmero), sobre
`1e13071d32f92d3d6daf507ff2adf3e901e53a74`, em `2026-09-13 23:17Z → 2026-09-14 01:01Z (20:17 → 22:01 de Brasília)`, exit `0`, `6261` s, com
`current_phase: F12` (o inventário de F12 contém o de F11 — ADR-031 §1; o
mesmo gate fecha as duas). Log em `.verify-logs/f12-gate-05/` (não
versionado); evidência versionada em
[docs/migration/evidence/construction-f11-f12-20260913.txt](docs/migration/evidence/construction-f11-f12-20260913.txt).
O bloco da F07 (`d7543c14`, f07-gate-07) fica na evidência
[construction-f07-20260913.txt](docs/migration/evidence/construction-f07-20260913.txt).

```text
VERIFY SUMMARY
scope=phase phase=F12 current_phase=F12 environment=staging
build=ok lint=ok typecheck=ok shell=ok
unit=8500/8500 integration=175/175 db=1660/1660 e2e=51/51 baseline_n0=8997
baseline_comparable: scope=unit+db passed=10160 required=8738 full_n0=pending
e2e_scope: F12-required passed=51/51 specs=12/12
isolation: tables=138 ops=4 dirs=2 leaks=0 (material_cross_org=97/138)
rls-coverage: tables_with_org_id=138 policies_found=116 missing=0 service_only_with_grant=0
rbac: roles=3 denied_expected=19 denied_actual=19
entitlement: usage_events_written=23
ai_eval: cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0
handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7 assignee=3 notify=3 notify_rows=6 msgs_after=3 provider_calls_after=0
reminder: runs=2 sent=1 duplicates=0 tables_summed=3
webhook: replay=2 stored=1 tables_checked=7
logs: routes=278 routes_logged=278 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=4/7
rate-limit: requests=101 status_429=1 auth_requests=101 auth_blocked=1 routes=278 routes_with_schema=278 routes_reading_input=148 validated=148
lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=2
admin: tenants_listed=3/3 support_sessions=2 support_reason=2/2 support_scope_denied=25/32 support_writes_denied=5/5 full_mode_rejected=1/1 signup_awaiting_payment=1/1 orgs_without_subscription=0/3
billing: plans=3 events=6 duplicates=1 out_of_order=1 activations=1/1 blocked_writes_denied=5/5 grace_days=7 reconciliation_mismatch=0/3 cancellations=1/1 data_preserved=7/7
replicability: e2e[deka]=ok e2e[demo2]=ok src_diff_lines=0 grep_deka_in_src=0 (deka=51/51 demo2=51/51 specs=12/12 org_a=seed-replica)
secrets: files_scanned=504 findings=0
tests_deleted=0 tests_skipped=0 expected_failures=0 tests_failed=0 tests_pending=0 mutants_killed=61/61
debt_known=0 skip_only_occurrences=15 violations=0
STATUS: READY (staging)
```

Fora do bloco, como §7.7/§8.1 mandam (provas de operação contra o container do staging, já com a imagem da F12):

```text
restore: tables=183 tables_restored=183 rows=7889 rows_diff=0 dump=staging-20260914T012353Z.dump target=restore_20260914_012354 seconds=13 at=20260914T012354Z
smoke: steps=7 pass=7/7 customers[deka]=0/0 customers[demo2]=3/3 inbox_new=1 logins=2/2 products[deka]=0/0 products[demo2]=4/4 webhook_accepted=1/1 reminder_listed=1/1 owner_login=1/1 subscriptions[deka]=active/full subscriptions[demo2]=active/full orgs_without_subscription=0/2 tenants=deka,demo2
p95_ms: endpoints=3/3 health=28 contacts=390 conversations=398 samples=20 url=http://127.0.0.1:3200
staging: compose=crm-staging services_running=15/15 memory_mib=1449 ports=127.0.0.1+tailscale(3200,56421,56422,56424) public_ports=0 host=4c/16GB swap=off image=F12(1e13071d) up_sh_rerun=idempotent(rows_created=0 subscription=existing)
```

O `demo3:` e o `from-scratch:` desta fase NÃO foram executados (ver §3); os da
F07 estão na evidência da F07.

Link do run de CI: o workflow `.github/workflows/verify.yml` (F06-T08) roda o
`verify.sh` em todo PR; o PR em rascunho é
[iaklarosk-web/DeskcommCRM#3](https://github.com/iaklarosk-web/DeskcommCRM/pull/3).
O run do GitHub e o link do run são do proprietário (§7.7 T08) — o agente não
o executou nem o leu nesta sessão: **link do run: pendente do proprietário**.

## 3. O que NÃO foi verificado

Cada item com a marcação e o dono humano (§8.6, D11, D12, D26).

| Item | Marcação | Dono humano |
|---|---|---|
| Provedor real de IA (chat e embedding): casos contra o provedor, custo real, limites | NOT VALIDATED (real) — `AI_PROVIDER=mock`, embedding determinístico (ADR-002) | proprietário (chave OpenAI com orçamento, D12) |
| WAHA real: conectar número, receber/enviar, reconectar, ausência de duplicação | NOT VALIDATED (real) — adapter mock; `waha-mock` só responde ao health | proprietário + Deka (número, aceite de risco de ban, D04) |
| E-mail transacional real (autenticação, notificações) | NOT VALIDATED (real) — mailpit | proprietário (provedor de e-mail, D12) |
| Produção: domínio, Supabase de produção, deploy, smoke contra a URL de produção | NOT VALIDATED (real) — só staging (D13) | proprietário (BLOCKER-PROD, §8.6) |
| Dados reais de clientes; tenant Deka real; seed do deka preenchido (59 `TODO-DEKA`) | NOT VALIDATED (real) — fictícios; deka com placeholders (D48) | proprietário + Deka (Etapa 7) |
| Restore em produção | NOT VALIDATED (real) — restore só em banco VAZIO de staging (`tables=179 rows_diff=0`, D36) | proprietário (`docs/ops/restore-prod.log`) |
| Teste visual e no celular (7 telas × 2 dispositivos) | NOT VALIDATED — não há navegador humano nesta sessão; acesso via Tailscale não exercido | proprietário + 1 atendente (`visual: 14/14`) |
| Sentry real | NOT VALIDATED (real) — `SENTRY_DSN=off`; o padrão herdado sem DSN aponta para o Sentry da comunidade (VARREDURA §B11) | proprietário |
| Run do `verify.yml` no GitHub | NOT VALIDATED — o workflow existe e foi lido; o run e o link são do proprietário | proprietário |
| Meta do piloto D27 (baseline, metas, duração, critério de invalidação) | não preenchida — `docs/ai-eval/pilot-queries.sql` mede três das seis quando houver dados reais | proprietário + Deka |
| Firewall dos OUTROS stacks desta VPS (VARREDURA §B12) e persistência do swap (§B14) | descritos no runbook, não aplicados (portas 1-way) | proprietário |
| Busca semântica sobre o FAQ do seed (7 pares num trecho só) | não medida — a ingestão foi contada, a busca não | F08+ com provedor real |
| Cobrança REAL: gateway de pagamento, preço, nome dos planos, dias de carência, pró-rata, moeda | NOT VALIDATED (real) — gateway `mock` (`BILLING_GATEWAY=mock`), planos placeholder PLAN_A/B/C com preço 0 e limites declarados (ADR-030 §3, D14); `BILLING_GRACE_DAYS=7` é padrão, não decisão | proprietário (D14; gateway e contrato do provedor) |
| Cadastro público REAL (e-mail de confirmação, WhatsApp real no wizard, IA real na entrada guiada) | NOT VALIDATED (real) — cadastro cria assinatura `pending_payment` e o wizard conecta um canal MOCK (`conectarCanalMock`); nenhuma mensagem a pessoa real | proprietário + Deka (número, aceite) |
| Painel do dono e suporte com pessoa real: sessão de suporte usada por atendente humano, expiração observada no relógio | NOT VALIDATED — provado por integração e navegador com pessoas fictícias (`support_sessions=2`, `support_scope_denied=25/32`, TTL 1–60 min) | proprietário (teste visual, Tailscale) |
| Tenant efêmero (`demo3`) e `from-scratch` nesta fase | não executados nesta sessão — foram executados na F07 (`d7543c14`) e o `from-scratch` prova o que está COMMITADO; a F12 acrescentou 3 migrations à baseline (9023/9024 com apêndices), provadas pelo `test:db` (1660/1660) e pelo `up.sh` idempotente do staging | agente na próxima fase (F08) |
| Specs herdadas de suporte em MODO DE EDIÇÃO (`suporte-temporario.spec.ts`, `agenda-presenca-recuperacao.spec.ts`) | fora do inventário; descrevem um modo que a rota SaaS não oferece (VARREDURA §B16) | proprietário |

## 4. ADRs

29 arquivos em `docs/decisions/` (`ls docs/decisions | wc -l` = 29), uma linha por decisão:

| ADR | Decisão |
|---|---|
| ADR-001 | O que foi mantido, mesclado e removido do AGENTS.md e do docs/current-state.md do Deskcomm |
| ADR-002 | Dimensão do embedding (pgvector, 1536) e modelo de embedding; determinístico na Fase 1 |
| ADR-003 | Mapa dos papéis do Deskcomm para `platform_admin` / `tenant_admin` / `attendant` (D15) |
| ADR-004 | `.env.example` = template herdado do operador + bloco gerado por grep |
| ADR-005 | verify.sh v1: campos da F01, métricas gravadas pelas suítes, mutante de RLS |
| ADR-006 | Integrar DeskcommCRM v1.17.0 preservando a fundação |
| ADR-007 | Verificação com resultados estruturados e revalidação explícita |
| ADR-008 | F02 operacional e reaproveitamento da v1.17.0 |
| ADR-009 | Entrega final comercial e entrevista do proprietário |
| ADR-010 | Separar os rótulos F01 da numeração upstream |
| ADR-011 | Construção autorizada por fases e medição de consumo |
| ADR-012 | Identidade dos cadastros e domínio dos pedidos operacionais |
| ADR-013 | Notas humanas e tarefas vinculadas a pedidos |
| ADR-014 | F02 configurável e extensão dos gates |
| ADR-015 | Identificador da requisição na F02 |
| ADR-016 | Estados D16 sobre o ciclo de atendimento herdado |
| ADR-017 | Contrato de canal, webhook do SaaS e fila de saída |
| ADR-018 | verify.sh v1.1: campo `webhook`, gate de F03 e specs de inbox |
| ADR-019 | Conversa arquivada: a fronteira herdada reabre; D34 pede conversa nova |
| ADR-020 | Execução contínua até F17, sem a pausa por fase de D47 |
| ADR-021 | Agente SaaS sobre a camada de provedor herdada, com um só registro de consumo |
| ADR-022 | verify.sh v1.2: campo `ai_eval` e gate de F04 |
| ADR-023 | Acervo por organização sobre as tabelas herdadas, e um preço só |
| ADR-024 | verify.sh v1.3: campos `handoff` e `reminder`, gate de F05 |
| ADR-025 | O handoff ganha dossiê e fila sem ganhar um segundo estado |
| ADR-026 | Notificações por usuário e lembrete recorrente sobre o catálogo, sem abrir o domínio a automação |
| ADR-027 | Hosting do staging: esta VPS, Docker Compose com Supabase local, acesso por Tailscale (D50) |
| ADR-028 | verify.sh v1.4 (`logs`, `rate-limit`, `lgpd`; ambiente `staging`) e o desenho do staging nesta VPS |
| ADR-029 | verify.sh v1.5 (F07 no gate; `replicability` por tenant do seed), loader do seed completo (§B13) e tenant efêmero |
| ADR-030 | F11+F12: tasks com critério numérico, modelo de assinatura (estados, acesso, gate de escrita), suporte com motivo/escopo/vencimento só leitura, defaults declarados (planos placeholder, gateway mock, carência 7) |
| ADR-031 | verify.sh v1.6: F11/F12 no gate, campos `admin` e `billing`, duas specs no inventário, mutantes 60–64 |

## 5. Pendências para produção

Os sete itens de D12, com o estado e o dono — **7/7 com dono**; nenhum fechado
pelo agente. Referenciados no `BLOCKER-PROD` do BUILD-STATE (branch `blocker/PROD`).

| # | Item (D12) | Estado | Dono |
|---|---|---|---|
| 1 | Domínio da plataforma (e `PLATFORM_NAME`, D28) | não escolhido | proprietário |
| 2 | Supabase de produção (projeto/servidor, senhas, backup) | não existe; staging usa Supabase local desta VPS | proprietário |
| 3 | Chave OpenAI com orçamento (`AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`) | não fornecida; `AI_PROVIDER=mock` | proprietário |
| 4 | Número de WhatsApp + aceite escrito do risco de ban da Deka (WAHA, D04) | não fornecido; adapter mock | proprietário + Deka |
| 5 | E-mail transacional (provedor e remetente) | não configurado; mailpit | proprietário |
| 6 | Sentry (DSN próprio — não o da comunidade, §B11) | `SENTRY_DSN=off` no staging | proprietário |
| 7 | Usuário `platform_admin` de produção | não criado | proprietário |

Também antes de produção, fora de D12: aprovação escrita de produção (D13),
regra de firewall dos outros stacks (§B12), swap persistente (§B14), decisão
sobre §B15 (rerun do `up.sh` em staging tocado pelo smoke), §B5/§C6
(`create_task` pela IA), §C5 (conversa nova a partir de `archived`).

## 6. Como criar um tenant novo

Executado na F07-T03 com o tenant efêmero `demo3` (linha em §2:
``demo3: created=1 smoke=pass=6/6 e2e[demo3]=41/41 specs=10/10 removed=1 tenants=2`; o smoke só nele: `customers[demo3]=1/1 products[demo3]=2/2 logins=1/1 webhook_accepted=1/1 inbox_new=1 reminder_listed=1/1`; o loader gravou `rows_created=24` — 2 produtos, 1 cliente com empresa, FAQ de 5 pares como 1 material`). Passos exatos, na ordem — o que
`scripts/verify/tenant-efemero.sh <slug>` faz:

1. **YAML**: `docs/tenants/<slug>.seed.yaml` com o schema de §5.21 (`tenant`,
   `users` com ≥1 `tenant_admin`, `channel_accounts` com `mock` em dev/staging,
   `products`, `customers`, `settings` nos oito grupos de §5.2, `faq`). Valor
   ainda não coletado é `TODO-<tenant>`: conta como pendência, não vira linha.
   Nada do tenant vai para `src/` (`grep -ril <slug> src/` = 0).
2. **`scripts/create-tenant.sh docs/tenants/<slug>.seed.yaml`** com
   `SUPABASE_DB_URL` do ambiente-alvo. Saída esperada: `validateSeed: 0 erros`,
   `products=N customers=N companies=N`, `faq=N acervo_materiais=1 acervo_trechos=T`,
   `tenant=<slug> organization_id=<uuid> rows_created=R`. Segunda execução:
   `rows_created=0` (idempotente por id determinístico). O loader grava a
   organização com `onboarded_at`, usuários e papéis (ADR-003), `tenant_settings`,
   `channel_accounts`, catálogo, clientes/empresas e o FAQ no acervo (ADR-029 §3).
3. **`channel_accounts`**: o seed cria a conta `mock`. Em staging,
   `bash scripts/staging/seed-users.sh <slug>` dá senha aos usuários fictícios
   (`STAGING_SMOKE_PASSWORD`) e a sessão de canal mock. A conta WAHA real
   (`provider: waha`, `account_ref` = sessão) só entra com o número e o aceite
   do proprietário/Deka (D04) e a autorização de produção (D13).
4. **Configuração pelo `tenant_admin`**: login no app (`/app`), IA › Configurações
   (persona, "não sei", limiar, ligar/desligar), IA › Acervo (documentos),
   lembrete PJ em `orders.recurring_reminder`. O que o seed gravou tem
   `source='seed'`; o que a tela grava sobrepõe por chave; o seed nunca
   sobrescreve configuração viva.
5. **Conferir**: `SMOKE_TENANTS=<slug> bash scripts/smoke.sh http://127.0.0.1:3200`
   (login, clientes = seed, produtos = seed, webhook, inbox, lembrete);
   navegador com `E2E_TENANT=<slug>` (a organização A das dez specs nasce do
   seed desse tenant — ADR-029 §2).
6. **Remover** (só tenant efêmero): `delete from organizations where slug=…`
   (cascata) e os `auth.users` do seed por e-mail — é o que o script faz ao fim,
   conferindo `tenants=T` antes e depois.

## 7. Como rodar tudo do zero

Executado na F07-T04 por `scripts/from-scratch.sh` (linha em §2:
a linha `from-scratch:` de §2: `steps=7 pass=7/7 verify_exit=0 status="READY (F07)" commit=d7543c14` — quarta tentativa (a 1ª parou porque o README apontava para este relatório ainda não commitado; a 2ª ficou verde em tudo e reprovou só pelo `next-env.d.ts` gerado pelo build, ADR-029 §5; a 3ª estourou um `waitForResponse` de 30 s por rodar em paralelo ao gate 07)). Os sete passos, na ordem:

1. `git clone --branch feat/F03-conversation-inbox <origem> <dir>` — o commit, não a árvore de trabalho.
2. `pnpm install --frozen-lockfile` (Node ≥ 22, pnpm 9.15.9).
3. `bash scripts/verify/sandbox.sh up` — Supabase descartável em 5542x e
   `supabase/baseline.sql` aplicado (é a migração do self-host; a cadeia de
   migrations não sobe do zero — o baseline é o contrato do schema, ADR-010).
4. `SUPABASE_WORKDIR=.verify-logs/sandbox-workdir E2E_PORT=3102 pnpm e2e:env` —
   gera o `.env.e2e` (privado) a partir do sandbox; o `.env.example` é a
   referência de variáveis (gerado do código com arquivo:linha, ADR-004).
5. Seeds pelo loader: `create-tenant.sh docs/tenants/deka.seed.yaml` e
   `demo2.seed.yaml` (este com `--fictional-fixtures docs/tenants/demo2.f02-fixtures.yaml`
   e o marcador de sandbox); segunda passada com `rows_created=0`.
6. `F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable E2E_PORT=3102 bash scripts/verify.sh`
   → `STATUS: READY (F07)` e exit 0 no sandbox (no staging, com
   `VERIFY_ENVIRONMENT=staging`, → `READY (staging)`).
7. `bash scripts/verify/sandbox.sh down`.

Compose de staging/produção: `compose.staging.yml` + `scripts/staging/up.sh`
(build no host, camada Supabase local, baseline, seeds, produto) — runbook em
[docs/ops/staging.md](docs/ops/staging.md); o self-host single-tenant herdado
continua em `docker-compose.prod.yml` + `hostgator-setup-kit/`.

## 8. Riscos conhecidos

Classes: P0 = perda de dados/segurança em produção; P1 = bloqueia o piloto;
P2 = degrada operação; P3 = melhoria. **P0 = 0, P1 = 0.**

| # | Classe | Risco | Onde está | Mitigação vigente |
|---|---|---|---|---|
| 1 | P2 | Sentry herdado sem `SENTRY_DSN` envia erros para o projeto da comunidade | VARREDURA §B11 | **resolvido na F11-T00 (D51 d)**: sem DSN = desligado; comunidade só por `SENTRY_DSN=community` |
| 2 | P2 | Portas publicadas em `0.0.0.0` por OUTROS stacks desta VPS atravessam o `ufw` | VARREDURA §B12 | o staging publica só em loopback/Tailscale; regra descrita no runbook (1-way) |
| 3 | P2 | `up.sh` não é re-executável com `--fictional-fixtures` em staging já tocado pelo smoke da F06 | VARREDURA §B15 | **resolvido na F11-T00 (D51 d)**: rerun idempotente por id; reexecutado no staging em 13/09 (`rows_created=0`, sem erro) |
| 4 | P2 | Swap de 2 GB sem persistência a reboot | VARREDURA §B14 | `swapon /swapfile` manual; fstab é 1-way |
| 5 | P2 | `create_task` pela IA: o catálogo promete e o domínio nega (executor não-humano) | VARREDURA §B5/§C6 | recusa gravada e auditada; decisão do proprietário sobre D18 |
| 6 | P2 | Conversa nova a partir de `archived` (D34) não entregue | ADR-019, §C5 | a fronteira herdada reabre a conversa; decisão do proprietário |
| 7 | P3 | `products[].size` do seed não tem coluna no catálogo | ADR-029 §3 | **resolvido em D51/F11-T00**: `size` saiu de §5.21, dos seeds e do loader |
| 8 | P3 | Capacidade: VPS de 2 núcleos/7,9 GB dividida; gate leva 100–150 min e falha por carga acima de load 12 | ADR-027 §5, evidências F05 | gate com a máquina ociosa; staging medido em ~1,2 GB |
| 9 | P3 | `deka.seed.yaml` com 59 `TODO-DEKA` | D48 | a Deka preenche ao receber acesso; o loader não grava sentinela |
| 10 | P2 | Specs herdadas do modo de EDIÇÃO do suporte descrevem um modo que a rota SaaS não oferece mais (só leitura, D51) | VARREDURA §B16 | fora do inventário do gate; preenchem o motivo e abrem; asserções de escrita são decisão do proprietário |
| 11 | P3 | Planos `PLAN_A/B/C` com preço 0 e limites placeholder; carência 7 dias; gateway `mock` | ADR-030 §3 | tela do dono e do tenant rotulam "placeholder"; preço/nome/gateway/carência são do proprietário (D14, D44) |
| 12 | P3 | Organização herdada sem assinatura é `legacy_without_subscription` (permitida) | ADR-030 §3 | todo caminho de criação grava assinatura; o smoke mede `orgs_without_subscription=0/N` no staging |
| — | [DEFAULT] ainda não confirmados | D27 (meta do piloto), D28 (nome/domínio), D03 para produção (hosting de produção — o staging está decidido por D50) | §2.2 | pendências declaradas; nenhuma assumida |
