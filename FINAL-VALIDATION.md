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
cobrança CRIAR): `reutilizar=6 adaptar=18 refazer=0 criar=4 remover=0` (28 linhas).
A F08 (ADR-032) acrescentou a linha da produção inicial (CRIAR):
`reutilizar=6 adaptar=18 refazer=0 criar=5 remover=0` (29 linhas). A F13
(ADR-034) acrescentou a linha do CRM comercial (CRIAR sobre o herdado):
`reutilizar=6 adaptar=18 refazer=0 criar=6 remover=0` (30 linhas). A F15
(ADR-036) acrescentou a linha da automação e autonomia de IA (CRIAR sobre o
herdado): `reutilizar=6 adaptar=18 refazer=0 criar=7 remover=0` (31 linhas). A F14
(ADR-038) acrescentou o chat do site (CRIAR) e adotou a agenda herdada
(ADAPTAR — a linha 5.9 abaixo): **`reutilizar=6 adaptar=19 refazer=0 criar=8 remover=0`** (33 linhas), a mesma da
tabela "Módulos" do BUILD-STATE mais os módulos herdados sem correspondente na
Fase 1.

| Módulo (§5) | Classe vigente | Código | Fase |
|---|---|---|---|
| 5.1 TenantContext | ADAPTAR | `src/tenant-context/` (`fromSession`, `fromJob`, `fromWebhook`, `withTenant`) sobre `lib/supabase/admin.ts` | F01 |
| 5.2 TenantConfiguration | ADAPTAR | `src/tenant-config/` (`schema.ts`, `validate-seed.ts`, `canonical-seed.ts`) sobre `organizations.settings` + `tenant_settings` | F01/F02 |
| 5.3 Entitlement | ADAPTAR | `src/entitlement/` sobre `lib/ai/budget/`, `llm_calls` → `ai_usage_events` (ADR-023) | F01/F04 |
| 5.4 Identity & RBAC | ADAPTAR | `src/rbac/matrix.ts` sobre `lib/auth/require-role.ts` (ADR-003; quarto papel `manager` na F13, ADR-034) | F01, F13 |
| 5.5 CRM Core | ADAPTAR (+ pedidos criados) | `contacts`/`catalog_products`/`crm_tasks` preservados; `src/crm/` com `crm_companies`, `crm_orders`, `crm_order_items` (ADR-012/013) | F02 |
| 5.5 CRM comercial (§7.9 F13) | CRIAR sobre o herdado | `src/crm/{campos,oportunidades,relatorio}`, `src/rbac/matrix.ts` (papel `manager`), migration 9026 (`crm_companies.custom_fields`, `fn_crm_report`), rotas `/api/v1/crm/opportunities/*`, `/api/v1/settings/{crm,crm-fields}`, `/api/v1/reports/crm`, telas `/app/settings/tenant/crm-fields`, `/app/crm/fila`, `/app/reports/crm` (ADR-034/035) | F13 |
| 5.5 Automação e autonomia de IA (§7.9 F15) | CRIAR sobre o herdado | `src/actions/{politica,nomes}.ts` (política por ação sobre o D33, catálogo 13), `src/ai/limite.ts` (limite diário no `withEntitlement`), `src/handoff/rodizio.ts`, `src/automation/{regras,motor}.ts` (regras 5×4 em motor pg; `lib/automation/engine.ts` herdado fica como validador), `src/events/emitir.ts`, `src/knowledge/reindexacao.ts`, migrations 9027–9029, rotas `/api/v1/settings/ai-autonomy` e `/api/v1/automation-rules`, telas `/app/settings/tenant/ia/autonomia` e `/app/settings/tenant/automation-rules` (ADR-036/037) | F15 |
| 5.7 Chat do site (§7.9 F14) | CRIAR | `src/webchat/` (sessão por token, freios, identificação, entrada pelo `concluirEntrada`, leitura, janela do humano), rotas públicas `/api/public/webchat/[slug]/*`, página `/chat/[slug]` (Route Handler com `frame-ancestors`), `/embed/[slug].js`, adapter `webchat` em `src/channels` e `lib/channels` (capability `liveVisitor`), migrations 9030/9031, rota `/api/v1/settings/webchat`, tela `/app/settings/tenant/webchat` (ADR-038/039) | F14 |
| 5.9 Agenda (§7.9 F14, D41) | ADAPTAR (herdada por membro) | `lib/agenda/` + `app/app/agenda` + `/api/v1/agenda/*` herdados, expostos; fachada SaaS `src/agenda/` (horários livres pelo motor puro, marcar com conflito nomeado, remarcar/cancelar pela RPC `fn_appointment_change`), ação `schedule_appointment` no catálogo (ADR-038) | F14 |
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
| 5.3 Entitlement (planos) e cobrança | CRIAR | `src/billing/` (`plans`, `subscriptions`, `billing_events`, `invoices` — 9023; gateway mock, acesso, carência, conciliação) e `src/entitlement/plano.ts` (resolver por plano, D14) — ADR-030 §3; **F19 (ADR-042)**: gateway `stripe` ao lado do mock (`gateway/stripe.ts`, `webhook-stripe.ts`, migration 9033), Customer Portal, padrão KN do `/admin` (`admin.ts`, `summary.ts`, `provisionar.ts`) | F12, F19 |
| Produção inicial nesta VPS | CRIAR | `compose.prod.yml` (stack `crm-prod`: Supabase local, WAHA real, Resend, Sentry próprio, sem dublê), `scripts/prod/*` (secrets/up/down/status/bootstrap-owner/backup/restore/backup-diario/prova + jornadas reais), `docs/ops/prod.md`; domínio `crm.kntecnologia.app` no Caddy do host (ADR-032) | F08 |

## 2. VERIFY SUMMARY final

Bloco colado na íntegra, rodado DENTRO do staging (ADR-028 §2), sobre
`e3c34195`, em `2026-09-19 20:20Z → 22:20Z` (6011 s de passos), exit `0`, com
`current_phase: F19` (inventário de F18 + `f19-cobranca-stripe` = 17 specs, 86
testes; linha `stripe:`; `rbac: roles=4` — ADR-043). O app do gate rodou com
`BILLING_GATEWAY=stripe` contra o Stripe FALSO da bancada (ADR-043 §4). Log em
`.verify-logs/f19-gate-03/` (não versionado); evidência versionada em
[docs/migration/evidence/construction-f19-20260919.txt](docs/migration/evidence/construction-f19-20260919.txt).
Os blocos anteriores ficam nas evidências das fases (F07, F11+F12, F08, F13, F15, F14, F18).

```text
VERIFY SUMMARY
scope=phase phase=F19 current_phase=F19 environment=staging
build=ok lint=ok typecheck=ok shell=ok
unit=8578/8578 integration=260/260 db=1683/1683 e2e=86/86 baseline_n0=8997
baseline_comparable: scope=unit+db passed=10261 required=8738 full_n0=pending
e2e_scope: F19-required passed=86/86 specs=17/17
isolation: tables=139 ops=4 dirs=2 leaks=0 (material_cross_org=98/139)
rls-coverage: tables_with_org_id=139 policies_found=116 missing=0 service_only_with_grant=0
rbac: roles=4 denied_expected=32 denied_actual=32
entitlement: usage_events_written=23
ai_eval: cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0
handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7 assignee=3 notify=3 notify_rows=6 msgs_after=3 provider_calls_after=0
reminder: runs=2 sent=1 duplicates=0 tables_summed=3
webhook: replay=2 stored=1 tables_checked=7
logs: routes=295 routes_logged=295 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=4/7
rate-limit: requests=101 status_429=1 auth_requests=101 auth_blocked=1 routes=295 routes_with_schema=295 routes_reading_input=162 validated=162
lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=2
admin: tenants_listed=3/3 support_sessions=2 support_reason=2/2 support_scope_denied=25/32 support_writes_denied=5/5 full_mode_rejected=1/1 signup_awaiting_payment=1/1 orgs_without_subscription=0/3
billing: plans=3 events=6 duplicates=1 out_of_order=1 activations=1/1 blocked_writes_denied=5/5 grace_days=7 reconciliation_mismatch=0/3 cancellations=1/1 data_preserved=7/7
crm: fields_defined=6 values_rejected=3/3 values_preserved=4/4 queue_size=5 distributed=5/5 balanced=1 second_claim_rejected=1/1 history_types=3 orders_linked=1/1 cross_org_link_denied=1/1 report_indicators=14/14 roles_denied=3/3
autonomy: policy_modes=4/4 ai_task_created=1/1 limit_hits=1/1 calls_after_limit=0/3 paused=1/1 resumed=1/1 handoffs=4 balanced=1 assignees_distinct=3 rules=4 runs=4/4 replays=4 duplicate_runs=0 outside_catalog_denied=1/1 reindexed=2/2 unchanged_skipped=4/4 sources_cited=1/1 roles_denied=3/3
channels: webchat_sessions=96 identified=12/12 contacts_created=11/11 messages_in=56 ai_replies=1/1 ai_outside_window=1/1 handoff_queued=1/1 ip_limited=1/1 org_limited=1/1 flood_calls_capped=1/1 cross_org_denied=1/1 appointments=7 conflicts_blocked=1/1 revoked_blocked=1/1 tz_ok=1/1 proposed=2/2 approved=1/1 denied_by_policy=1/1 roles_denied=2/2
engine: saas_turns=1 legacy_turns=1 volta_atras=1/1 heranca_prompt=1/1 heranca_acervo=1/1 limite_diario_nega=1/1 cancel_allow=1/1 cancel_passado_negado=1/1 cancel_auditado=1/1 policy_approve_pendura=1/1 tools_migradas=13/13 auditoria=5/5 roles_denied=2/2 fora_do_catalogo_negado=1/1 inventadas_descartadas=1/1
stripe: signature_rejected=1/1 livemode_mismatch=1/1 price_outside_list=1/1 checkout_created=1/1 activated=1/1 trialing_mapped=1/1 duplicates=1 out_of_order=1 state_from_provider=1/1 past_due=1/1 blocked_after_grace=1/1 cancelled_preserved=7/7 portal_link=1/1 admin_actions=5/5 summary_ok=1/1
replicability: e2e[deka]=ok e2e[demo2]=ok src_diff_lines=0 grep_deka_in_src=0 (deka=86/86 demo2=86/86 specs=17/17 org_a=seed-replica)
secrets: files_scanned=580 findings=0
tests_deleted=0 tests_skipped=0 expected_failures=0 tests_failed=0 tests_pending=0 mutants_killed=82/82
debt_known=0 skip_only_occurrences=15 violations=0
STATUS: READY (staging)
exit=0
```

Fora do bloco, contra o staging de pé, DEPOIS do READY e com a mesma imagem
(o `secrets.sh` acrescentou `ADMIN_SUMMARY_TOKEN`; o cockpit respondeu 401 sem
token e 200 com ele, com `gateway=mock/test ok=false` de propósito):

```text
restore: tables=184 tables_restored=184 rows=33004 rows_diff=0 dump=staging-20260919T223051Z.dump target=restore_20260919_223052 seconds=13 at=20260919T223052Z
smoke: steps=10 pass=10/10 … webchat_disabled_denied=2/2 engine_saas=2/2 webhook_stripe_unsigned_rejected=1/1 tenants=deka,demo2
p95_ms: endpoints=3/3 health=21 contacts=394 conversations=510 samples=20 url=http://127.0.0.1:3200
staging: compose=crm-staging services_running=15/15 memory_mib=1414 ports=127.0.0.1+tailscale(3200,56421,56422,56424) public_ports=0 host=4c/16GB swap=off image=F19(e3c34195)
```

Produção (com o código da F19 subido DEPOIS do READY, `BILLING_GATEWAY=mock`
por decisão — D57 f). O apêndice 9033 aplicou-se no banco que ATUALIZA (3/3
CHECKs com `stripe`/`cancelled`, 3/3 colunas), e o webhook do Stripe pelo
domínio responde 503 (fechado, sem segredo):

```text
prod: compose=crm-prod services_running=14/14 config_vars=29/29 placeholders=0/29 public_ports=0 https=1/1 hsts=1/1 vhosts_ok=7/7 owner_login=1/1 platform_admins=1 orgs=2 orgs_without_subscription=0/2 ai_turn=1/1 embedding=1/1 email=1/1 sentry_event=1/1 whatsapp=health_only billing_gateway=mock backup=1/1 restore_rows_diff=0 sha=e3c341958
prod_stack: compose=crm-prod services_running=14/14 memory_mib=1574 ports=127.0.0.1+tailscale(3300,56431,56432) public_ports=0
restore_prod: tables=184 tables_restored=184 rows=997 rows_diff=0 dump=prod-20260919T230038Z.dump target=restore_20260919_230046 seconds=40 at=20260919T230046Z
```

**Não há `stripe_real:` nesta fase.** A prova real (Stripe de verdade em modo
test: Checkout pago pelo navegador com o cartão 4242, webhook pela CLI, Portal,
cancelamento pelo provedor) exige a chave restrita de teste do proprietário
(`segredo crm-staging.env STRIPE_SECRET_KEY`), pedida no início da sessão e não
gravada até o fechamento. O script está pronto
(`scripts/staging/jornada-stripe.ts`), o runbook também (`docs/ops/staging.md`);
a objeção 1 do contraponto (a CLI com chave restrita, sem `stripe login`)
continua hipótese. O que o gate mede — assinatura do webhook, `livemode`,
preço fora da lista, estado buscado no provedor, uma fatura por fatura do
provedor, trial, Portal, as cinco ações do admin, o cockpit — mede contra o
Stripe falso, que devolve o que a bancada manda: é o contrato do adapter, não
o provedor.

Jornadas reais anteriores (uma vez cada, proprietário como único destinatário —
`docs/ops/prod-jornadas.log`): Sentry, e-mail pela Resend, FAQ indexado, turno
de IA, sessão do WAHA aguardando QR, limite diário (`ai_real:`, F15), o chat do
site com provedor real (`webchat_real:`, F14) e o despacho pelo motor novo
(`engine_real:`, F18 — a linha que fechou o §B8 como fato).
`demo3:` e `from-scratch:` desta fase estão no cabeçalho do BUILD-STATE
(`demo3: smoke 10/10 e2e 41/41`, primeira rodada verde; `from-scratch: 7/7 verify_exit=0 status="READY (F19)" commit=e3c34195`, verify
inteiro de 7750 s num clone do zero; a primeira tentativa morreu por OOM no
`next build` do clone com o sandbox e os dois stacks de pé — a segunda rodou com
o staging derrubado, como o risco 16 prevê)..

## 3. O que NÃO foi verificado

Cada item com a marcação e o dono humano (§8.6, D11, D12, D26).

| Item | Marcação | Dono humano |
|---|---|---|
| Provedor real de IA com CLIENTES: casos do ai-eval contra o provedor, custo real em volume, limites | PARCIAL — F08-T05 mediu 1 turno real (Anthropic, `claude-haiku-4-5`, 5 chamadas por turno em `ai_usage_events`) e 1 FAQ indexado (OpenAI, `ai_chunks` 3/3) na organização do dono; os 30 casos do ai-eval continuam medidos com `AI_PROVIDER=mock` no gate (D12) | proprietário + Deka (piloto D27) |
| WAHA real: parear número, receber/enviar, reconectar, ausência de duplicação | NOT VALIDATED (real) — container real de pé (`health_only`), sessão criada pelo produto e aguardando QR (cai em FAILED sem leitura); número é do proprietário (D12-4); achado: nome de sessão > 54 chars consertado (9025) | proprietário + Deka (número, aceite D04) |
| E-mail transacional real para TERCEIROS (convites, avisos) | PARCIAL — F08-T06: 1 e-mail pela API do produto (`lib/email/resend.ts`, id da Resend) e 1 recuperação de senha pelo GoTrue via SMTP, ambos ao proprietário; nenhum terceiro recebeu nada (regra da casa) | proprietário |
| Produção LIBERADA: clientes reais, `GOTRUE_DISABLE_SIGNUP=false` | PARCIAL — D53 (14/09): tenant `deka` ("Deka Sucos") criado pelo painel do dono na produção (PLAN_C `active/operator`, admin = proprietário, 0 e-mails a terceiros); cadastro público continua desligado; equipe da Deka ainda não convidada; nenhum cliente real | proprietário (liberação geral: `BLOCKER-PROD: liberado por … sha …`; convites da Deka pelo painel) |
| Dados reais de clientes; tenant Deka real; seed do deka preenchido (59 `TODO-DEKA`) | NOT VALIDATED (real) — fictícios; deka com placeholders (D48) | proprietário + Deka (Etapa 7) |
| Restore SOBRE o banco em uso (produção) | NOT VALIDATED (real) — restore só em banco VAZIO novo: staging `tables=183 rows_diff=0`, produção `tables=183 rows=207 rows_diff=0` (D36) | proprietário (`docs/ops/restore-prod.log`) |
| Teste visual e no celular (7 telas × 2 dispositivos) | NOT VALIDATED — não há navegador humano nesta sessão; acesso via Tailscale não exercido | proprietário + 1 atendente (`visual: 14/14`) |
| Sentry real sob erro de usuário | PARCIAL — F08-T07: 1 evento de teste no projeto próprio (`community=false`, allowlist 4/8 campos, 0/4 PII); erro real de tela/worker ainda não aconteceu | proprietário |
| Run do `verify.yml` no GitHub | NOT VALIDATED — o workflow existe e foi lido; o run e o link são do proprietário | proprietário |
| Meta do piloto D27 (baseline, metas, duração, critério de invalidação) | não preenchida — `docs/ai-eval/pilot-queries.sql` mede três das seis quando houver dados reais | proprietário + Deka |
| Firewall dos OUTROS stacks desta VPS (VARREDURA §B12) e persistência do swap (§B14) | descritos no runbook, não aplicados (portas 1-way) | proprietário |
| Busca semântica sobre o FAQ do seed (7 pares num trecho só) | não medida — a ingestão foi contada, a busca não | F08+ com provedor real |
| Cobrança REAL: gateway de pagamento, preço, nome dos planos, dias de carência, pró-rata, moeda | NOT VALIDATED (real) — gateway `mock` (`BILLING_GATEWAY=mock`), planos placeholder PLAN_A/B/C com preço 0 e limites declarados (ADR-030 §3, D14); `BILLING_GRACE_DAYS=7` é padrão, não decisão | proprietário (D14; gateway e contrato do provedor) |
| Cadastro público REAL (e-mail de confirmação, WhatsApp real no wizard, IA real na entrada guiada) | NOT VALIDATED (real) — cadastro cria assinatura `pending_payment` e o wizard conecta um canal MOCK (`conectarCanalMock`); nenhuma mensagem a pessoa real | proprietário + Deka (número, aceite) |
| Painel do dono e suporte com pessoa real: sessão de suporte usada por atendente humano, expiração observada no relógio | NOT VALIDATED — provado por integração e navegador com pessoas fictícias (`support_sessions=2`, `support_scope_denied=25/32`, TTL 1–60 min) | proprietário (teste visual, Tailscale) |
| Teste visual das telas novas da F13 (`/app/settings/tenant/crm-fields`, `/app/crm/fila`, `/app/reports/crm`) e relatório comercial com dados REAIS | NOT VALIDATED — provadas por navegador com organizações fictícias e do seed (7 testes × 2 tenants); a Deka ainda não tem oportunidade, campo ou pedido real | proprietário + Deka |
| Campos configuráveis de OPORTUNIDADE por organização; papéis personalizados (D15) | não construídos na F13/F15 (ADR-034: oportunidade continua por funil; papéis personalizados sem cliente que peça); `handoff.assignment=round_robin` foi construído na F15 (`handoffs=4 balanced=1 assignees_distinct=3`) | fases posteriores |
| Teste visual das telas novas da F15 (`/app/settings/tenant/ia/autonomia`, `/app/settings/tenant/automation-rules`) | NOT VALIDATED — provadas por navegador com organizações fictícias e do seed (7 testes × 2 tenants); a Deka não tem política, limite nem regra configurada | proprietário |
| Chat do site EMBUTIDO num site real (`<script src=…/embed/<slug>.js>` numa página fora do SaaS), `/app/settings/tenant/webchat` e a página `/chat/<slug>` no celular | NOT VALIDATED — provados por navegador com organizações fictícias e do seed (7 testes × 2 tenants: visitante sem cookie conversa, atendente responde); a Deka não ligou o chat (`webchat.enabled=false`, default) | proprietário + Deka |
| Chat do site com IA REAL respondendo a um visitante | PARCIAL — `webchat_real:` (F14-T05): turnos reais na organização do dono, o dono como visitante; produção responde pelo MOTOR HERDADO (§B8), não pelo turno SaaS que o gate mede | proprietário |
| Agenda com Google REAL (OAuth na conta do atendente, criar/alterar/cancelar espelhados no Google, revogação real) | NOT VALIDATED (real) — escolha do proprietário na F14 (D55 f); medido com o dublê do executor (`fn_google_appointment` claim/renew/commit) e 24 invariantes herdados | proprietário (conta Google) |
| A IA propondo horário a partir do TEXTO do cliente | NOT VALIDATED — o dublê do provedor não chama a tool; medido o caminho `execute()` → política → fachada (`proposed=2/2 approved=1/1 denied_by_policy=1/1`); em produção o motor herdado já marca por `crm_book_appointment` SEM a política da F15 (§B8) | agente (unificação dos turnos: fase própria) |
| Autonomia REAL com clientes: política `approve` pendurando ação de IA numa conversa real; regra disparando por evento real; limite diário batido por uso real | PARCIAL — F15-T06 mediu o LIMITE com o provedor real na organização do dono (`ai_real:` 3/3 turnos, 3/3 negadas antes do provedor, 0/3 chamadas depois do limite); política, regras e rodízio só com mock/fixtures no gate (`autonomy:`) | proprietário + Deka |
| `approve` para ação de IA SEM conversa vinculada (ex.: turno de job) | por desenho nega em vez de pendurar (ADR-036 §2 T01: aprovação pendurada exige conversa) — não há caso real medido | agente, se um cliente pedir |
| Condições (filtros) nas regras de automação pela tela | não construídas — o motor aceita `conditions` da regra herdada, a tela do SaaS grava sem condição (D54 e) | fase posterior |
| Tenant efêmero (`demo3`) e `from-scratch` | EXECUTADOS no fechamento da F15 e da F14 (linhas `demo3:` e `from-scratch:` no cabeçalho do BUILD-STATE e nas evidências F15/F14); as migrations 9025–9031 entraram pelo baseline | agente a cada fase que mexer em migration |
| Specs herdadas de suporte (`suporte-temporario.spec.ts`, `agenda-presenca-recuperacao.spec.ts`) | `suporte-temporario` REESCRITA na F15 para o modo só-leitura e medida no staging (VARREDURA §B16); fora do inventário do gate porque termina numa asserção de REALTIME (websocket do inbox) que esta bancada não passa; `agenda-presenca-recuperacao` continua fora | proprietário (realtime) |
| Turno de IA dentro da janela de envio (7h–22h, pacing do canal) | VALIDADO — `ai_turn: ok` às 07:01 BRT (231 chars, dry run da versão em rascunho); fora da janela o turno roda e a resposta fica agendada (`ai_turn: window`, 04:14 BRT) | agente/proprietário |
| Caixa de entrada do proprietário (os dois e-mails de F08-T06 chegaram?) | NOT VALIDATED — o agente vê o id da Resend e o audit do GoTrue, não a caixa | proprietário |
| Backup diário pelo cron (03:20) — a primeira execução agendada | NOT VALIDATED — o script rodou à mão (1/1 confirmado no remoto); o cron ainda não disparou | proprietário (`~/backup.log`, marcador `/var/tmp/crm-os-backup-success.marker`) |
| Stripe REAL em modo test (Checkout pago com o cartão 4242, webhook pela CLI, Portal, cancelamento pelo provedor) — `stripe_real:` | NOT VALIDATED (real) — a chave restrita não foi gravada durante a sessão (`segredo crm-staging.env STRIPE_SECRET_KEY`); a fase está provada contra o Stripe FALSO da bancada (`stripe:` no gate, 17 specs no staging) e o script da prova real existe (`scripts/staging/jornada-stripe.ts`, runbook `docs/ops/staging.md`); objeção 1 do contraponto (a CLI com chave restrita, sem `stripe login`) continua hipótese | proprietário (chave) + agente (rodar a jornada) |
| Stripe na PRODUÇÃO | NOT VALIDATED (real) por decisão (D57 f): `BILLING_GATEWAY=mock`, `prod: … billing_gateway=mock`; ligar = endpoint de webhook no domínio + chaves + `up.sh` (`docs/ops/prod.md`) | proprietário |
| Checkout do Stripe REAL por navegador (seletores `#cardNumber`, `#cardExpiry`, `#cardCvc`, `#billingName` da página do Stripe) | NOT VALIDATED — hipótese do `jornada-stripe.ts`; se a página mudar, a prova real cai para "criar a subscription pela API com `pm_card_visa`" (o receptor já trata `customer.subscription.created`) | agente, quando a chave existir |
| Teste visual das telas da F19 (`/app/billing` com Portal e trial; `/admin/billing` com as cinco ações; `/api/admin/summary` no cockpit da KN) | NOT VALIDATED — provadas por navegador com organizações fictícias (7 testes × 2 tenants) | proprietário |
| Nome e preço REAIS dos planos (D14): `plans.price_cents=0` na tela × Products placeholder R$ 10/20/30 em modo test | não decididos — as duas verdades de preço estão declaradas (ADR-042 Consequências) e mudam juntas (migration `source='owner'` + `stripe:provision`) | proprietário |

## 4. ADRs

39 arquivos em `docs/decisions/` (`ls docs/decisions | wc -l` = 39), uma linha por decisão:

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
| ADR-032 | F08: produção inicial nesta VPS (D53: tenant Deka criado na produção em 14/09, WhatsApp adiado) (stack `crm-prod`, domínio, provedores reais), decisões D12/D52 (Stripe depois; planos placeholder; carência 7 dias sem pró-rata), quatro achados (aspas do `segredo`, `PLATFORM_NAME`→`APP_NAME`, compose herdado não serve, nome da sessão do WAHA > 54), linha `prod:` fora do bloco |
| ADR-033 | verify.sh v1.7: F08 no gate com o inventário de F12, `admin`/`billing` pela ordem de fechamento, régua do compose de produção, mutante 65 |
| ADR-034 | F13: CRM comercial sobre a base herdada — tasks T00–T06, campos por organização em `tenant_settings`, papel `manager` (ADR-003 reaberta), fila de oportunidades por rodízio, vínculo com pedido, relatório conferido com a origem, §B17 |
| ADR-035 | verify.sh v1.8: F13 no gate com a spec `f13-crm-comercial`, linha `crm:` (12 campos), `rbac: roles=4` pela fase ativa da árvore, mutantes 66–68 |
| ADR-036 | F15: automação e autonomia de IA (D54) — tasks T00–T06, emissores por `emit_event` + índice 9027, política por ação sobre o D33 (catálogo 13, `create_task` pela IA fecha §B5/§C6), limite diário com pausa e aviso (9028), handoff por rodízio (9029), regras 5×4 sobre o catálogo em motor pg, reindexação incremental com fonte citada, linha `ai_real:` fora do bloco, §B16 só-leitura |
| ADR-037 | verify.sh v1.9: F15 no gate com a spec `f15-automacao-e-autonomia`, linha `autonomy:` (17 campos), `requiresAutonomy` pela ordem de fechamento, mutantes 69–72 |
| ADR-038 | F14: chat do site (canal `webchat` no mesmo modelo; visitante anônimo com identificação; página + embed com `frame-ancestors`; três freios; IA 24 h por `liveVisitor`), agenda herdada ADOTADA por membro (D41) pela fachada `src/agenda`, `schedule_appointment` no catálogo (14) sob a política da F15; migrations 9030/9031; WhatsApp fora da fase; as três objeções do contraponto como testes; achado §B8 reafirmado |
| ADR-039 | verify.sh v1.10: F14 no FIM de `CLOSING_ORDER` (a cláusula numérica deixa de se somar à posicional), spec `f14-canais-e-agenda`, linha `channels:` (19 campos), mutantes 73–76 |
| ADR-040 | F18: um motor de IA só (D56) — o turno SaaS assume o despacho pela chave `ai.engine` (`saas` padrão, `legacy` volta atrás), 13 ações migradas do MCP (28 no catálogo), 41 na fila de espera, fail-closed `tool_missing`, herança do agente publicado, `cancel_appointment` em `allow` |
| ADR-041 | verify.sh v1.11: F18 no FIM de `CLOSING_ORDER`, spec `f18-motor-unico`, linha `engine:` (14 campos), `lint:channels` de volta ao gate, teto por passo + entrada fechada, mutantes 77–80 |
| ADR-042 | F19: cobrança real por Stripe + padrão KN do `/admin` (D57) — gateway `stripe` sobre a máquina de estados da F12 (assinatura do webhook, livemode, preço fora da lista, estado buscado no provedor, uma fatura por fatura do provedor), migration 9033, trial de 7 dias com cartão, Customer Portal (409 `use_portal` nas rotas da F12), cinco ações do admin + cockpit por token + provisionamento, página-ponte na volta do Checkout, produção fica `mock` (D57 f), §B23 (b) como T00 |
| ADR-043 | verify.sh v1.12: F19 no FIM de `CLOSING_ORDER`, spec `f19-cobranca-stripe`, linha `stripe:` (15 campos, no contrato, na leitura e no render), gate contra o Stripe falso (`BILLING_GATEWAY=stripe` no `.env.e2e`, segundo `webServer`), smoke +1 (`webhook_stripe_unsigned_rejected`), mutantes 81–85 |

## 5. Pendências para produção

Os sete itens de D12, com o estado e o dono — **7/7 com dono; 6/7 fornecidos
e aplicados na F08 (D52)**, 1 adiado pelo proprietário (WhatsApp). O
BLOCKER-PROD continua aberto (D13): produção inicial de pé, não liberada.

| # | Item (D12) | Estado | Dono |
|---|---|---|---|
| 1 | Domínio da plataforma (e `PLATFORM_NAME`, D28) | `crm.kntecnologia.app` no Caddy do host (HTTPS/HSTS); `PLATFORM_NAME="CRM OS"` → `APP_NAME` | proprietário ✔ (F08-T03) |
| 2 | Supabase de produção (projeto/servidor, senhas, backup) | compose local `crm-prod` (56431/56432, só loopback + Tailscale); backup diário → Drive; restore `rows_diff=0` | proprietário ✔ (F08-T02/T09) |
| 3 | IA real (chat + embedding) | `AI_PROVIDER=anthropic` (chave da KN) + `OPENAI_API_KEY` com teto; 1 turno e 1 FAQ medidos | proprietário ✔ (F08-T05) |
| 4 | Número de WhatsApp + aceite escrito do risco de ban da Deka (WAHA, D04) | **adiado pelo proprietário**; container WAHA real de pé, sessão aguardando QR | proprietário + Deka |
| 5 | E-mail transacional (provedor e remetente) | Resend da KN, `crm@mail.kntecnologia.app` (SMTP no GoTrue, API no app); 1 envio medido | proprietário ✔ (F08-T06) |
| 6 | Sentry (DSN próprio — não o da comunidade, §B11) | projeto `crm-os`, `community=false`, 1 evento medido | proprietário ✔ (F08-T07) |
| 7 | Usuário `platform_admin` de produção | criado pelo proprietário (`scripts/prod/bootstrap-owner.sh`): 1 usuário, organização "KN Tecnologia", assinatura PLAN_C `active/operator` | proprietário ✔ (F08-T04) |

Também antes de produção, fora de D12: aprovação escrita de produção (D13),
regra de firewall dos outros stacks (§B12), swap persistente (§B14), decisão
sobre §B15 (rerun do `up.sh` em staging tocado pelo smoke), §C5 (conversa nova
a partir de `archived`). §B5/§C6 (`create_task` pela IA) foi decidido na F15
(D54 d: permitido, executor `ai` auditado, política por ação como freio).
Da F14: apagar as duas linhas `ai.enabled` e `webchat.enabled` que a prova
`webchat_real:` (rodada 3) deixou em `tenant_settings` da organização do dono
(valores iguais ao padrão; o dump `prod-20260918T142544Z` prova que não
existiam) — `delete from public.tenant_settings where organization_id='e73f0438-5fec-4794-8999-6d046d835978' and key in ('webchat.enabled','ai.enabled')`
no `psql` da produção (negado ao agente pelo classificador); ligar
`webchat.enabled` e cadastrar `webchat.allowed_origins` na organização que for
usar o chat (`/app/settings/tenant/webchat`); Google OAuth real por membro
(D41: NOT VALIDATED (real)); §B8 foi FECHADO na F18 (ADR-040). Da F19:
ligar o Stripe na produção é do proprietário (D57 f — `docs/ops/prod.md`:
endpoint de webhook em `crm.kntecnologia.app/api/v1/webhooks/stripe`,
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_IDS`/
`STRIPE_PORTAL_CONFIGURATION_ID`, `BILLING_GATEWAY=stripe`, `up.sh`); o
`ADMIN_SUMMARY_TOKEN` gerado por `secrets.sh` é o bearer do cockpit da KN;
nome e preço reais dos planos (D14) continuam placeholder.

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

Executado na F07-T04, reexecutado no fechamento da F15 (15/09/2026: `steps=7 pass=7/7 verify_exit=0 status="READY (F15)" commit=d2a66fb8`; a primeira tentativa reprovou por fase fixa no script, consertada em `d2a66fb8`) e no fechamento da F14 (18/09/2026 — linha `from-scratch:` no cabeçalho do BUILD-STATE: steps=7 pass=7/7 verify_exit=0 status="READY (F14)" commit=10fde380) por `scripts/from-scratch.sh` (linha da F07 em §2:
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

Compose de staging: `compose.staging.yml` + `scripts/staging/up.sh` (build no
host, camada Supabase local, baseline, seeds, produto) — runbook em
[docs/ops/staging.md](docs/ops/staging.md). Produção inicial (F08):
`compose.prod.yml` + `scripts/prod/up.sh` (mesma receita, SEM seeds, provedores
reais) + `scripts/prod/bootstrap-owner.sh` — runbook em [docs/ops/prod.md](docs/ops/prod.md).
O self-host single-tenant herdado continua em `docker-compose.prod.yml` +
`hostgator-setup-kit/` (não usado pela produção do SaaS — ADR-032 §3).

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
| 13 | P1 | O nome da sessão do WAHA gerado pela reserva herdada (69 chars) era recusado pelo WAHA 2026.7.2 (> 54): nenhuma instalação conectava número | ADR-032 §3, migration 9025 | **resolvido na F08-T05**: sufixo em 16 hex (53 chars), linhas existentes encurtadas, prova em `tests/invariants/f08-t05-nome-de-sessao-do-waha.test.ts` |
| 14 | P2 | A janela de envio do pacing (7h–22h, `America/Sao_Paulo`) vale também para o ENSAIO do agente: fora dela o turno roda (custa tokens) e a resposta fica agendada, não exposta | `lib/agent-engine/pacing/engine.ts`, F08-T05 | conhecido e documentado; a jornada de F08 repete dentro da janela; o proprietário ajusta a janela por canal se quiser |
| 15 | P2 | Cadastro público DESLIGADO em produção (`GOTRUE_DISABLE_SIGNUP=true`) enquanto o BLOCKER-PROD estiver aberto | compose.prod.yml, D13 | ligar exige ADR + `up.sh` depois da liberação escrita; convites do dono continuam pelo admin API |
| 16 | P2 | Dois stacks nesta VPS (staging 1,4 GB + produção 2,1 GB) somam ~3,5 GB residentes; o gate precisa de ≥ 3 GB livres | ADR-032 Consequências | medir `free -m` antes do gate; derrubar o staging (`scripts/staging/down.sh`, volumes ficam) é 2-way se faltar memória |
| 17 | P2 | `GET /api/v1/admin/tenants?q=` (busca por texto do painel do dono) responde 500 no PostgREST real (`slug::text` dentro do `or`) | VARREDURA §B17 → §A11 | **resolvido na F13-T00 (ADR-034 §4)**: `slug.ilike`; caso de spec em `f13-crm-comercial` (por slug e por nome, 200 com A sem B) |
| 18 | P3 | `manager` passou a papel D15 próprio (F13): instalação herdada com membros `manager` deixa de tratá-los como `tenant_admin` — eles perdem usuários/produtos/acervo e mantêm configuração comercial, funil, campos, fila e relatório | ADR-034 §2 T02, `src/rbac/matrix.ts` | por desenho (ADR-003 previa reabrir); nenhuma instalação desta base tem `manager` além das fixtures; o `tenant_admin` promove pelo painel de equipe |
| 19 | P3 | `crm.distribution=manual` por default: a fila existe, mas ninguém distribui até a organização ligar o rodízio na tela da fila | ADR-034 §5 | declarado, não fato; o manager liga pela tela (`PATCH /api/v1/settings/crm`) |
| 20 | P2 | Dois motores de regras na árvore: o SaaS executa por `src/automation/motor.ts` (pg, run reservada + índice 9027); o `lib/automation/engine.ts` herdado (Supabase) sobrevive como validador/legado — quem editar um e não o outro diverge | ADR-036 §2 T04 | o handler do webhook chama só o motor pg; o teste de integração cobre a regra herdada (`create_or_move_lead`) pelo motor novo; retirar o herdado é limpeza para F17 |
| 21 | P3 | `approve` numa ação de IA SEM conversa vinculada NEGA (não há onde pendurar a aprovação): um job que use `create_task` com política `approve` nunca executa | ADR-036 §2 T01 | documentado na tela (texto do modo); o `tenant_admin` escolhe `allow` ou `block` para ações de job |
| 22 | P3 | `ai.limits.daily_turns` é contado no fuso da organização (`organizations.timezone`); organização sem fuso cai em `America/Sao_Paulo` — o dia "vira" numa hora que pode não ser a do cliente | ADR-036 §2 T02 | o aviso `ai.limit_reached` diz o dia; o limite é opt-in (`0` = sem teto) |
| 23 | P2 | Asserções de REALTIME (websocket do inbox) não passam nesta bancada: `inbox-tempo-real` e a `suporte-temporario` reescrita ficam fora do CI — uma regressão no realtime só aparece no teste visual | VARREDURA §B16; RETOMADA regra 7 | teste visual do proprietário; medir o realtime é pendência declarada |
| 24 | P3 | Build de OUTRO projeto nesta VPS (`oferta-os`) durante o e2e do gate elevou load5 > 6 sem causar timeout — margem, não garantia | D51 c | avisar as outras sessões antes do gate; `uptime`/`free -m` na receita; nunca dois gates |
| 26 | P2 | **Dois turnos de IA: o de produção não é o que o gate mede.** Quem responde o cliente em produção é o motor herdado (`runAgentTurn`, job `inbound_turn`, 57 tools MCP — inclusive `crm_book_appointment`); a política por ação da F15 e o `schedule_appointment` da F14 governam o turno SaaS (`responderTurno`), que não está ligado ao despacho (`elegivelParaWorkerLegado=false`, ADR-021) | VARREDURA §B8; ADR-038 Consequências | declarado, não fato: unificar (ou ligar o turno SaaS ao despacho) é decisão de fase própria; até lá, "autonomia por ação" vale para o que o gate mede, não para o que a Deka recebe |
| 27 | P2 | Endpoint público com IA: os freios são fixos em código (30 sessões/h e 60 mensagens/h por IP, 600 mensagens/h por organização) e o teto diário da F15 é opt-in (`0` = sem teto) — uma organização que ligar o chat sem teto paga o que a enxurrada consumir dentro dos 600/h | ADR-038 §5/§6 | `webchat.enabled=false` por default; recomendação ao ligar: definir `ai.limits.daily_turns` |
| 28 | P3 | `WHATSAPP_MODE=mock` dubla todo provider SaaS menos o `webchat` (sem transporte); o mock global sem pool morre com AggregateError se alguém o chamar fora de teste com pool — como aconteceu no gate 02 | `src/channels/index.ts` | o webchat nunca passa pelo mock; o resto continua como antes |
| 29 | P3 | Reaplicar o baseline por `psql` no staging travou o PostgREST (504 `PGRST003`) até `docker restart crm-staging-rest`; o `up.sh` só reinicia o realtime | VARREDURA §B20 | receita da RETOMADA reinicia o `rest` depois do baseline |
| 25 | P3 | Provas "do zero" envelhecem quando não rodam a cada fase: `from-scratch.sh` (F07) gravava `current_phase: F07` fixo e reprovou a árvore da F15 por "RBAC fora do contrato" (4 papéis desde a F13) na primeira execução em 8 fases | ADR-029 §4; commit `d2a66fb8` | a fase vem da origem (ou `FROM_SCRATCH_PHASE`); `demo3` e `from-scratch` entram no fechamento de toda fase que mexer em migration ou no verify (RETOMADA regra 12) |
| 30 | P2 | Volta do Checkout do Stripe com `SameSite=Strict`: um redirect direto para `/app/billing` deslogava a pessoa (medido na bancada, 7/17 specs) | ADR-042; `app/api/v1/billing/retorno/route.ts` | **resolvido na F19-T05**: página-ponte pública ancorada (o mesmo remédio da volta do Google); `success_url`/`cancel_url` apontam para ela |
| 31 | P2 | Dois eventos do mesmo ciclo (`checkout.session.completed` + `invoice.paid`) abriam duas faturas pagas no CRM | ADR-042 Consequências | **resolvido na F19-T05**: a fatura do CRM segue a fatura do provedor (`invoice_ref`), uma por ciclo em qualquer ordem |
| 32 | P3 | Produção com o código do Stripe e `BILLING_GATEWAY=mock` (D57 f): a cobrança real continua NOT VALIDATED (real) em produção; o cockpit responde `gateway ok=false` de propósito | ADR-042 §7; `docs/ops/prod.md` | declarado; ligar é do proprietário (endpoint + chaves + `up.sh`) |
| 33 | P3 | `next build` na VPS morre por OOM (anon-rss 3,4–3,9 GB) quando outra sessão roda vitest/eslint em paralelo — duas tentativas perdidas nesta fase | evidência F19 | avisar as sessões antes (D51 c) e limitar o heap a 3 GB como o verify já faz; medir `free -m` antes do build |
| 34 | P3 | Preços placeholder em duas verdades: `plans.price_cents=0` (tela) × Products do Stripe R$ 10/20/30 em modo test (D57 d) | ADR-042 Consequências | quando D14 fechar, migration `source='owner'` e `stripe:provision` mudam juntos |
| — | [DEFAULT] ainda não confirmados | D27 (meta do piloto), D28 (nome/domínio), D03 para produção (hosting de produção — o staging está decidido por D50) | §2.2 | pendências declaradas; nenhuma assumida |
