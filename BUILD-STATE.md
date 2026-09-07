---
updated_at: 2026-09-07T13:40:00Z
head_commit: c90a6eea   # F01-T02; o commit da T03 é o seguinte a este
f00_commit: c85f7d72eebe33649812fe5cae174b7dd80e0e9f   # HEAD auditado do Deskcomm; verify.sh conta tests_deleted a partir dele
current_phase: F01
next_task: F01-T04
status: IN_PROGRESS            # IN_PROGRESS | BLOCKED | READY_STAGING
baseline_n0: 8997
baseline_detail: "unit=7502/7503 integration=n/a db=1236/1238 e2e=259/290 @ c85f7d72; comandos: pnpm test:unit / test:db / test:e2e (E2E_PORT=3101, VITEST_MAX_THREADS=2, VITEST_MAX_FORKS=2; 11 falhas de e2e por ambiente, cinco itens no deskcomm-audit.md §1)"
hosting_confirmed: no          # dono muda para "yes <data> ADR-nnn" antes da F06 (default D03 ajustado: ver "Decisões pendentes")
build_env: "Claude Code na VPS (srv1958191), git nativo, tmux; Supabase local via CLI (opção A, 2026-09-07); WHATSAPP_MODE=mock AI_PROVIDER=mock"
verify_summary_last: |
  VERIFY SUMMARY
  build=ok lint=ok typecheck=ok
  unit=7502/7503 integration=pending db=1236/1238 e2e=pending baseline_n0=8997
  isolation: tables=pending ops=4 dirs=2 leaks=pending
  rbac: roles=3 denied_expected=pending denied_actual=pending
  entitlement: usage_events_written=pending
  ai_eval: cases=pending pass=pending unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=pending
  handoff: ai_msgs_after_handoff=pending summary=pending assignee=pending notify=pending
  reminder: runs=pending sent=pending duplicates=pending
  webhook: replay=pending stored=pending tables_checked=pending
  replicability: e2e[deka]=pending e2e[demo2]=pending src_diff_lines=pending grep_deka_in_src=0
  secrets: files_scanned=pending findings=pending
  tests_deleted=0 tests_skipped=15 mutants_killed=pending
  STATUS: READY (F00)
---

# BUILD-STATE

## Fases (D07)
| Fase | Nome | Estado: `pending` / `in_progress` / `done(verify=<data> <sha>)` |
|---|---|---|
| F00 | Auditoria do Deskcomm, verify.sh, ADR-001..003, baseline N0 | done(verify=2026-09-07 2a23537e) |
| F01 | Fundação: TenantContext, TenantConfiguration, Entitlement mínimo, seeds deka + demo2, create-tenant.sh | pending |
| F02 | CRM mínimo (customers, companies, products, orders, interactions, tasks, notes) | pending |
| F03 | WhatsApp in/out via ChannelAdapter WAHA + Inbox + estados da conversa | pending |
| F04 | Agente de IA + base de conhecimento + Action Policy + 9 tools | pending |
| F05 | Handoff com resumo + lembrete recorrente PJ | pending |
| F06 | Deploy em staging com mock + smoke | pending |
| F07 | FINAL-VALIDATION.md, replicabilidade deka/demo2, abrir BLOCKER-PROD | pending |

## Módulos (estado real @ c85f7d7; detalhe em `docs/migration/deskcomm-audit.md`)
| Módulo | Classe D29 | Onde (arquivo:linha @ sha) | Testes (N/N) | Estado |
|---|---|---|---|---|
| Auth + roles, RLS / organization_id | ADAPTAR | `lib/auth/require-role.ts:52`, `supabase/baseline.sql:1844` (CHECK 4 papéis), `:1768` (`platform_admins`); 162 policies, 107/117 tabelas com `organization_id`, 3 com org e sem policy, 49 com grant a `anon` @ c85f7d7 | `tests/invariants/rls-isolation.test.ts` (15 tabelas; 73 em DEBITO_CONHECIDO); db=1236/1238 | herdado; F01-T03/T04/T07 |
| WhatsApp (WAHA) | ADAPTAR | `lib/waha/ingest.ts:1065-1089`, `lib/waha/webhook-auth.ts:72-73` (fail-open), `lib/channels/types.ts:150` (só saída) @ c85f7d7 | `lib/waha/*.test.ts`, `tests/unit/assinatura-de-eventos-do-waha.test.ts` (dentro de unit=7502/7503) | herdado; sem mock, sem fixtures; F03-T02..T07 |
| Inbox / conversas | ADAPTAR | `supabase/baseline.sql:1394` (CHECK status, 7 valores), `lib/inbox/comando-da-conversa.ts:1-30` @ c85f7d7 | invariantes de atribuição/silêncio (~15, em db) | herdado; sem `transition()`; F03-T01/T05/T09 |
| IA + RAG | REFAZER (agente) / ADAPTAR (RAG) | `lib/agent-engine/agent/inbound-turn.ts` (3.391 linhas), `workers/ai-response-worker.ts:75`, `lib/ai/embeddings/chave.ts:58-59`, `supabase/baseline.sql:1058` (`vector(1536)`) @ c85f7d7 | `tests/invariants/rag-acervo-da-organizacao.test.ts` e unitários de `lib/agent-engine` | dois stacks de IA; ADR-002 provisório; F04 |
| CRM (clientes, produtos, pedidos) | ADAPTAR | `supabase/baseline.sql:1324` (`contacts`), `:1696-1717` (`orders` morta, e-commerce), migrations 0204 (`catalog_products`), 0210 (`crm_tasks`) @ c85f7d7 | invariantes de RLS/escopo (9, em db) | herdado; `orders` refeita e Nuvemshop removida na F02 |
| Workers / filas, CI / scripts | ADAPTAR | `supabase/baseline.sql:1522-1539` (`event_log`), `:6473` (`job_queue`), `docker/scheduler/entrypoint.sh:59-85` (21 crons) @ c85f7d7; CI: `verify`, `invariants`, `build-and-size`, `e2e`, `imagens-ok` | `tests/unit/cron-routes-scheduled.test.ts` | duas filas; ADR na F03; scripts reais: `typecheck lint test:unit test:db test:e2e build` (não existe `test:integration` — F03 cria) |
| TenantContext, TenantConfiguration, Entitlement, Action Policy, Handoff, Lembrete PJ, Notificações | CRIAR (Action Policy, Lembrete, Notificações) / ADAPTAR (TenantContext sobre `lib/supabase/admin.ts`, TenantConfiguration sobre `organizations.settings`, Entitlement sobre `llm_calls`+`ai_budgets`) / REFAZER (Handoff) | ver `docs/migration/target-state.md` | — | F01–F05 |
| Migrations | — | 201 arquivos em `supabase/migrations/` (cadeia não sobe do zero); `supabase/baseline.sql` aplicado no banco de dev em 2026-09-07 = **`aplicada`** (117 tabelas, 162 policies, extensão `vector` presente); `verificada` só após F01-T03/T04 | — | baseline `aplicada` |
Regra: `a_auditar` não existe mais (F00 fechou a classificação). Contagem da matriz: `reutilizar=6 adaptar=13 refazer=2 criar=3 remover=1` (25 linhas).

## BLOCKERS abertos
| Id | Tipo (D11) | O que precisa | Desde | Branch |
|---|---|---|---|---|
| (nenhum) | | | | |

Tipos: `credential_real`, `commercial`, `cost`, `production`, `real_message`, `restore_prod`, `real_data`, `contradiction_b`, `awaiting_owner`. `BLOCKER-PROD` (tipo `awaiting_owner`, aberto na F07) não muda `status` para BLOCKED.

## Registros humanos (só o proprietário escreve; o agente nunca preenche)
| Chave | Valor | Data |
|---|---|---|
| `visual:` | (ex.: 14/14) | |
| `restore_prod:` | (tables=T rows_diff=0) | |
| `deploy_prod:` | (commit) | |
| `channel_account:` | (deka real; aceite recebido em <data>, por <nome>) | |
| `owner_validated:` | | |
| `pilot_read:` | (leitura da meta D27) | |
| `verify_sh_frozen:` | (sha do verify.sh revisado — Etapa 9) | |
| `baseline_n0_owner:` | (Etapa 3: `unit=N/N typecheck=… tests_files=… last_commit=…` medido pelo dono) | |

## Decisões pendentes do dono
| Id | Tema | Default em vigor | Necessário antes de |
|---|---|---|---|
| D03 | Hosting/staging | Docker Compose nesta VPS; banco: Supabase **self-hosted ou local** (conta gratuita gerenciada cheia em 2026-09-07 — opção C ou plano Pro é decisão sua) | F06 |
| D02/E5 | Chave OpenAI + `AI_CHAT_MODEL`/`AI_EMBEDDING_MODEL` (ADR-002 provisório em 1536/`text-embedding-3-small`) | `AI_PROVIDER=mock` | fechar ADR-002; F04 real |
| D27 | Meta do piloto Deka (mensagens/dia, % IA, % pedidos PJ, duração, invalidação) | sem meta, piloto não começa | piloto (construção segue) |
| D28 | Nome da plataforma | `PLATFORM_NAME` em config | produção |
| D04 | Número de WhatsApp real + aceite escrito do risco de ban | número dedicado de teste / mock | produção |
| D14 | Nomes e preços dos planos | `PLAN_A/B/C` | Fase 2 |
| D25 | `verify.sh` congelado (revisão do dono ao fim da F00, Etapa 9) | v0 entregue na F00-T07, **aguardando revisão** | F01 (formalmente) |
| E3 | Baseline medido pelo dono (Etapa 3) | medido pelo agente em árvore limpa (`baseline_detail`) | comparação com N0 |
| D13/D26 | Deploy em produção e criação do tenant Deka real | não acontece | BLOCKER-PROD fechado por escrito |
| — | Deka no seed: dados reais (Etapa 7) | `docs/tenants/deka.seed.yaml` com placeholders `TODO-DEKA` | F01-T06 (seed real); piloto |

## NOT VALIDATED (real): integrações fechadas com mock; cada linha é item do checklist do proprietário
| Integração | Fechada em | Como validar | Validado em |
|---|---|---|---|
| WAHA (número dedicado de teste) | | 1 mensagem in + 1 out, contagem em `messages` | |
| OpenAI (chat + embedding) | | 1 caso de `docs/ai-eval/cases.yaml` contra provider real, custo em `ai_usage_events` | |
| E-mail transacional | | 1 e-mail entregue a uma caixa real, id do provedor no log | |
| Produção | | deploy feito pelo dono, `smoke: pass=6/6` contra a URL de produção | |
| Dados reais de clientes | | primeiro tenant real carregado por `create-tenant.sh`, sem dado real no repo | |
| Restore em produção | | `docs/ops/restore-prod.log` com `tables=T rows_diff=0` | |
| Teste visual/celular | | 7 telas × 2 dispositivos, `visual: 14/14` escrito pelo dono | |

## Histórico de fases (uma linha por fase concluída)
| Fase | Data | Commit | VERIFY SUMMARY resumido |
|---|---|---|---|
| F00 | 2026-09-07 | 2a23537e | build/lint/typecheck ok; unit=7502/7503 db=1236/1238 N0=8997 (e2e do N0: 259/290, 11 falhas de ambiente); STATUS READY (F00) |

## Regra de atualização
Migrations aparecem na tabela de módulos com um de três estados: `escrita`, `aplicada`, `verificada` (G-24). Ao fechar uma task: só `next_task`, `head_commit`, `updated_at`; a prova da task fica no corpo do commit (D37). Ao fechar uma fase: cabeçalho inteiro, linha da fase, linhas de módulos tocados, `verify_summary_last`, uma linha no histórico. Ao abrir ou fechar BLOCKER: tabela de BLOCKERS e `status`. Nunca a cada linha de código.
