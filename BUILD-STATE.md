---
updated_at: 2026-09-03T00:00:00Z
head_commit: <sha do HEAD no momento da atualização>
current_phase: F00              # F00 vira in_progress quando a F00-T01 roda; o arquivo nasce com a fase de partida, não com trabalho feito
next_task: F00-T01
status: IN_PROGRESS            # IN_PROGRESS | BLOCKED | READY_STAGING (READY_STAGING = F07 fechada e só BLOCKER-PROD aberto). No pacote de partida o valor já é IN_PROGRESS porque não há valor para "ainda não começou": o que diz que nada rodou é a tabela de fases, toda em `pending`, e o histórico vazio
baseline_n0: null              # F00 preenche com o número único N0 (soma de testes verdes); o detalhe por runner vai em baseline_detail
baseline_detail: null          # "unit=N/N integration=N/N db=N/N e2e=N/N @ <sha>, comando: <script real>"
hosting_confirmed: no          # dono muda para "yes <data> ADR-004" antes da F06
verify_summary_last: |
  (nenhum ainda; F00 cola aqui a primeira saída de ./scripts/verify.sh)
---

# BUILD-STATE

## Fases (D07)
| Fase | Nome | Estado: `pending` / `in_progress` / `done(verify=<data> <sha>)` |
|---|---|---|
| F00 | Auditoria do Deskcomm, verify.sh, ADR-001..003, baseline N0 | pending |
| F01 | Fundação: TenantContext, TenantConfiguration, Entitlement mínimo, seeds deka + demo2, create-tenant.sh | pending |
| F02 | CRM mínimo (customers, companies, products, orders, interactions, tasks, notes) | pending |
| F03 | WhatsApp in/out via ChannelAdapter WAHA + Inbox + estados da conversa | pending |
| F04 | Agente de IA + base de conhecimento + Action Policy + 9 tools | pending |
| F05 | Handoff com resumo + lembrete recorrente PJ | pending |
| F06 | Deploy em staging com mock + smoke | pending |
| F07 | FINAL-VALIDATION.md, replicabilidade deka/demo2, abrir BLOCKER-PROD | pending |

## Módulos (estado real; a F00 preenche com a classe D29 + arquivo:linha @ commit)
| Módulo | Classe D29 | Onde (arquivo:linha @ sha) | Testes (N/N) | Estado |
|---|---|---|---|---|
| Auth + roles, RLS / organization_id | a_auditar | | | |
| WhatsApp (WAHA) | a_auditar | | | |
| Inbox / conversas | a_auditar | | | |
| IA + RAG | a_auditar | | | |
| CRM (clientes, produtos, pedidos) | a_auditar | | | |
| Workers / filas, CI / scripts | a_auditar | | | |
| TenantContext, TenantConfiguration, Entitlement, Action Policy, Handoff, Lembrete PJ | CRIAR (salvo prova em contrário na F00) | | | |
Regra: `a_auditar` só existe até o fim da F00. Depois, cada linha tem classe (REUTILIZAR, ADAPTAR, REFAZER, CRIAR, REMOVER), local e contagem.

## BLOCKERS abertos
| Id | Tipo (D11) | O que precisa | Desde | Branch |
|---|---|---|---|---|
| (nenhum) | | | | |

Tipos: `credential_real`, `commercial`, `cost`, `production`, `real_message`, `restore_prod`, `real_data`, `contradiction_b`, `awaiting_owner`. `BLOCKER-PROD` (tipo `awaiting_owner`, aberto na F07) não muda `status` para BLOCKED: o estado final da Fase 1 é `status: READY_STAGING` com BLOCKER-PROD aberto.

## Registros humanos (só o proprietário escreve; o agente nunca preenche)
| Chave | Valor | Data |
|---|---|---|
| `visual:` | (ex.: 14/14) | |
| `restore_prod:` | (tables=T rows_diff=0) | |
| `deploy_prod:` | (commit) | |
| `channel_account:` | (deka real; aceite recebido em <data>, por <nome>) | |
| `owner_validated:` | | |
| `pilot_read:` | (leitura da meta D27) | |

## Decisões pendentes do dono
| Id | Tema | Default em vigor | Necessário antes de |
|---|---|---|---|
| D03 | Hosting | Docker Compose em VPS | F06 |
| D27 | Meta do piloto Deka (mensagens/dia, % IA, % pedidos PJ, duração, invalidação) | sem meta, piloto não começa | piloto (construção segue) |
| D28 | Nome da plataforma | `PLATFORM_NAME` em config | produção |
| D04 | Número de WhatsApp real + aceite escrito do risco de ban | número dedicado de teste | produção |
| D14 | Nomes e preços dos planos | `PLAN_A/B/C` | Fase 2 |
| D25 | `verify.sh` congelado (revisão do dono ao fim da F00, Etapa 9) | — | F01 |
| D13/D26 | Deploy em produção e criação do tenant Deka real | não acontece | BLOCKER-PROD fechado por escrito |

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
| (nenhuma) | | | |

## Regra de atualização
Migrations aparecem na tabela de módulos com um de três estados: `escrita`, `aplicada`, `verificada` (G-24). Ao fechar uma task: só `next_task`, `head_commit`, `updated_at`; a prova da task fica no corpo do commit (D37). Ao fechar uma fase: cabeçalho inteiro, linha da fase, linhas de módulos tocados, `verify_summary_last`, uma linha no histórico. Ao abrir ou fechar BLOCKER: tabela de BLOCKERS e `status`. Nunca a cada linha de código.
