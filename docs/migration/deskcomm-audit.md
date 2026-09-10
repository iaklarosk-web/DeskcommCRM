# deskcomm-audit — Auditoria F00 do DeskcommCRM

## Checkpoint F02 concluído tecnicamente — 03ec6a3b56826ab882782efb1dd5185f47e52a8c

Este checkpoint tem precedência sobre descrições históricas do estado atual.
As medições F00/F01 preservadas abaixo continuam atribuídas a seus commits.
D47 determina pausa após F02; D48 retira dados Deka dos gates de engenharia.
[ADR-014](../decisions/ADR-014-F02-configuravel-e-pausas.md) e [desenho F02](../design/F02-pedidos-do-dia.md) registram o contrato genérico.

| Superfície | Fonte no checkpoint | Implementação |
|---|---|---|
| Cliente e pedidos da ficha | `components/crm/ContactOrders.tsx:23` | Leitura paginada, vazio/erro e acesso ao pedido do contato. |
| Empresas | `app/api/v1/companies/route.ts:49` | CRUD sob organização ativa; vínculo de empresa e snapshot do pedido. |
| Catálogo | `lib/catalogo/listar.ts:33` | Busca literal e paginação; leitura e escrita têm policies por operação (9011). |
| Pedidos/itens | `src/crm/orders/service.ts:115` | Comandos transacionais com identidade, revisão, snapshots, histórico e idempotência. |
| Notas | `components/crm/CrmNotes.tsx:28` | Notas humanas vinculadas ao titular/pedido, sem lead fictício. |
| Tarefas | `components/crm/LinkedOrderTasks.tsx:40` | Tarefas e histórico vinculados ao pedido. |
| Configuração comercial | `src/tenant-config/commercial-service.ts:357` | Identidade/timezone/moeda canônicos em organizations; seis campos comerciais em tenant_settings; aliases antigos arquivados privadamente. |
| Relatório diário | `src/crm/orders/daily.ts:345` | Data e critério explícitos; identidade canônica da empresa, consulta completa, grupos e centavos/milésimos exatos. |
| Conferência | `src/crm/orders/checks-service.ts:119` | Quantidade conferida por item/revisão, separada da venda; recibos privados e histórico imutável. |
| Seeds fictícios | `scripts/f02-fixture-writer.ts:185` | Opt-in em sandbox com marcador do banco; gravação idempotente. |
| Exportação de pedidos | `src/crm/orders/export.ts:124` | Escopo pelo titular e organização; inclui journal de conferência sem recibos/chaves/hashes. |

Branding permanece em `organizations.settings.branding`; o arquivo legado é a
tabela privada `private.tenant_setting_alias_archive`, criada na 9010, com RLS,
zero policies e nenhum grant direto a anon/authenticated/service_role. A fachada
`src/tenant-config/settings.ts` lê os aliases da origem canônica e recusa escrita
nesses aliases. Não é uma migração geral dos seis escritores de branding para
`setSetting`; a descrição histórica que propunha isso não reflete a implementação.

O journal de conferência da 9012 tem `USING (organization_id in (select
public.fn_user_org_ids()))`; as leituras HTTP/RPC especificam também organização.
O recibo privado mantém RLS, zero policies e nenhum grant de cliente. As provas
medem tabelas existentes e o catálogo de policies; números F00 não são contagens
atuais. O baseline preserva a varredura final de anon e migrações aplicadas são
imutáveis. Nenhum dado `orders` externo foi apagado ou reinterpretado.

[Evidência T04–T08](evidence/construction-f02-t04-t08-20260909.txt) preserva provas
focais e tentativas. O gate05 sobre o código funcional `5f3df2cf` aprovou
unit8380/8380, integração72/72, banco1585/1585 e E2E13/13, mas reprovou quatro
mecanismos de teste (23/27 scripts mutantes). O checkpoint `4ec7bb56` corrigiu
esses mecanismos, com controle RLS9/9, vazamentos8/8 e rechecagens02=1/1,03=5/5,26=5/5.
O gate06 aprovou 27/27 scripts, mas encerrou NOT READY com E2E12/13 por uma espera
insuficiente na lista do viewer. O checkpoint `03ec6a3b` sincroniza a resposta
GET HTTP200, a fixture exata e sua exibição na UI
(`tests/e2e/f02-crm-navigation.spec.ts:316-337`); a rechecagem A/B passou2/2.
A CI34439000032 e o Docker34439000033 desse checkpoint passaram. O gate07 terminou
com exit 0 em `4617.77s`, concluído às `2026-09-10T06:11:30Z`:
unit8380/8380, integração72/72, DB1585/1585, E2E13/13 em sete specs,
mutantes27/27, `tests_pending=0`, `debt_known=0` e zero violações. Os indicadores
das fases futuras continuam `pending` e não entram no fechamento de F02.
O verificador registrou `STATUS: READY (F02)` em
`.verify-logs/f02-final-07/orchestration.log:15-33`; o término está em
`.verify-logs/f02-final-07/result.json:1-4`. [Evidência T13](evidence/construction-f02-t13-20260909.txt)
e [matriz das APIs](evidence/f02-t04-api-matrix.md). F02 conclui seu escopo técnico
e a construção pausa antes de F03, conforme D47.

Conforme a [ADR-015](../decisions/ADR-015-request-id-canonico-F02.md), 21 módulos e
34 operações F02 usam o identificador canônico nos envelopes e auditorias.
O E2E comprovou suporte somente leitura, quatro grupos de leitura/quatro recusas,
duas auditorias correlacionadas e IDs gerado/ecoado. As 11 referências da tabela
foram revalidadas contra o checkpoint acima; arquivos de aplicação não mudaram
no reparo dos mecanismos de teste. Toda a execução usa fixtures fictícias e
WhatsApp/IA mock. Aceite visual do proprietário, operação Deka, provedores
reais, produção e E2E integral do upstream não foram validados. Esses limites
permanecem explícitos, mas dados e operação Deka não bloqueiam a engenharia
genérica concluída em F02, conforme D48.


Saída da F00 (DIRETRIZ §6). Tudo abaixo cita `arquivo:linha @ c85f7d7`. O que não foi verificado está na seção 8.

## 0. Identificação

| Item | Valor |
|---|---|
| Upstream | `melgarafael/DeskcommCRM` (público) |
| Fork | `iaklarosk-web/DeskcommCRM`, branch `v2` (base) → `feat/F00-auditoria` |
| HEAD auditado | `c85f7d72eebe33649812fe5cae174b7dd80e0e9f` — "Merge pull request #618 from melgarafael/release/1.16.1", 2026-09-06 23:00 -03 |
| Gerenciador | `pnpm@9.15.9` (`packageManager`), Node `v22.23.2` (`engines: >=22`) |
| Arquivos `*.test.*` fora de `node_modules` | 852 (`find . -name "*.test.*" -not -path "./node_modules/*" \| wc -l`) |
| Ambiente de construção | Claude Code na VPS (Ubuntu 24.04, 2 vCPU, 7,8 GB), git nativo, Docker 29.1, Supabase CLI 2.116 |
| Banco de dev | Supabase local (`supabase start` em `~/projetos/DeskcommCRM`, config herdada `supabase/config.toml`, Postgres 15), inicializado com extensões + `supabase/baseline.sql` (a cadeia de `migrations/` não sobe do zero — `docs/SETUP.md:128`, `MANIFEST.md:36-40`); Realtime reiniciado depois do baseline como faz `.github/workflows/e2e.yml:569-611` |

Medidas do banco depois do baseline (`pg_tables`/`pg_policies`, consulta colada na seção 4): `tabelas=117 com_policy=109 sem_policy=8 sem_org_id=10 rls_off=0`, `policies=162`.

## 1. Comandos e baseline N0 (§6.1)

Bateria executada na árvore limpa `git worktree add DeskcommCRM-n0 c85f7d7` (para não medir os arquivos da F00), com `WHATSAPP_MODE=mock AI_PROVIDER=mock CI=1 NODE_OPTIONS=--max-old-space-size=4096`. Sem `NODE_OPTIONS`, `pnpm typecheck` morre com `FatalProcessOutOfMemory` (exit 134) nesta máquina — registrado, não é bug do repo.

Retomada em 2026-09-07 (sessão de fechamento da F00). Ambiente extra que a bateria exigiu, tudo registrado: teto de concorrência do vitest (`VITEST_MAX_THREADS=2 VITEST_MAX_FORKS=2` — sem teto o OOM-killer da VPS de 7,9 GB derruba a suíte), swapfile de 2 GB criado (`/swapfile`, sem entrada no fstab), Chromium do Playwright instalado (`pnpm exec playwright install chromium`, 25s) mais 71 pacotes de sistema (`playwright install-deps chromium --dry-run` → `apt-get install --no-install-recommends`; sem eles, 201 specs morriam em `libatk-1.0.so.0: cannot open shared object file`), `.env.e2e` gerado por `pnpm e2e:env` (4s) contra o Supabase local, e `E2E_PORT=3101` (a porta default 3001 está ocupada por um `next-server` de outro serviço desta VPS).

| Passo | Comando real | Exit | Duração | Passados/Total | Falhados | Pulados |
|---|---|---|---|---|---|---|
| 1 | `pnpm typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`) | 0 | 36s | — | — | — |
| 2 | `pnpm lint` (`eslint .`) | 0 | 161s | 0 errors, 310 warnings | — | — |
| 3 | `pnpm test:unit` (`vitest run`) | 0 | 1116s | 7502/7503 | 0 (1 expected fail) | 0 |
| 4 | `pnpm test:db` (`bash scripts/test-db.sh`) | 0 | 421s | 1236/1238 | 0 (1 expected fail) | 1 |
| 4b | `pnpm test:integration` | — | — | n/a — script não existe no `package.json` @ c85f7d7 (a F03 cria) | — | — |
| 5 | `pnpm test:e2e` (`playwright test`) | 1 | 3462s | 259/290 | 11 | 8 skipped + 12 did not run |
| 6 | `pnpm build` (`next build`) | 0 | 98s | — | — | — |

**N0 = 8997 @ c85f7d72** (soma dos verdes dos passos 3–5: 7502 unit + 1236 db + 259 e2e).

Passo 5, os cinco itens da §6.1 para o que não passou (o comando RODOU; 11 specs falharam por ambiente):
- **O que tentou:** a suíte inteira (290 testes, `workers:1`) contra `next start` na 3101 + Supabase local via CLI, seeds próprios da suíte.
- **Por que falhou:** 11 specs dependem de serviço/estado que este ambiente não tem — fluxos de e-mail real (signup-journey, password-recovery, reset-password-mfa, cadastro-sem-confirmação), provedores de IA configurados (prova-painel-provedores ×2, central-de-avisos-capacidades ×2), instalação fresca com dono `dono@qa.local` (vps-fresh-onboarding aborta de propósito para não apagar dados de organização errada), consentimento Google (agenda-google-volta-não-desloga) e funil com semanas de uso (qa-selo-no-funil-usado). Os 12 `did not run` são specs seriais atrás do aborto do vps-fresh-onboarding.
- **O que era necessário:** captura de e-mail (Inbucket exposto à suíte), chaves de provedores de IA, uma instalação fresca dedicada e credencial Google de teste.
- **Alternativa:** nenhuma tentada — baseline mede o herdado como está; configurar esses serviços mudaria o ambiente no meio da régua.
- **Impacto:** o teto de e2e comparável nesta VPS é 259, não 290; comparações futuras de N0 usam 259 como referência de e2e enquanto o ambiente for este.

### Saída literal — typecheck (últimas 40 linhas)
```

> deskcomm-crm@0.1.0 typecheck /home/klarosk/projetos/DeskcommCRM-n0
> tsc --noEmit -p tsconfig.typecheck.json

```

### Saída literal — lint (últimas 40 linhas)
```

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/cron-contact-phones.test.ts
  77:34  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/desfecho-de-agenda-e-sobre-o-passado.test.ts
  46:38  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/editor-de-agente-salva-o-cadastro.test.tsx
  335:45  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/followup-canal-arquivado.test.ts
  120:26  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/handoff-stage-move.test.ts
  10:25  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/instrumento-e-pre-voo-do-canal.test.ts
  3:44  warning  'vi' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/inventario-de-telas.test.ts
  86:10  warning  'secoesNoArquivoBruto' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/lgpd-varredura-completa-a-cascata.test.ts
  69:7  warning  'CONTATO' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/mcp-agendamento-tools.test.ts
  32:38  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/o-fluxo-publicado-nao-abre-vazio.test.ts
  1:32  warning  'vi' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/o-seam-higieniza-o-uuid-do-modelo.test.ts
  40:38  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

/home/klarosk/projetos/DeskcommCRM-n0/tests/unit/require-role-mfa.test.ts
  22:44  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

✖ 310 problems (0 errors, 310 warnings)
  0 errors and 8 warnings potentially fixable with the `--fix` option.

```

### Saída literal — test:unit (últimas 40 linhas)
```

> deskcomm-crm@0.1.0 test:unit /home/klarosk/projetos/DeskcommCRM-n0
> vitest run

(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /home/klarosk/projetos/DeskcommCRM-n0

Not implemented: navigation to another Document
{"ts":"2026-09-07T05:41:28.710Z","level":"warn","msg":"watchdog: redrive com erro transiente — mantida queued","message_id":"message-test","error":"banco indisponível"}

 Test Files  692 passed (692)
      Tests  7502 passed | 1 expected fail (7503)
   Start at  02:26:59
   Duration  1114.19s (transform 17.86s, setup 108.78s, import 190.67s, tests 113.95s, environment 569.49s)

```

### Saída literal — test:db (últimas 40 linhas)
```
psql:<stdin>:2: ERROR:  permission denied for table ad_platform_connections
psql:<stdin>:2: ERROR:  permission denied for table ad_platform_connections
psql:<stdin>:2: ERROR:  permission denied for table ad_conversion_dispatches
psql:<stdin>:2: ERROR:  permission denied for table ad_conversion_dispatches
psql:<stdin>:2: ERROR:  permission denied for table ad_insights_connections
psql:<stdin>:2: ERROR:  permission denied for table ad_insights_connections
psql:<stdin>:4: ERROR:  caller_not_authorized_for_org
HINT:  emit_event: caller must be an active member of the organization
CONTEXT:  PL/pgSQL function emit_event(text,text,uuid,jsonb,jsonb,uuid) line 19 at RAISE
psql:<stdin>:4: ERROR:  caller_not_authorized_for_org
HINT:  retrieve_top_k_chunks: caller must be an active member of the organization
CONTEXT:  PL/pgSQL function retrieve_top_k_chunks(uuid,uuid,vector,integer,real) line 5 at RAISE
psql:<stdin>:1: ERROR:  new row for relation "system_version" violates check constraint "system_version_id_check"
DETAIL:  Failing row contains (2, , , f, , , null, null, null, 2026-09-07 05:51:28.271199+00, f, t).
psql:<stdin>:1: ERROR:  duplicate key value violates unique constraint "uniq_system_update_runs_dispatched"
DETAIL:  Key (status)=(dispatched) already exists.
psql:<stdin>:7: ERROR:  new row violates row-level security policy for table "webhook_sources"
psql:<stdin>:5: ERROR:  new row violates row-level security policy for table "automation_rule_runs"
{"ts":"2026-09-07T05:51:43.282Z","level":"warn","msg":"watchdog: espelho de sessão reconciliado com o WAHA real","channel_session_id":"bbbbbbbb-0000-4000-8000-000000000003","waha_session":"watchdog-proof-session","status":"WORKING"}
{"ts":"2026-09-07T05:51:43.302Z","level":"warn","msg":"watchdog: espelho de sessão reconciliado com o WAHA real","channel_session_id":"bbbbbbbb-0000-4000-8000-000000000006","waha_session":"watchdog-stopped-session","status":"STARTING"}
{"ts":"2026-09-07T05:51:43.315Z","level":"info","msg":"watchdog: mensagem presa reenviada","message_id":"bbbbbbbb-0000-4000-8000-000000000005","has_external_id":true}
{"ts":"2026-09-07T05:51:43.333Z","level":"info","msg":"watchdog: mensagem presa reenviada","message_id":"bbbbbbbb-0000-4000-8000-000000000005","has_external_id":true}
{"ts":"2026-09-07T05:51:43.342Z","level":"info","msg":"watchdog: reenvio bloqueado pelo modo de teste","message_id":"bbbbbbbb-0000-4000-8000-000000000005"}
psql:<stdin>:1: ERROR:  duplicate key value violates unique constraint "idx_followup_enrollments_one_live"
DETAIL:  Key (organization_id, contact_id)=(cccccccc-0000-4000-8000-000000000001, dddddddd-3333-4000-8000-0000000000c1) already exists.
psql:<stdin>:1: ERROR:  new row for relation "contacts" violates check constraint "contacts_custom_fields_object"
DETAIL:  Failing row contains (0206cf00-2222-4000-8000-000000000003, 0206cf00-0000-4000-8000-00000000000a, Ana Souza Lima, null, null, null, null, null, null, null, f, null, null, f, null, null, null, {"marketing": {"source": null, "version": null, "granted_at": nu..., {}, manual, {}, 2026-09-07 05:52:02.866935+00, 2026-09-07 05:52:04.477544+00, null, null, f, null, null, null, null, null, null, null, null, []).
psql:<stdin>:2: ERROR:  permission denied for table platform_google_oauth
psql:<stdin>:2: ERROR:  permission denied for table platform_google_oauth
psql:<stdin>:2: ERROR:  permission denied for table platform_google_oauth
psql:<stdin>:1: ERROR:  new row for relation "platform_google_oauth" violates check constraint "platform_google_oauth_singleton"
DETAIL:  Failing row contains (2, segunda, null, 2026-09-07 05:52:08.417302+00, null).

 Test Files  156 passed (156)
      Tests  1236 passed | 1 expected fail | 1 skipped (1238)
   Start at  02:45:43
   Duration  411.59s (transform 5.52s, setup 45.32s, import 16.32s, tests 321.78s, environment 20ms)

==> test:db verde
==> teardown: removendo container deskcomm-test-db-332622
```

### Saída literal — test:e2e (últimas 40 linhas)
```
    Error: esta suite APAGA dados da organizacao que resolver aqui, e nao achou o dono (dono@qa.local). Sem saber em quem mexer, ela para — escolher "a primeira" ja custou o onboarding e a sessao de WhatsApp de uma instalacao real.

      60 |   const dono = users?.users.find((u) => u.email === OWNER_EMAIL);
      61 |   if (!dono) {
    > 62 |     throw new Error(
         |           ^
      63 |       `esta suite APAGA dados da organizacao que resolver aqui, e nao achou o dono ` +
      64 |         `(${OWNER_EMAIL}). Sem saber em quem mexer, ela para — escolher "a primeira" ` +
      65 |         `ja custou o onboarding e a sessao de WhatsApp de uma instalacao real.`,
        at orgRow (/home/klarosk/projetos/DeskcommCRM-n0/tests/e2e/vps-fresh-onboarding.spec.ts:62:11)
        at /home/klarosk/projetos/DeskcommCRM-n0/tests/e2e/vps-fresh-onboarding.spec.ts:105:17

    Error Context: test-results/vps-fresh-onboarding-J1-—--74108--→-mensagem-clara-sem-stack-chromium/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/vps-fresh-onboarding-J1-—--74108--→-mensagem-clara-sem-stack-chromium/trace.zip
    Usage:

        pnpm exec playwright show-trace test-results/vps-fresh-onboarding-J1-—--74108--→-mensagem-clara-sem-stack-chromium/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  Slow test file: [chromium] › tests/e2e/navegacao.spec.ts (5.3m)
  Consider running tests from slow files in parallel. See: https://playwright.dev/docs/test-parallel
  11 failed
    [chromium] › tests/e2e/agenda-google-volta-nao-desloga.spec.ts:97:5 › voltar do consentimento não manda a pessoa para o /login 
    [chromium] › tests/e2e/cadastro-sem-confirmacao-de-email.spec.ts:98:5 › ⭐ o cadastro não manda esperar um e-mail que não vai chegar 
    [chromium] › tests/e2e/central-de-avisos-capacidades.spec.ts:57:7 › Central de avisos — o atendimento que saiu sem as ferramentas › o aviso aparece, em português de gente, com o motivo técnico junto 
    [chromium] › tests/e2e/central-de-avisos-capacidades.spec.ts:100:7 › Central de avisos — o atendimento que saiu sem as ferramentas › o aviso é acionável: dá para resolver e ele sai da lista de abertos 
    [chromium] › tests/e2e/password-recovery.spec.ts:65:5 › recuperar senha: forgot → e-mail → nova senha → login com a nova 
    [chromium] › tests/e2e/prova-painel-provedores.spec.ts:104:5 › F3 — a OpenRouter é oferecida e seus modelos estão no seletor 
    [chromium] › tests/e2e/prova-painel-provedores.spec.ts:122:5 › F1 — trocar o modelo GRAVA, e a tela passa a mostrar o novo 
    [chromium] › tests/e2e/qa-selo-no-funil-usado.spec.ts:52:7 › QA — o selo de autoria com o funil já vivido › quantos selos o dono vê depois de algumas semanas de uso 
    [chromium] › tests/e2e/reset-password-mfa.spec.ts:50:5 › reset de senha com MFA pede o código TOTP e conclui 
    [chromium] › tests/e2e/signup-journey.spec.ts:17:5 › criar conta: signup → e-mail de confirmação → onboarding → re-login 
    [chromium] › tests/e2e/vps-fresh-onboarding.spec.ts:142:7 › J1 — onboarding do dono numa instalação fresca › J1.2 senha errada → mensagem clara, sem stack 
  8 skipped
  12 did not run
  259 passed (57.7m)
 ELIFECYCLE  Command failed with exit code 1.
```

### Saída literal — build (últimas 40 linhas)
```
├ ƒ /app/settings/tenant
├ ƒ /app/settings/tenant/agenda
├ ƒ /app/settings/tenant/pipelines
├ ƒ /app/settings/tenant/whatsapp
├ ƒ /app/tasks
├ ƒ /app/team
├ ƒ /app/team/invite
├ ƒ /app/templates
├ ƒ /app/webhooks
├ ƒ /auth/confirm
├ ƒ /design
├ ƒ /get-started
├ ƒ /icon
├ ƒ /legal/privacy
├ ƒ /legal/terms
├ ƒ /login
├ ƒ /login/forgot
├ ƒ /login/mfa
├ ƒ /login/recovery
├ ƒ /login/reset
├ ○ /manifest.webmanifest
├ ƒ /onboarding
├ ƒ /onboarding/connect-nuvemshop
├ ƒ /onboarding/connect-whatsapp
├ ƒ /onboarding/done
├ ƒ /onboarding/funil
├ ƒ /onboarding/invite-team
├ ƒ /onboarding/setup-ai
├ ƒ /onboarding/testar
├ ƒ /onboarding/welcome
├ ƒ /signup
├ ƒ /team/accept-invite/[token]
└ ƒ /vitrine-agenda


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

```

`.skip`/`.only` (contados, não removidos): 15 ocorrências de `.skip(` e 0 de `.only(` em `tests lib app components hooks workers` (`grep -rnE "\.(skip|only)\("`); lista na seção 5.

## 2. Matriz de auditoria (§6.2) — resumo

Classes por módulo, uma por linha; evidência e risco resumidos, detalhe nas seções 2.1–2.4 (relatórios por lote). Contagem: **`reutilizar=6 adaptar=13 refazer=2 criar=3 remover=1`** (25 linhas = 18 módulos da §5 + 7 do Deskcomm sem correspondente).

| módulo (§5) | classe | evidência (arquivo:linha @ c85f7d7) | risco | o que muda na Fase 1 |
|---|---|---|---|---|
| 5.1 TenantContext | ADAPTAR | sem módulo; `createAdminClient` em 135/237 `app/api/**/route.ts`; `withTenant`/`set_config('app.organization_id')` = 0; webhook desconhecido → 404 (`app/api/v1/webhooks/waha/[token]/route.ts:101-103`); 4º ponto de entrada em `lib/mcp/auth.ts:93-124` | REUTILIZAR deixa 135 handlers sem prova; REFAZER descarta membership e HMAC testados | F01-T01/T02: `src/tenant-context/`, função SQL que lê GUC ou JWT, `fromApiToken` |
| 5.2 TenantConfiguration | ADAPTAR | `organizations.settings jsonb` (`baseline.sql:1737`) com 6 escritores próprios; `timezone/locale` são colunas; nenhuma chave `ai.*`, `business.*`, `orders.*` | duas fontes para `branding`/`timezone` | F01-T05: `tenant_settings` + `schema.ts`; escritores passam por `setSetting` |
| 5.3 Entitlement | ADAPTAR | `llm_calls` (`baseline.sql:6630`), `ai_budgets` (`:1030`) + trigger; `lib/ai/pricing.ts:15-19` só 3 prefixos Claude → OpenAI grava `cost_cents=null`; `lib/ai/embed.ts:59` não grava uso | budget não mede com modelo OpenAI | F01-T08: `ai_usage_events`, `withEntitlement`, `pricing.ts` por modelo |
| 5.4 Identity & RBAC | ADAPTAR | CHECK 4 papéis (`baseline.sql:1844`) + `platform_admins` (`:1768`); TS tem 5 (`lib/auth/types.ts:22`); `requireRole` (`lib/auth/require-role.ts:52`) em 155/235 rotas; 21 rotas de usuário sem ele; `role ===` = 8 | REFAZER perde gate de MFA e testes | F01-T07 (ADR-003): matriz D15 traduzida para `admin`/`agent` |
| 5.5 CRM Core | ADAPTAR | `contacts` (`baseline.sql:1324`), `catalog_products` (migration 0204), `crm_tasks` (0210), `crm_lead_activities` (`:1405`); `orders` (`:1696-1717`) é espelho de e-commerce com 0 escritores; sem `companies`/`order_items`; sem parser de quantidade | lembrete PJ sem pedido válido | F02-T01…T09; `orders` refeita (seção 2.4, sete respostas) |
| 5.6 Conversation | ADAPTAR | CHECK `status` com 7 valores mistos (`baseline.sql:1394`, :1401 "future migration may consolidate"); `status` escrito por 8 caminhos; sem `transition()`; "quem manda" derivado em `lib/inbox/comando-da-conversa.ts:1-30` | RPCs gravando `claimed`/`pending` | F03-T01/T05/T09: 8 estados D16, migração de dados |
| 5.7 Channel Adapter | ADAPTAR | `ChannelAdapter` só de saída (`lib/channels/types.ts:150`, 3 adapters); entrada em `lib/waha/ingest.ts:1065-1089`; HMAC fail-open por default (`lib/env.ts:152`, `lib/waha/webhook-auth.ts:72-73`); `senderPn` = 0 ocorrências; sem mock, sem `tests/fixtures/waha/`; WAHA `latest-2026.7.2` Core/NOWEB | webhook aceita payload sem assinatura | F03-T02/T03/T04/T06/T07 |
| 5.8 Action Policy | CRIAR | `TOOL_CATALOG` 60 entradas só com `risco` (`lib/mcp/tools/catalogo/index.ts:30-40`); 12 tools nativas fora do catálogo (`inbound-turn.ts:148`); sem `pending_actions`; auditoria só do MCP | `create_order` por IA executa sem confirmação | F03-T06, F04-T01/T02, F06-T03 |
| 5.9 AI Agent | REFAZER | `lib/agent-engine/agent/inbound-turn.ts` = 3.391 linhas; 2º stack `workers/ai-response-worker.ts:75` escolhido por `AGENT_DISPATCH_CONSUMER` (`lib/env.ts:183`); sem `confidence`; injeção só advisória; mock só em teste (`providers.ts:126`) | dois consumidores de turno | F04-T03…T08; reaproveita `run-model-call.ts` + `providers.ts` |
| 5.10 Knowledge/RAG | ADAPTAR | `ai_chunks.embedding vector(1536)` (`baseline.sql:1058`); `lib/ai/embeddings/chave.ts:58-59`; RPC filtra org (`baseline.sql:16644`); `workers/rag-indexer.ts:498`; `ai_knowledge_sources.agent_id NOT NULL` (`:1113`) | acervo amarrado ao agente | F04-T04/T05 (ADR-002) |
| 5.11 Handoff | REFAZER | sem tabela `handoffs`; motivo `z.string().max(500)` (`human-handoff.ts:236`); silêncio via `bot_silenced_until` (`inbound-turn.ts:1314`) | teste de 8 motivos passa por string | F05-T01…T04; preserva o silêncio |
| 5.12 Recurring Reminder | CRIAR | 3 motores sem `(org, cliente, período)`: `automation_rules` (0038), `followup_enrollments` unique-vivo (0064:40-42), `silence-sweep.ts:91`; peças reutilizáveis `job_queue`, `send_ledger`, `cron_jobs.tz` | follow-up engole lembretes (skip 23505) | F05-T05…T08 |
| 5.13 Workers & Jobs | ADAPTAR | `event_log` (`baseline.sql:1522-1539`, sem unique) + `job_queue` (`:6473`) com retries diferentes (`drain.ts:16`, `queue.ts:298`); sem `--once`; 21 crons (`docker/scheduler/entrypoint.sh:59-85`) | 3 invariantes §5.13 vermelhos | F03-T08, F05-T08 (ADR na F03: bus × Job) |
| 5.14 API | REUTILIZAR | `lib/api/wrappers.ts:51,66`, `lib/api/errors.ts:10`; 224/235 rotas com wrapper; cursor em 20 arquivos; `organization_id` de body/query = 0; `tenant_id` de query em 5 rotas admin | 5 rotas admin no teste de F02-T04 | F02-T04 |
| 5.15 Banco/RLS/migrations | ADAPTAR | 201 migrations, cadeia não sobe do zero (`MANIFEST.md:36-40`); `baseline.sql` 18.422 linhas; policy típica `baseline.sql:4371`; isolamento em `tests/invariants/rls-isolation.test.ts:47-88` (15 tabelas, 73 em `DEBITO_CONHECIDO`); 49 tabelas com grant a `anon` | 73 tabelas sem prova | F01-T03/T04, F02-T01 |
| 5.16 Notificações | CRIAR | sem `notifications`; `agent_inbox_items` (`baseline.sql:6453`) é aviso da org, 18 kinds; Web Push servidor existe (`push.handler.ts:10`); Resend só convite/LGPD | grep do invariante inalcançável | F05-T02/T03 |
| 5.17 Observabilidade | ADAPTAR | `api_audit_log` (`baseline.sql:1234-1249`) sem `actor_type/risk/result`; motor não escreve nela; Sentry denylist (`lib/sentry/scrub.ts:153`); health sem contadores (`route.ts:265-303`) | `actor_type=ai` = nº de `execute()` impossível | F04-T01, F06-T04 |
| 5.18 Segurança/LGPD | ADAPTAR | `lib/env.ts` Zod + `process.env` em 44 arquivos; rate limit sem cobrir WAHA/Meta; LGPD completa (`export-collector.ts:255`, `redact-cascade.ts:39`); SSRF em `lib/automation/outbound-url.ts:18`; scanner de segredos inexistente | webhook público sem rate limit | F01-T09/T10, F06-T02/T03 |
| MCP server | REUTILIZAR sem tocar | `app/api/mcp/route.ts`, `lib/mcp/` 39 arquivos; 16 `.eq("organization_id")` | grep de F01-T01 reprova sem ADR de exclusão | ADR na F01-T01 |
| Instalador/self-host | REUTILIZAR | `docker-compose.prod.yml:14-227`, `entrypoint.sh:60-84`, `scripts/bootstrap-owner.ts`, `hostgator-setup-kit/` | 21 crons por minuto no piloto | F06-T06 (compose de staging) |
| White-label | ADAPTAR | `lib/branding/resolve.ts:316,494`; `marcaDaOrganizacaoSchema` sem `logo_url` (`settings.ts:218-226`) | D28 exige logo | F02-T08 |
| Nuvemshop | REMOVER | `lib/nuvemshop/` 4 arq., 5 rotas, `tenant_integrations` (`:1807`), `orders`/`nuvemshop_products` sem escritores, 0 testes diretos; sete respostas na seção 2.4 | ocupa o nome `orders`; 2 `security definer` expostas a `anon` | F02-T01 |
| LGPD | REUTILIZAR | 7 rotas, 2 workers, 3 crons, 17 testes | — | F06-T03 usa a cascata |
| Flywheel | REUTILIZAR sem tocar | `flywheel/live.ts:1-6`, `FLYWHEEL_INTERVAL_MS` (`env.ts:195-198`, 0 = OFF) | ligado chama IA fora de `withEntitlement` | fica OFF |
| Onboarding wizard | REUTILIZAR sem tocar | 9 páginas; `onboarded_at` (`baseline.sql:1740`) + redirect (`app/app/layout.tsx:51`) | tenant seedado cai no wizard | F01-T06 grava `onboarded_at` |

Achados transversais que mudam a Fase 1 (detalhe nos relatórios): (1) não existe `withTenant` nem propagação por GUC — as 155 policies leem só o JWT, então a função de tenant vem antes do `withTenant`; (2) dois stacks de IA e duas filas coexistem — cada par exige ADR antes da F03/F04; (3) o schema vive no `baseline.sql`, não na cadeia de migrations; (4) modo mock de WhatsApp, fixtures, quarentena e `senderPn` não existem; (5) `orders` é tabela morta com o nome canônico e a Nuvemshop sai.

### 2.1 Lote A — Tenancy, RBAC, Banco/RLS, Segurança/LGPD (relatório integral)


Repositório: `/home/klarosk/projetos/DeskcommCRM`, branch `v2`.
HEAD real no momento da leitura: `55826722` ("chore(v2): pacote de partida da DIRETRIZ v2"), 1 commit acima de `c85f7d7`. `git diff --stat c85f7d7..HEAD` toca só `AGENTS.md`, `BUILD-STATE.md`, `docs/**`, `scripts/.gitkeep` — nenhum arquivo de produto. Todas as citações abaixo são `arquivo:linha @ c85f7d7` e foram verificadas por Grep/Read/sed neste clone. Somente leitura; nada foi executado (`pnpm`/`docker`) — as contagens são de `grep`/`find`/`wc`, não de runner.

Scripts de teste reais (`package.json:21-28 @ c85f7d7`): `test:unit` = `vitest run` (raiz, exclui `tests/e2e/**`); `test:db` = `test:invariants` = `bash scripts/test-db.sh` (Postgres efêmero `pgvector/pgvector:pg15`, aplica `supabase/baseline.sql` em modo install e update, roda `tests/invariants/**/*.test.ts` via `vitest.db.config.ts:10`); `test:e2e` = `playwright test`; `gov:verify` = `typecheck && lint && lint:channels && lint:role-rank && test:unit` (`package.json:33`).

---

#### §5.1 TenantContext (D20)

##### 1. O que existe

**Não existe módulo TenantContext.** A resolução de `organization_id` está espalhada por quatro caminhos distintos, cada um correto em si, sem envelope comum.

| Ponto de entrada | Como resolve hoje | Evidência @ c85f7d7 |
|---|---|---|
| Sessão (UI e `/api/v1`) | `loadAuthUser()` valida JWT via `supabase.auth.getUser()`, lê `platform_admins` e `user_organizations` **com o client RLS-scoped** (cookie), ordena memberships por `accepted_at, organization_id`; `resolveActiveOrg()` escolhe cookie `active_org` se for membership válida, senão `memberships[0]` | `lib/auth/server.ts:104-109` (getUser), `:154-159` (platform_admins), `:176-182` (user_organizations), `:56-66` (`escolherMembroAtivo`), `:259-264` (`resolveActiveOrg`) |
| Rota `/api/v1` com papel | `requireRole(min)` → `loadAuthUser` + `resolveActiveOrg` + `rpc fn_user_role_in_org(org)` (role do banco, não do cookie) | `lib/auth/require-role.ts:52-96` |
| Webhook WAHA → org | Path token → `channel_sessions.webhook_path_token` → `organization_id` via **service role**; token desconhecido → **404** (não 202, sem quarentena); assinatura HMAC fail-closed | `app/api/v1/webhooks/waha/[token]/route.ts:80-103` (lookup), `:117-130` (`authenticateWahaWebhook`); rota legada sem token `app/api/v1/webhooks/waha/route.ts:77-87` |
| Worker/job (event_log) | `drainEventLog` seleciona `organization_id` da linha de `event_log`; handlers filtram `organization_id` "à mão" em cada query com service role | `lib/event-log/drain.ts:88`, `lib/event-log/dispatcher.ts:19` (`EventRow.organization_id: string`), `workers/ai-response-worker.ts:13-14,92`; DDL `event_log.organization_id uuid NOT NULL` em `supabase/baseline.sql:1524` |
| Cron | Bearer `INTERNAL_CRON_SECRET` **ou** `INTERNAL_SECRET` (aceita qualquer um; fail-closed se ambos vazios); cada rota itera "todas as orgs" com service role, sem elegibilidade por Setting | `app/api/v1/cron/event-log-drain/route.ts:29-42`; `app/api/v1/cron/followup-flow-worker/route.ts:20,39-41`; `app/api/v1/cron/data-retention/route.ts:240,288` (`organizationId: null` no audit) |
| MCP (bearer `dsk_…`) | SHA-256 do token → `api_tokens.organization_id` via service role | `lib/mcp/auth.ts:77-124` |

**`emit_event` aceita `p_organization_id DEFAULT NULL`** (`supabase/baseline.sql:69`); a coluna é NOT NULL, então o insert falha no banco, mas a rejeição não é medida (sem contador `tenant_ctx_rejected`).

**Service role — contagens (comando: `find app/api -name route.ts | wc -l`; `grep -rl "createAdminClient" app/api --include=route.ts | wc -l`; `grep -rn "createAdminClient(" app/api --include=route.ts | wc -l`):**

- `app/api/**/route.ts`: **237** arquivos (235 em `app/api/v1`).
- Arquivos que chamam `createAdminClient`: **135 / 237** (163 call sites).
- Em `app/api/v1`: 135 usam admin; **101 usam SÓ admin** (não importam `@/lib/supabase/server`); **77 usam `createAdminClient` E `requireRole`** — i.e., rotas de usuário final com service role, exatamente o que o próprio cabeçalho proíbe (`lib/supabase/admin.ts:14-16`: "Uso PROIBIDO: qualquer rota acionada por usuário final").
- `createAdminClient` é singleton que lê `env.SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts:24-27`).

**Onde `SUPABASE_SERVICE_ROLE_KEY` é lida** (`grep -rn SUPABASE_SERVICE_ROLE_KEY --include=*.ts …`), fora de testes e `scripts/`:
`lib/env.ts:71` (schema Zod), `lib/supabase/admin.ts:27`, `lib/audit/index.ts:19` (checa se está configurada), `lib/agent-engine/env.ts:22` (**segundo schema de env**), `lib/agent-engine/edge/crm/mcp-client.ts:35-38` (**segundo client service-role**, `createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)`), `workers/agent-worker/main.ts:517`, `app/api/v1/conversations/[id]/draft-reply/route.ts:77`. Mais ~60 leituras em `scripts/*.ts`, `tests/*.ts` e `hostgator-setup-kit/*.sh`.

**`withTenant` / `set_config('app.organization_id')`:** **não existe** (grep em `app lib workers supabase` = 0 ocorrências; `current_setting` só aparece em `supabase/migrations/20260718150000_0041_webhook_secret_encryption.sql:37,76` para `app.nuvemshop_oauth_key`, e `set_config('request.jwt.claims')` só em testes para simular JWT, ex. `tests/invariants/rls-isolation.test.ts:61`). Não há `webhook_quarantine` (grep `quarantine|quarentena` = 0 em `lib workers app/api`). Não há `forEachEligibleTenant`.

##### 2. Testes que cobrem

- `test:unit`: `lib/auth/require-role.test.ts` (9 casos), `tests/unit/rbac-matrix.test.ts`, `tests/unit/auth-falha-alto.test.ts`, `tests/unit/auth-getuser-erro-mudo.test.ts`, `app/api/v1/cron/agent-dispatcher/route.test.ts`, `lib/audit/service-role-configured.test.ts`.
- `test:db`: `tests/invariants/rls-isolation.test.ts`, `tests/invariants/mcp-nao-alcanca-outro-tenant.test.ts:113-157`, `tests/invariants/webhooks-inbound.test.ts`, `tests/invariants/webhooks-inbound-idempotency.test.ts`, `tests/invariants/event-log-drain.test.ts`, `tests/invariants/definer-valida-membership.test.ts`.
- `test:e2e`: `tests/e2e/rbac-roles.spec.ts`, `tests/e2e/relogio-http-cron-externo.spec.ts`, `tests/journeys/canais-baseline.spec.ts`.
- Nenhum teste prova: job sem `organization_id` rejeitado com contador; webhook desconhecido → 202 + quarentena; 2 elegíveis + 1 inelegível = 2 job runs.

##### 3. Classe: **ADAPTAR**

Justificativa: os quatro resolvedores existem, são fail-closed e vêm de fonte confiável (JWT/cookie validado contra membership, path token → `channel_sessions`, `event_log.organization_id NOT NULL`, bearer de cron), mas estão espalhados e sem envelope — o que a Fase 1 precisa é embrulhá-los numa interface única (`fromSession/fromWebhook/fromJob/forEachEligibleTenant/withTenant`), não reescrevê-los.
Risco: se for classificado REUTILIZAR, ficam 135 handlers com service role e filtro manual de `organization_id` — um `.eq("organization_id", …)` esquecido vaza tenant sem nenhum teste pegar; se for REFAZER, perde-se a lógica já provada de ordem de membership (`lib/auth/server.ts:162-182`) e do HMAC do WAHA.

##### 4. O que muda na Fase 1 (invariantes §5.1 não cumpridos)

- (1) `grep SUPABASE_SERVICE_ROLE_KEY` fora do módulo = **7 arquivos de produto + ~60 em scripts/tests** (meta: 0). Sem `withTenant`; 135 handlers constroem admin client direto.
- (2) Job sem `organization_id`: rejeitado só por NOT NULL no banco, sem contador `tenant_ctx_rejected`.
- (3) Webhook com token desconhecido responde **404** (`waha/[token]/route.ts:101-103`), não 202; sem `webhook_quarantine`.
- (4) Cron não itera por elegibilidade (`followup-flow-worker/route.ts:20` "roda pra todas as orgs"); sem `forEachEligibleTenant`.
- Propagação às policies é via `auth.uid()` (JWT), não via `set_config('app.organization_id')`.

---

#### §5.4 Identity & RBAC (D15)

##### 1. O que existe

**Membership:** `public.user_organizations` (`supabase/baseline.sql:1833-1845`), colunas `user_id, organization_id, role text NOT NULL, invited_by, invited_at, accepted_at, revoked_at`; CHECK literal:
`CONSTRAINT "user_organizations_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'agent'::"text", 'manager'::"text", 'admin'::"text"])))` (`baseline.sql:1844`).
**Platform admin é tabela, não valor de role:** `public.platform_admins(user_id, granted_by, scope ∈ {full, support_readonly}, mfa_required default true, revoked_at…)` (`baseline.sql:1768-1779`).

**Helpers SQL (SECURITY DEFINER, `search_path=public`):** `fn_is_platform_admin()` (`baseline.sql:312-319`), `fn_user_org_ids()` (`:788-795`), `fn_user_role_in_org(p_org)` (`:817-826`, lê `user_organizations … revoked_at is null`), `fn_role_at_least(p_org, p_min)` (`:664-680`, ranks viewer1<agent2<manager3<admin4).

**Tipo TS:** `Role = "viewer" | "agent" | "ai_operator" | "manager" | "admin"` (`lib/auth/types.ts:22`), `ROLE_RANK` (`:23-29`); `ai_operator` existe **só no token efêmero do agente**, nunca em `user_organizations` (`:6-9`); `PAPEIS_HUMANOS` (`:47`).

**Guardas:** `requireRole(min, opts)` (`lib/auth/require-role.ts:52-151`) — 401 sem user, 403 `forbidden_tenant`, role via `rpc fn_user_role_in_org` (`:88-91`), **gate de MFA de sessão** `mfaEmDivida()` antes do sucesso (`:110-130`), audit `authz.denied` (`:134-141`); `requirePlatformAdmin()` (`lib/auth/requirePlatformAdmin.ts:34-71`, exige `aal2` se `mfa_required`); `requireAuth()` (`lib/auth/server.ts:270-274`, redirect para páginas). Lint anti-"matriz advisória": `scripts/lint-role-rank.ts` (rodado por `gov:verify`, `package.json:33`).

**Matriz de permissões:** não existe como dado (`src/rbac/matrix.ts` ou similar = 0). A matriz é implícita no argumento `min` de cada rota e documentada só no teste `tests/unit/rbac-matrix.test.ts:2-11`.

**MFA:** TOTP opcional por padrão (decisão em `lib/auth/politica-mfa.ts:16-18`); `exigeCadastroDeMfa()` (`:67`), `empresaExigeMfa(settings)` (`:81`); platform admin exige `aal2` por `platform_admins.mfa_required`.

**Contagem de rotas (comandos):**
```
find app/api/v1 -name route.ts | wc -l                                  → 235
grep -rl "requireRole(" app/api/v1 --include=route.ts | wc -l           → 155
grep -rl "requirePlatformAdmin(" app/api/v1 --include=route.ts | wc -l  → 22
grep -rl "requireAuth(" app/api/v1 --include=route.ts | wc -l           → 2
grep -rL "requireRole(\|requireAuth(\|requirePlatformAdmin(" app/api/v1 --include=route.ts | wc -l → 56
```
Os 56 sem guarda de papel se decompõem em: 21 `/cron/*` + `/system/agent` (bearer secret na rota); 9 `/webhooks/*` (path token + HMAC); `/health`; 2 `/team/[user_id]*` (guardadas por `_shared.ts:30` → `requireRole("admin")`); `/integrations/nuvemshop/callback` (`verifyState`, `:38`); e **21 rotas de usuário final que chamam `loadAuthUser`/`resolveActiveOrg` ou `getUser()` direto, sem `requireRole`** — logo sem gate de MFA de sessão e sem audit `authz.denied` (ex.: `app/api/v1/conversations/route.ts`, `conversations/[id]/messages/route.ts`, `messages/[id]/media/route.ts`, `mcp/tools/route.ts`, `contacts/duplicates/route.ts`, `pipelines/[id]/board/route.ts`, `system/update/route.ts`).

`public-paths.ts` (`lib/auth/public-paths.ts:5-60`) é o equivalente de `public_routes.ts`, mas usado pelo `proxy.ts:32` (edge) — não há teste que enumere as rotas do App Router e cruze com ele.

**`role ===` fora de `lib/auth`** (`grep -rn "role ===" app lib components workers`, excluindo `.test.` e comentários): `app/api/v1/conversations/[id]/transfer/route.ts:71`, `app/api/v1/leads/bulk/route.ts:97`, `app/api/v1/team/[user_id]/_shared.ts:62`, `app/api/v1/team/[user_id]/revoke/route.ts:49`, `lib/automation/actions/assign-owner.ts:23`, `app/app/settings/security/page.tsx:56`, `app/app/integrations/nuvemshop/page.tsx:55`, `components/inbox/InboxFilters.tsx:43` (+ `lib/agent-engine/agent/prune-tool-results.ts:64,73`, que é `role` de mensagem LLM, não RBAC) → **8 ocorrências reais** (meta §5.4 inv. 3: 0).

##### 2. Testes que cobrem

- `test:unit`: `lib/auth/require-role.test.ts` (9 `it`), `lib/auth/politica-mfa.test.ts`, `lib/auth/public-paths.test.ts`, `tests/unit/rbac-matrix.test.ts` (403/200 por grupo de rota com handlers reais), `tests/unit/conversation-assignment.test.ts`.
- `test:db`: `tests/invariants/gov-1-rbac.test.ts:45-104` (ranks, auto-promoção bloqueada, viewer read-only), `gov-1-rbac-config-write.test.ts`, `gov-1b-team-manager-read.test.ts`, `agenda-rbac.test.ts`, `rbac-config-ia-canais.test.ts`, `camadas-de-seguranca-rbac.test.ts:58-108`, `catalogo-so-gestor-muda-preco.test.ts`, `definer-valida-membership.test.ts`, `gov-hardening-anon-definer.test.ts`.
- `test:e2e`: `tests/e2e/rbac-roles.spec.ts:103-147`, `mfa-opcional.spec.ts`, `reset-password-mfa.spec.ts`, `invite-lifecycle.spec.ts`.
- `gov:verify`: `scripts/lint-role-rank.ts`.

##### 3. Classe: **ADAPTAR**

Justificativa: `requireRole` já é gate único, resolve papel no banco pela mesma função que as policies usam e embute MFA + audit — falta só o mapa de papéis (4 humanos + tabela `platform_admins` → enum `{platform_admin, tenant_admin, attendant}` da D15, a registrar em ADR-003), a matriz como dado e a cobertura das 21 rotas que hoje passam ao largo.
Risco: se for REFAZER, perde-se o gate de MFA de sessão (`require-role.ts:98-130`) e os 9+ testes que o cercam; se for REUTILIZAR sem tocar, a Fase 1 herda 21 rotas sem `requireRole` e um enum de 4 papéis + `ai_operator` que não é o da diretriz.

##### 4. O que muda na Fase 1

- Inv. (1): 21 rotas `/api/v1` de usuário sem `requireRole` e sem lista `public_routes.ts` testada contra o App Router.
- Inv. (2): não há teste `rbac: roles=3 denied_expected=D denied_actual=D` com identidade declarada por caso.
- Inv. (3): `grep "role ==="` = 8 (meta 0).
- Enum: `{viewer, agent, manager, admin}` + `platform_admins` ≠ `{platform_admin, tenant_admin, attendant}`; `ai_operator` no tipo TS (`lib/auth/types.ts:22`) não tem correspondente na diretriz (Action Policy §5.8 assume o papel).
- Matriz: criar `src/rbac/matrix.ts` e `can(ctx, permission)`; hoje a matriz é o argumento `min` em 155 rotas.

---

#### §5.15 Banco, RLS e migrations

##### 1. O que existe

**Migrations:** `supabase/migrations/` = **201 arquivos `.sql`** + `MANIFEST.md` (`ls | wc -l` = 202 entradas): `00001_initial_schema.sql`, depois `20260428195354_0001_platform_base.sql` … `20260905160000_0218_configuracao_pre_go_live_atomica.sql`. `MANIFEST.md` tem 206 linhas de tabela (`grep -c "^| "`), uma por migration com versão/nome/descrição (`supabase/migrations/MANIFEST.md:47-60`). **Contrato herdado documentado no próprio MANIFEST (`:36-40`): a cadeia `migrations/` não sobe do zero** (0010 altera tabelas que os stubs 0001–0009 não criam; "21 aplicam, 80 falham"); **o caminho suportado de instalação é `supabase/baseline.sql`**.

**baseline.sql:** 18 422 linhas. Duas camadas: (a) dump `pg_dump` (identificadores entre aspas, maiúsculas) até ~linha 4 700; (b) apêndice de migrations reescritas em minúsculas e idempotentes (ex.: `-- ---- Configuração atômica do pré-go-live (migration 0218) ----` em `baseline.sql:17356`; policy guardada por `IF NOT EXISTS (… polname = 'idempotency_tenant' …)` em `:4114-4118`). Idempotência: 238 blocos `DO $$`, 728 `IF NOT EXISTS`, 49 guardas `polname =`. `scripts/test-db.sh` aplica o baseline **duas vezes** (install + update) com `ON_ERROR_STOP=1` — a segunda passada é a prova de idempotência.

**Contagens por grep case-insensitive (limite inferior; policies do apêndice são multilinha e o predicado não está na linha `create policy`):** `create table` = 119; `enable row level security` = 86; `create policy` = 155; policies cuja linha `create policy` já contém `fn_user_org_ids` = 38, `organization_id` = 42. A sub-matriz por `pg_policies` exigida em §6.2 precisa de consulta ao banco — não feita aqui (somente leitura, sem runner).

**Helper de RLS:** `fn_user_org_ids()` (`baseline.sql:788-795`):
```sql
select organization_id from public.user_organizations
where user_id = auth.uid() and revoked_at is null;
```
**Policy típica (contacts, `baseline.sql:4371`), literal:**
```sql
CREATE POLICY "tenant_isolation_contacts_all" ON "public"."contacts"
USING ((("organization_id" IN ( SELECT "public"."fn_user_org_ids"() AS "fn_user_org_ids")) OR "public"."fn_is_platform_admin"()))
WITH CHECK ((("organization_id" IN ( SELECT "public"."fn_user_org_ids"() AS "fn_user_org_ids")) OR "public"."fn_is_platform_admin"()));
```
Isola por `organization_id ∈ fn_user_org_ids()` (JWT `auth.uid()` → memberships), com bypass `fn_is_platform_admin()`. **Não** é `organization_id = current_organization_id()` e não lê `app.organization_id`. Tabelas globais: `organizations` (`orgs_select` `:4211`, `orgs_write_platform_admin` `:4219`), `user_organizations` (`user_orgs_select` `:4456`: `user_id = auth.uid() OR fn_role_at_least(org,'admin') OR fn_is_platform_admin()`), `platform_admins` (`platform_admins_self` `:4238`). Não há `tests/db/global_tables.txt`.

**Grants:** o dump traz **50 linhas `GRANT ALL ON TABLE … TO "anon"`** (primeira: `baseline.sql:4651` `ai_agents`); 61 `REVOKE … FROM anon` existem (funções e tabelas do apêndice), mas não há revoke para `ai_agents` e pares do dump. RLS ligada + `auth.uid()` nulo protege na prática, porém o invariante "grants de anon em tabelas de tenant = 0" não é cumprido nem medido. Não há marcação `service_only` no MANIFEST nem `_provas`/`tests/db/NNNN-provas.sql`.

**Prova de isolamento hoje:** `scripts/test-db.sh` sobe `pgvector/pgvector:pg15`, aplica baseline, cria banco-molde; `tests/db/banco-limpo-por-arquivo.ts:2-4` recria o banco por arquivo. **`tests/invariants/rls-isolation.test.ts` é o arquivo que cria 2 tenants**: `ORG_A`/`ORG_B` + `USER_A`/`USER_B` (`:47-52`), `seedOrg()` insere `auth.users`, `organizations`, `user_organizations(role='agent')`, `channel_sessions` (`:73-88`), simula JWT com `set role authenticated; set_config('request.jwt.claims', '{"sub":…}')` (`:58-63`), e para cada uma das **15 tabelas** de `TABLES` (`:236`) prova `user of org A reads 0 rows of org B` (`:277-282`), controle positivo (`:285`) e sanidade de seed com superuser (`:294`). Só direção A→B e só SELECT. Completude: `tests/invariants/rls-completude-varredura.test.ts` deriva tabelas tenant-aware do catálogo e aceita `PROVA_PROPRIA` (19 entradas, `:77`) ou `DEBITO_CONHECIDO` (**73 tabelas sem prova comportamental**, `:222`); `agenda-nenhuma-tabela-sem-rls.test.ts` idem para agenda. Provas de escrita cruzada existem pontualmente (`gov-1-rbac.test.ts:67`, `camadas-de-seguranca-rbac.test.ts:58-108`, `webhooks-rls.test.ts`, `historico-de-captacao-rls.test.ts`).

##### 2. Testes que cobrem

- `test:db` (todos em `tests/invariants/`): `rls-isolation.test.ts`, `rls-completude-varredura.test.ts`, `agenda-nenhuma-tabela-sem-rls.test.ts`, `agenda-rls.test.ts`, `webhooks-rls.test.ts`, `meta-templates-rls.test.ts`, `historico-de-captacao-rls.test.ts`, `definer-nova-nasce-exposta.test.ts`, `hardening-definer-varredura.test.ts`, `gov-hardening-anon-definer.test.ts:70`, `colunas-geradas-nao-sao-escritas.test.ts`, `on-conflict-aponta-para-constraint-real.test.ts`, `vocabulario-banco-x-typescript.test.ts`.
- `test:unit`: `tests/unit/baseline-no-piso-do-postgres.test.ts` (citado em `scripts/test-db.sh`), `tests/unit/env-ddl-fora-do-app.test.ts`.
- `test:shell`: `tests/shell/update-guard.test.sh`, `scripts/test-update-com-dados.sh`.
- CI: `.github/workflows/ci.yml:73-84` job `invariants`.

##### 3. Classe: **ADAPTAR**

Justificativa: baseline idempotente, MANIFEST, helper SECURITY DEFINER com `search_path` fixo, gate de duas passadas e prova comportamental com 2 tenants já existem e são o melhor ativo do repo; o que a §5.15 pede é mudar a **forma** do predicado (para aceitar `app.organization_id` além do JWT), zerar grants de anon, mover a allowlist para arquivo e trocar a lista manual de 15 tabelas por varredura de `pg_tables` com escrita cruzada nas duas direções.
Risco: se REUTILIZAR, 73 tabelas ficam em `DEBITO_CONHECIDO` sem prova de isolamento e o `withTenant` de §5.1 não tem como propagar tenant (policies só leem JWT); se REFAZER, jogam-se fora 201 migrations, 155 policies e ~15 arquivos de invariantes que já pegam regressões reais (ex.: policy sabotada `or true` em `org_guardrail_layers`, relatada em `rls-completude-varredura.test.ts:15-20`).

##### 4. O que muda na Fase 1

- Predicado: `organization_id IN (fn_user_org_ids())` → função única que lê claim **ou** `current_setting('app.organization_id')`; hoje 0 policies leem GUC.
- `tests/db/global_tables.txt` não existe; allowlist está em código (`PROVA_PROPRIA`/`DEBITO_CONHECIDO`).
- Prova imprime por tabela, não a linha `isolation: tables=K ops=4 dirs=2 leaks=0`; cobre 1 direção e 1 operação para 15 tabelas.
- `GRANT ALL … TO anon` = 50 linhas no dump (meta 0); sem contagem `tabelas com grant a authenticated sem policy`.
- Sem `service_only` no MANIFEST, sem `_provas`, sem `tests/db/NNNN-provas.sql`; migrations não terminam com `revoke/grant + select de verificação`.
- BUILD-STATE ainda não marca migration como `escrita/aplicada/verificada`.

---

#### §5.18 Segurança e LGPD

##### 1. O que existe

**Env:** `lib/env.ts` — Zod (`:10`), `schema = z.object({…})` (`:64`) com **57 chaves** (`grep -cE "^  [A-Z][A-Z0-9_]+:" lib/env.ts`), `safeParse` (`:345`), leniência só em `NEXT_PHASE=phase-production-build` (`:24,351-356`), falha no boot com `fieldErrors` (`:359-368`). **Mas não é o único `process.env`**: `grep -rl "process\.env\." app lib workers` (excl. testes e `lib/env.ts`) = **44 arquivos / 71 ocorrências**, e há um segundo schema Zod em `lib/agent-engine/env.ts:22`.

**Rate limit:** `lib/ai/dispatcher/rate-limit.ts:1-9` — janela fixa `INCR+EXPIRE` no Upstash Redis, fallback em memória com aviso (`:32`); `checkRateLimit`/`peekRateLimit`. Chamado em: `lib/auth/rate-limit.ts:89,94,170` (`authRateLimited`, `AUTH_LIMITS` `:136`) ← `app/actions/auth/signInWithPassword.ts:16`, `signUp.ts:14`, `recoverOrganization.ts:12`, `requestPasswordReset.ts:8`; `app/api/v1/webhooks/in/[token]/route.ts:73` (captação de lead, `webhook_in:<token>`); `app/api/v1/marca/logo/route.ts:372,469`. **Zero chamadas em `webhooks/waha/[token]`, `webhooks/meta/[token]`, `webhooks/channel/[token]`, `webhooks/nuvemshop/*`** (`grep -rn checkRateLimit app/api/v1/webhooks` = só `in/[token]`). `proxy.ts` não aplica rate limit.

**LGPD (rotas e guarda):** `app/api/v1/lgpd/requests/route.ts:47` GET (`requireRole("admin")` `:50`; `request_type ∈ {redact, data_request, store_redact}` `:24`); `lgpd/requests/[id]/route.ts:20-26`; `lgpd/requests/[id]/approve/route.ts:27-33` (admin; `data_request` → evento de export `:128-130`, redact → cascata); `lgpd/requests/[id]/preview/route.ts:26-32`; `lgpd/anonymize/route.ts:37,81` (admin na org do contato); `audit/export/route.ts:36-38` (manager); `admin/lgpd/requests/route.ts:81-86` (`requirePlatformAdmin`); `cron/lgpd-sla-watcher`, `cron/storage-redaction`; webhooks Nuvemshop `customer-data-request`, `customer-redact`, `store-redact`. Workers: `workers/lgpd-export-worker.ts` (+ `.handler.ts:11` key `lgpd-export-worker.v1`), `workers/lgpd-redact-worker.ts`. Lib: `lib/lgpd/` (13 arquivos: `export-collector.ts`, `redact-cascade.ts`, `cascata.ts`, `pades-signer.ts`, `pdf-renderer.tsx`, `sla.ts`, `storage-redaction-queue.ts`, `mask.ts`…). SQL: `fn_lgpd_cascade_redact_contact` (`baseline.sql:323`).

**Anti-SSRF:** outbound — `assertSafeOutboundUrl(url)` (`lib/automation/outbound-url.ts:18`, + `outbound-ip.ts`) chamado em `lib/automation/actions/call-webhook.ts:70` e `lib/channels/adapters/zernio.ts:337`; mídia — `lib/messaging/media/waha-source.ts:6-9,28-31` reconstrói o fetch sobre `WAHA_API_BASE_URL` usando só path+query do payload e lança `waha_media_untrusted_host`. Cobre WAHA; Meta usa `media_id` + Graph API (`:9-10`).

**Scanner de segredos: não existe.** `.github/workflows/ci.yml:37-84` = Typecheck, Lint, Channel provider leak, Unit tests, Kit self-host, RLS invariants; nenhum `gitleaks`/`trufflehog`/`secretlint`; sem `.husky`/pre-commit; nenhum script em `scripts/` varre padrões `sk-ant-|ghp_|PRIVATE KEY`; sem fixture negativa (G-51). O que existe de vizinho: `scripts/lint-channels.ts` (vazamento de nome de provedor), `tests/invariants/agent-no-credential.test.ts` (turno sem credencial falha limpo), `SECURITY.md`, `docs/threat-model.md`, `docs/alertas-de-seguranca-triados.md`.

##### 2. Testes que cobrem

- `test:unit`: `lib/auth/rate-limit.test.ts`, `lib/ai/dispatcher/rate-limit.test.ts`, `rate-limit-misconf.test.ts`, `app/actions/auth/signInWithPassword.test.ts`, `lib/automation/outbound-url.test.ts`, `lib/automation/actions/call-webhook.test.ts`, `tests/unit/lgpd-anonimizacao-retoma.test.ts`, `lgpd-exporta-o-que-redige.test.ts`, `lgpd-pdf-controlador.test.tsx`, `lgpd-redact-avatar.test.ts`, `lgpd-sla.test.ts`, `lgpd-varredura-completa-a-cascata.test.ts`, `tests/unit/env-example-sync.test.ts`, `env-ddl-fora-do-app.test.ts`, `import-puro-sem-env.test.ts`, `health-separa-env-errado-de-servico-caido.test.ts`, `lib/audit/service-role-configured.test.ts`.
- `test:db`: `tests/invariants/lgpd-alcanca-campos-personalizados-do-contato.test.ts`, `lgpd-avatar-anonimizacao.test.ts`, `lgpd-cascata-alcanca-quem-guarda-pessoa.test.ts`, `lgpd-tarefa-do-contato-anonimizado.test.ts`, `agenda-lgpd-alcanca.test.ts`, `contato-consent-e-auditoria.test.ts`, `retencao-poda-e-expurgo.test.ts`, `webhooks-secret-encryption.test.ts`, `credencial-*-e-server-side.test.ts`.
- `test:e2e`: `tests/e2e/vps-webhook-outbound-ssrf.spec.ts`, `zona-de-perigo-apaga-dados-de-teste.spec.ts`, `mfa-opcional.spec.ts`, `password-recovery.spec.ts`. (`tests/capture-lgpd-redact.ts` e `capture-lgpd-ensaio-tenant-b.ts` são scripts manuais de captura, não specs.)

##### 3. Classe: **ADAPTAR**

Justificativa: export/redação LGPD com cascata, SLA e PDF assinado, rate limit em login, anti-SSRF de mídia e de webhook outbound e validação Zod de env já existem com testes — falta fechar as bordas: rate limit nos webhooks de canal (WAHA/Meta), `process.env` concentrado num único arquivo e o scanner de segredos com fixture negativa (que é criação nova dentro deste módulo).
Risco: se REUTILIZAR, o webhook WAHA (rota pública em `public-paths.ts:12`) fica sem rate limit e 44 arquivos continuam lendo `process.env` fora do boot; se REFAZER, perde-se a cascata LGPD que 10+ testes de invariante verificam campo a campo.

##### 4. O que muda na Fase 1

- `process.env` em 44 arquivos fora de `lib/env.ts` (meta: só `src/config/env.ts`); segundo schema em `lib/agent-engine/env.ts`.
- Rate limit ausente em `webhooks/waha/[token]`, `webhooks/meta/[token]`, `webhooks/channel/[token]`; existe só em login/signup/reset e `webhooks/in`.
- Scanner de segredos: inexistente; criar varredura de `src/ scripts/ supabase/ workers/` com saída `secrets: files_scanned=F findings=0` e fixture negativa.
- SSRF de mídia: OK para WAHA por construção; a Fase 1 precisa provar com teste que o host vem só do Setting do provedor (hoje o teste de mídia é unitário, sem asserção explícita de host).
- Aceite escrito da Deka (D04) não tem lugar no BUILD-STATE ainda.

---

#### Tabela resumo

| módulo | classe | evidência principal (@ c85f7d7) | risco |
|---|---|---|---|
| §5.1 TenantContext | ADAPTAR | Sem módulo: `createAdminClient` em 135/237 `app/api/**/route.ts` (163 chamadas; 101 rotas v1 só com service role; 77 com service role + `requireRole`); `set_config('app.organization_id')`/`withTenant` = 0; webhook desconhecido → 404 em `webhooks/waha/[token]/route.ts:101-103`; cron "roda pra todas as orgs" `cron/followup-flow-worker/route.ts:20`; chave lida em 7 arquivos de produto (`lib/env.ts:71`, `lib/supabase/admin.ts:27`, `lib/agent-engine/edge/crm/mcp-client.ts:38`…) | REUTILIZAR deixa 135 handlers dependendo de `.eq("organization_id")` manual sem prova; REFAZER descarta membership ordenada e HMAC fail-closed já testados |
| §5.4 Identity & RBAC | ADAPTAR | `user_organizations.role CHECK ∈ {viewer,agent,manager,admin}` `baseline.sql:1844`; `platform_admins` `:1768`; `requireRole` `lib/auth/require-role.ts:52` com MFA `:110-130` em 155/235 rotas v1; 21 rotas de usuário sem `requireRole`; matriz só implícita; `role ===` = 8 | REFAZER perde o gate de MFA de sessão e 9+ testes; REUTILIZAR herda enum diferente da D15 e 21 rotas fora do gate |
| §5.15 Banco/RLS/migrations | ADAPTAR | 201 migrations + `MANIFEST.md` (cadeia não sobe do zero, `MANIFEST.md:36-40`); `baseline.sql` 18 422 linhas idempotente (238 `DO`, 728 `IF NOT EXISTS`); policy típica `baseline.sql:4371` `organization_id IN (fn_user_org_ids()) OR fn_is_platform_admin()` (USING = WITH CHECK); 2 tenants em `tests/invariants/rls-isolation.test.ts:47-88`, 15 tabelas `:236`, 73 em `DEBITO_CONHECIDO` (`rls-completude-varredura.test.ts:222`); 50 `GRANT ALL … TO anon` (`:4651`) | REUTILIZAR mantém 73 tabelas sem prova e policies que não leem `app.organization_id`; REFAZER descarta 155 policies e ~15 invariantes que pegam regressão real |
| §5.18 Segurança/LGPD | ADAPTAR | `lib/env.ts` Zod 57 chaves (`:64,345-368`) mas `process.env` em 44 outros arquivos; rate limit só login/`webhooks/in`/`marca/logo` (`lib/auth/rate-limit.ts:89`, `webhooks/in/[token]/route.ts:73`), 0 no WAHA; LGPD `lgpd/requests/[id]/approve/route.ts:27`, `lgpd/anonymize/route.ts:37`, workers `lgpd-export-worker`/`lgpd-redact-worker`; SSRF `lib/automation/outbound-url.ts:18`, `lib/messaging/media/waha-source.ts:28-31`; scanner de segredos inexistente (`ci.yml:37-84`) | REUTILIZAR deixa webhook público sem rate limit e sem scanner; REFAZER perde cascata LGPD verificada por 10+ invariantes |

### 2.2 Lote B — Conversation, Channel Adapter, Workers, Notificações (relatório integral)


- Repositório: `/home/klarosk/projetos/DeskcommCRM`, branch `v2`.
- HEAD do clone: `55826722` (= `c85f7d7` + 1 commit só de docs: `git diff --stat c85f7d7 HEAD` toca apenas `AGENTS.md`, `BUILD-STATE.md`, `docs/**`, `scripts/.gitkeep`). Toda citação de código abaixo é `arquivo:linha @ c85f7d7`; o conteúdo é idêntico no HEAD.
- Método: somente leitura (Read/Grep/sed/wc). Nenhum teste foi executado; a coluna "testes" lista arquivos e o script que os roda, não N/N observado.
- Scripts reais em `package.json`: `test:unit` = `vitest run` (:25, exclui `tests/e2e`, `tests/invariants`, `tests/journeys` — `vitest.config.ts:29-36`); `test:db` = `bash scripts/test-db.sh` (:26, Postgres efêmero `pgvector/pgvector:pg15` + `supabase/baseline.sql` 2× + `tests/invariants/**` — `vitest.db.config.ts:9`); `test:e2e` = `playwright test` (:21); `test:journeys` (:24); `test:shell` (:27). Contagem: 161 arquivos em `tests/invariants/`, 483 em `tests/unit/`.

---

#### 1. §5.6 Conversation (D16)

##### 1.1 O que existe

**Tabela `conversations`** — `supabase/baseline.sql:1365-1395 @ c85f7d7`. Colunas relevantes ao alvo (nome real → nome do §5.6):

| Real | §5.6 | Linha |
|---|---|---|
| `organization_id uuid not null` | `organization_id` | 1367 |
| `contact_id uuid not null` | `customer_id` | 1368 |
| `channel_session_id uuid not null` | `channel_account_id` | 1369 |
| `status text default 'open'` | `status` | 1371 |
| `status_changed_at` | — (útil para `entered_at` da guarda de timeout) | 1372 |
| `assigned_to_user_id uuid` | `assignee_id` | 1373 |
| `assigned_at` | — | 1374 |
| `last_inbound_at`, `last_outbound_at` | idem | 1375-1376 |
| `bot_silenced_until`, `last_handoff_at`, `last_handoff_reason` | (substituem o `handoff_id`) | 1385-1387 |
| `assignee_kind text check in ('user','ai')` (adicionada depois) | — | 5342-5344 |
| `tags` | **não existe** em `conversations` (existe em `contacts.tags` :1343) | — |
| `handoff_id` | **não existe** | — |

Unique `conversations_unique_per_contact_session (organization_id, contact_id, channel_session_id, group_chat_id)` :2181 — cumpre "uma conversa por cliente e canal" (com `is_group=false` no upsert :5134).

**CHECK de status hoje** — `conversations_status_check` `supabase/baseline.sql:1394`:
`open, pending, resolved, claimed, ai_handling, closed, archived` (7 valores). O comentário :1401 declara que a mistura é conhecida: *"Accepts both legacy (open/pending/resolved) + EPIC-03 spec (claimed/ai_handling/closed/archived). UI/API normalizes; future migration may consolidate."*
Alvo §5.6: `open, ai_handling, waiting_customer, waiting_confirmation, waiting_human, human_handling, resolved, archived` (8). Interseção: `open, ai_handling, resolved, archived` (4/8). `pending`, `claimed`, `closed` não existem no alvo; `waiting_customer`, `waiting_confirmation`, `waiting_human`, `human_handling` não existem hoje.

**Tabela `messages`** — `supabase/baseline.sql:1636-1667`:
`external_id` (:1642, = `provider_message_id`), `type` check :1666, `direction` check `inbound|outbound` :1663, `status` check `queued, received, sending, sent, delivered, read, failed` :1665, `sent_via` check `crm, external_device, automation, ai, user, system` :1664 (≈ `actor_type`), `body` :1649, `media_url/media_mime/media_size_bytes/media_storage_path` :1650-1653, `sent_at` :1656. Unique `messages_org_external_id_unique (organization_id, external_id) DEFERRABLE INITIALLY DEFERRED` :2301.

**Onde `status` de `conversations` é escrito** (contagem, não amostra — `grep -rnE "from\(['\"]conversations['\"]\)"` em `app lib workers components hooks` sem `.test.` = **73 sítios**; os que escrevem `status`):

| # | Sítio | Valor escrito | Linha @ c85f7d7 |
|---|---|---|---|
| 1 | `app/api/v1/conversations/[id]/close/route.ts` | `'closed'` | :69 |
| 2 | `app/api/v1/cron/snooze-watcher/route.ts` | `'open'` (reabre) | :80 |
| 3 | `lib/automation/start-conversation.ts` | `'open'` (update) e `'open'` (insert) | :63, :77 |
| 4 | `lib/ai/handoff/orchestrator.ts` | `'pending'` + `bot_silenced_until='infinity'` | :159-165 |
| 5 | `lib/escalacao/retomada.ts` | `'ai_handling'` ou o anterior (`STATUS_REATIVAVEIS`) | :133-143 |
| 6 | SQL `fn_conversation_assign(...)` — **5 redefinições** :5276, :5402, :5624, :13320, :16942; a vigente escreve `status = case when p_to_user_id is null then 'open' else 'claimed' end` | `'open'`/`'claimed'` | :16999 |
| 7 | SQL `fn_upsert_wa_conversation` (insert `'open'`) | `'open'` | :5128-5140 |
| 8 | SQL `fn_lgpd_cascade_redact_contact` (update em conversations) | — | :326, :384 |

Chamadores da RPC `fn_conversation_assign` (9): `app/api/v1/conversations/[id]/claim/route.ts:61`, `release/route.ts:40`, `transfer/route.ts:78`, `pause-ai/route.ts:99`, `app/api/v1/conversations/_handler.ts:416`, `lib/routing/worker.ts:170`, `lib/mcp/tools/handoff.ts:106`, `lib/mcp/tools/governance.ts:98`, `lib/escalacao/retomada.ts:116`.

**Máquina de transições central: não existe.** `grep -rniE "transition|state machine|allowedTransitions"` em `lib app workers` filtrado por "convers" = 0 linhas de produto (só `useTransition` do React). O que existe é o inverso: `lib/inbox/comando-da-conversa.ts:1-30` é uma **função pura de leitura** que deriva "quem manda" de sete fatos (`status`, `assigned_to_user_id`, `assignee_kind`, `bot_silenced_until`, `last_handoff_at/reason`, `contacts.force_human`, `contacts.is_blocked`), porque a coluna `status` sozinha não responde. `conversation_assignment_events` :5243-5253 (`reason in ('claim','transfer','release','routing','handoff')`) é auditoria de atribuição, não de transição.

##### 1.2 Testes que cobrem

- `test:unit`: `lib/inbox/comando-da-conversa.test.ts`, `tests/unit/conversation-assignment.test.ts`, `escalacao-retomada.test.ts`, `escalacao-expectativa.test.ts`, `handoff-orchestrator-elegibilidade.test.ts`, `messages-handler-silencio-ia-apos-humano.test.ts`, `silencio-infinito-cala-o-worker-legado.test.ts`, `inbox-aba-minhas-sem-fechadas.test.ts`, `sweep-nao-cobra-conversa-encerrada.test.ts`.
- `test:db`: `tests/invariants/comando-da-conversa-espelha-o-ts.test.ts` (5 casos; lê o domínio de `status` do CHECK via `pg_constraint` e confere que TS e SQL respondem igual), `gov-2-assignment.test.ts` (3), `gov-3-assignment-events.test.ts`, `gov-6-ai-handoff.test.ts`, `gov-6-assignee-kind.test.ts`, `gov-5d-queue-assign-unread.test.ts`, `escalacao-ciclo-humano.test.ts`, `handoff-avisa-o-lead.test.ts`, `relogio-do-silencio.test.ts`, `inbox-unread-outbound.test.ts`.
- `test:e2e`: `tests/e2e/inbox-quem-manda.spec.ts`, `queue-assign.spec.ts`, `escalacao-ciclo.spec.ts`, `inbox-scope.spec.ts`, `distribuicao-atendimento.spec.ts`.

##### 1.3 Classe proposta: **ADAPTAR**

Justificativa: as duas tabelas, o unique por cliente+canal, os agregados (`last_inbound_at/last_outbound_at`, `unread`, `fn_mark_conversation_message` :13068-13080) e o upsert atômico (`fn_upsert_wa_conversation` :5128) já são o que o §5.6 descreve, a menos de nomes (`contact_id`, `channel_session_id`, `assigned_to_user_id`, `external_id`); o que falta é **um** arquivo (`transitions.ts` + `transition()`) e a migração do CHECK de 7 para 8 valores, com os 8 sítios de escrita redirecionados.
Risco: se a classe fosse REUTILIZAR, o invariante (2) (`grep "status:" fora de src/conversation/` = 0) falha no dia 1 e as 5 redefinições de `fn_conversation_assign` continuam gravando `claimed`/`pending` — valores que o inbox novo não conhece; se fosse REFAZER, perdem-se o upsert atômico, as policies e ~15 arquivos de invariantes que hoje provam atribuição e silêncio.

##### 1.4 O que muda na Fase 1 (invariantes do §5.6 não cumpridos hoje)

- Inv. (1) 8 estados × 16 eventos: **não existe** tabela nem teste; nasce em **F03-T01**.
- Inv. (2) `status` só por `transition()`: hoje 8 caminhos de escrita (tabela acima) → **F03-T01** (código) + **F03-T09** (Inbox usa só `transition`).
- Inv. (3) IA não envia em `waiting_human`/`human_handling`: hoje a guarda é `bot_silenced_until`/`force_human`/`assignee_kind` (`lib/inbox/comando-da-conversa.ts:22-27`), não o estado → **F05-T04**.
- Migração do CHECK (7→8 valores) e mapeamento dos dados existentes (`pending`→`waiting_human`, `claimed`→`human_handling`, `closed`→`resolved`) — não tem task explícita; cabe em **F03-T01** ou **F01-T03** (migração herdada).
- `getOrCreateForCustomer`: reaproveita `fn_upsert_wa_conversation` :5128 → **F03-T05**.

---

#### 2. §5.7 Channel Adapter (WAHA, D04)

##### 2.1 O que existe

**Cliente WAHA** — `lib/waha/client.ts` (565 linhas): `class WahaClient` :129, header `X-Api-Key` :174, `getWahaClient()` :560 lê `process.env.WAHA_API_BASE_URL` / `WAHA_API_KEY` **direto** :561-562 (fora de `lib/env.ts`; conflita com §5.18 "único `process.env`"). Tetos: `TETO_PADRAO_MS = 15_000` :69, `TETO_DE_MIDIA_MS = 30_000` :83. `CONVERSAS_IGNORADAS` :46-55 (status, broadcast, channels, groups) é passado ao WAHA no start da sessão.
Helpers: `lib/waha/send.ts:48-56 resolveWahaChatId` (ordem `@lid` antes de `@c.us` — regra documentada :34-46), `lib/waha/message-id.ts:11 parseWahaMessageId` / `:37 bareWaMessageId` / `:61 chatIdFromWaMessageId` (assimetria NOWEB × WEBJS), `lib/waha/media-send.ts`, `lib/waha/resolve-contact-whatsapp-id.ts`.

**Contrato de adapter já existe** — `lib/channels/types.ts:150 interface ChannelAdapter` (`provider` :151, `resolveRecipient` :153, `send` :161, `codes` :167, métodos opcionais `resolvePhoneForIdentity` :212, `fetchMedia`, `sendTemplate` :295). **Três** implementações: `lib/channels/adapters/waha.ts:42 wahaAdapter`, `lib/channels/adapters/meta-cloud.ts` (235 linhas), `lib/channels/adapters/zernio.ts` (488). O adapter herdado cobre só a **saída**; a **entrada** (parse, assinatura, resolução de sessão) fica em `lib/waha/ingest.ts` (1089 linhas) + rotas. `lib/channels/inbound.ts:1-30` é um seam neutro de entrada, mas só para Zernio.

**Handler do webhook** — duas rotas:
- `app/api/v1/webhooks/waha/route.ts` (global; resolve `channel_sessions` por `body.session = waha_session_name` :72-93; não publicada pelo Caddy :28-30 do `webhook-auth.ts`).
- `app/api/v1/webhooks/waha/[token]/route.ts` (per-tenant por `webhook_path_token` :35-37; canônica).
Pipeline (rota global): `lerRoteamentoWaha` (Zod loose, só `session`+`payload.id`, `lib/waha/envelope.ts:128-132`) → lookup sessão :83-93 → auth :120 → **insert em `webhook_events_log`** :146-161 (raw_body, headers sem authorization/cookie, `valid_signature`) → `conferirContratoWaha` :164 (contrato completo `envelope.ts:106-110`) → `dispatchWahaEvent` :178. Exceção do dispatch é engolida e responde 200 :179-183.
Sessão desconhecida → **200** `{accepted:false, reason:"session_not_registered"}` :98-106 (alvo: 202 + `webhook_quarantine`).

**Verificação de assinatura** — `lib/waha/webhook-auth.ts:50-74 authenticateWahaWebhook` (HMAC SHA512 via `verifyHmacSha512`, `lib/waha/ingest.ts:250`; header `x-webhook-hmac`, `route.ts:109`). Segredo: por sessão (`channel_sessions.webhook_secret_encrypted` decifrado pela RPC `fn_decrypt_oauth`, `route.ts:112`) ou `WAHA_HMAC_SECRET` (`webhook-auth.ts:53`; `lib/env.ts:146` opcional, default `""`). **Fail-open por padrão**: `WAHA_WEBHOOK_REQUIRE_SIGNATURE` default `"false"` (`lib/env.ts:152`); sem header e sem exigência → aceito com `signatureVerified:false` (`webhook-auth.ts:72-73`). Motivo documentado :17-23: o WAHA **Core** 2026.7.2 não assina. Assinatura presente e errada → 401 + audit `webhook.hmac_invalid` (`route.ts:121-133`) — este invariante (2) já é cumprido.

**Sessão → organization_id** — tabela `channel_sessions` `supabase/baseline.sql:1294-1318`: `organization_id` :1296, `waha_session_name` :1297, `webhook_path_token` :1299, `webhook_secret_encrypted bytea` :1300, `status check (STARTING, SCAN_QR_CODE, WORKING, STOPPED, FAILED)` :1317, `phone_number` :1303, `daily_message_limit default 300` :1308, `warmup_started_at/completed_at/is_warmup_complete` :1309-1311. Coluna `provider` adicionada depois (`tests/invariants/channel-provider-schema.test.ts`, `lib/channels/inbound.ts:21`). É o equivalente de `channel_accounts(provider, account_key)`.

**Chave de deduplicação** — `messages_org_external_id_unique UNIQUE (organization_id, external_id) DEFERRABLE INITIALLY DEFERRED` `baseline.sql:2301`; inbound grava `external_id = payload.id` (`ingest.ts:614`) e trata `23505` como dedup (`:630-672`, com `logger.info` e reaceleração do pipeline :655-670). Eco de envio (`fromMe=true`) dedupa por lista de candidatos de id (`:790-808`, `wahaAdapter.echoExternalIds` `adapters/waha.ts:60`). **Não inclui `provider`** na chave (alvo: `(organization_id, provider, provider_message_id)`).

**`senderPn` / `remoteJidAlt`** — `senderPn`: **0 ocorrências** em `lib app workers` (só em `docs/DIRETRIZ.md`). `remoteJidAlt` e `participantAlt`: **lidos** — schema `lib/waha/envelope.ts:63-64`, função `telefoneAlternativoDe` `lib/waha/ingest.ts:380-408` (só aceita sufixo `@s.whatsapp.net`/`@c.us`, 8-15 dígitos, teto 128 chars anti-ReDoS). `@lid` sem alternativo → contato criado com `kind='lid'` e sem telefone (`parseChatId` :192-194; `upsertContact` :437-446) — **não vai a quarentena**. Sufixo desconhecido → `emit_event('whatsapp.chat_id_not_recognized')` :225-246 (contável). Colisão lid × telefone provada em `tests/invariants/telefone-do-lid-colisao.test.ts`.

**Versão do WAHA** — produção `docker-compose.prod.yml:132` `image: ${WAHA_IMAGE:-devlikeapro/waha:latest-2026.7.2}` (Core; comentário :126-131 explica o pin), engine `WHATSAPP_DEFAULT_ENGINE=NOWEB` :155; dev `docker-compose.yml:21` `devlikeapro/waha:noweb` (**sem pin**).

**Eventos consumidos** — `WHATSAPP_HOOK_EVENTS` `docker-compose.prod.yml:150` = `message.any, message.ack, message.edited, message.revoked, session.status, state.change` (`message` excluído de propósito :139-149, medido como subconjunto de `message.any`). Dispatch `lib/waha/ingest.ts:1065-1089`: `message|message.any` → `handleOutboundFromUserPhone` (fromMe) ou `handleInbound`; `message.ack` → `handleAck`; `message.edited`; `message.revoked`; `session.status|state.change` → `handleSessionStatus` (atualiza `channel_sessions.status` e fecha warm-up :955-980).

**Campos lidos do payload** (`lib/waha/envelope.ts:68-110`, Zod `looseObject`, tudo `.nullish()`): `id, from, fromMe, body, hasMedia, ack, ackName, timestamp, mediaUrl, media{url,mimetype,…}, _data.key.{remoteJidAlt, participantAlt, …}, _data.message (unknown), _data.notifyName/pushName` (`ingest.ts:347`), `status` (sessão); envelope: `event, session, payload`. Campo desconhecido **passa intacto e não é contado** (comentário :22-23) — não há `unknown_fields{name}`.

**Mídia** — `messages.media_url` gravado do payload (`ingest.ts:620`); depois `emit_event('media.persist_requested')` :728-741 → handler `workers/media-persist-worker.handler.ts` → `workers/media-persist-worker.ts` (bucket privado `whatsapp-media` :3-4, preenche `media_storage_path`) via `lib/messaging/media/waha-source.ts:20-35 fetchWahaMedia`, que reconstrói a URL sobre `WAHA_API_BASE_URL` e recusa outro host (`waha_media_untrusted_host` :31) — guarda SSRF do §5.18 já existe. Depois `media.derive_requested` → `workers/media-derive-worker.ts` (transcrição etc.).

**Throttle anti-ban** — `lib/automation/throttle.ts:1-3` (limite diário + 1,2 s + jitter) mas o cap diário é **inalcançável**: `channel_session_warmup` não tem escritor (:54-60). O motor real é `lib/agent-engine/pacing/*` com knobs `throttle_ms, jitter_max_ms, window_*, warmup_daily_caps` lidos de `channel_knobs` (`lib/automation/janela-do-canal.ts:41-91`); `lib/channels/capabilities.ts:81-82` marca `banRisk` por provider.

**Modo mock de WhatsApp: não existe.** `grep WHATSAPP_MODE|WAHA_MOCK|mock` em `lib/env.ts`, `lib/channels/transporte.ts`, `lib/waha/send.ts`, `lib/channels/adapters/waha.ts` = 0. `lib/channels/transporte.ts:39-44` só diz se `WAHA_API_BASE_URL/WAHA_API_KEY` estão preenchidos. Sem WAHA configurado, `sendWAHA` devolve `null` (noop, `send.ts:64-66`) — é disso que `tests/invariants/automation-send-whatsapp.test.ts:27` depende. Testes unitários mockam `createAdminClient` e `fetch` (`vi.mock`). Não há `tests/fixtures/waha/<versão>/`: `tests/fixtures/webhooks/` tem só `respondi-imobiliario.json` (não é WAHA); payloads reais vivem inline nos `.test.ts` (ex.: `lib/waha/ingest-celular.test.ts`, 427 linhas).

**Tabela de arquivo do fio** — `webhook_events_log` `baseline.sql:1868-1890` (`provider check waha|nuvemshop|generic` :1888, `raw_body`, `valid_signature`, `status check received|processed|error|dead`). Retenção pelo cron `webhook-log-retention`.

##### 2.2 Testes que cobrem

- `test:unit`: `lib/waha/client.test.ts` (287 l.), `ingest-celular.test.ts` (427 l.), `ingest-chat-desconhecido.test.ts`, `ingest-redos.test.ts`, `message-id.test.ts`, `resolve-contact-whatsapp-id.test.ts`, `webhook-auth.test.ts` (88 l.), `contact-card.test.ts`; `lib/channels/transporte.test.ts`; `tests/unit/channel-adapter-waha.test.ts` (16 casos), `assinatura-de-eventos-do-waha.test.ts` (3), `media-waha-source.test.ts`, `messages-handler-eco-duplicado.test.ts`, `lint-channels-fronteira.test.ts`.
- `test:db`: `tests/invariants/telefone-do-lid-colisao.test.ts` (4), `channel-provider-schema.test.ts`, `webhooks-trigger-events.test.ts`, `pre-go-live-canal.test.ts`, `automation-send-whatsapp.test.ts`, `gate-ativacao.test.ts`, `colunas-geradas-nao-sao-escritas.test.ts`.
- `test:e2e`: `tests/e2e/pre-go-live-whatsapp.spec.ts`; `test:journeys`: `tests/journeys/*` (jornada de baseline dos canais).

##### 2.3 Classe proposta: **ADAPTAR**

Justificativa: cliente, HMAC, contrato Zod, tratamento `@lid`/`remoteJidAlt`, assimetria de ids NOWEB/WEBJS, dedup por unique, pipeline de mídia com guarda SSRF e a interface `ChannelAdapter` já existem e estão sob teste; o que muda é mover a entrada (`verifySignature`, `resolveAccountKey`, `parseInbound`) para dentro do adapter, fechar o fail-open, adicionar quarentena, mock e fixtures versionadas.
Risco: REFAZER jogaria fora dois anos de peculiaridades medidas do WAHA (message-id, lid, eco) e a fronteira `lint:channels`; REUTILIZAR entregaria um webhook que **aceita payload sem assinatura por padrão** (`webhook-auth.ts:72-73`) e sem modo mock, o que impede o `verify.sh` de rodar sem número real (D12).

##### 2.4 O que muda na Fase 1

- Inv. (1) "sem `WAHA_WEBHOOK_SECRET` → 503 e conta": hoje default fail-open (`lib/env.ts:152`, `webhook-auth.ts:61-73`) → **F03-T02/F03-T03** (e renomear/unificar `WAHA_HMAC_SECRET`).
- Inv. (2) 401 com 0 escritas: cumprido para assinatura errada (`route.ts:121-133`, antes do insert em `webhook_events_log` :146).
- Inv. (3) `grep "\.send(" fora de src/actions/` = 0: hoje `adapter.send` é chamado de `lib/automation`, `lib/agent-engine`, `app/api/v1/messages/_handler.ts` etc. → **F03-T06**, **F05-T07**.
- `channel_accounts` + `TenantContext.fromWebhook` + `webhook_quarantine` (hoje sessão desconhecida = 200 `session_not_registered`, `route.ts:98-106`) → **F03-T03**, **F01-T02**.
- Chave `(organization_id, provider, provider_message_id)` (hoje sem `provider`, `baseline.sql:2301`) + fixtures `tests/fixtures/waha/<versão>/` + prova de delta 0 por snapshot de `pg_tables` → **F03-T04**, **F03-T10**.
- Ordem `senderPn → remoteJidAlt → remoteJid` e `reason=lid_without_pn`: `senderPn` não é lido; lid sem alt vira contato sem telefone → **F03-T04/F03-T05**.
- Allowlist + contador `unknown_fields` (hoje loose e mudo, `envelope.ts:22-23`) → **F03-T04**.
- Adapter `mock` gravando em `mock_outbox` (`WHATSAPP_MODE=mock`, D12) → **F03-T02**; `getWahaClient` lendo `process.env` direto (`client.ts:561-562`) → **F01-T09**.
- Pin da imagem dev (`docker-compose.yml:21` sem tag) → **F06-T06** (compose de staging).

---

#### 3. §5.13 Workers & Jobs

##### 3.1 O que existe

**Tabela `event_log`** — `supabase/baseline.sql:1522-1539`: `organization_id uuid not null` :1524, `event_type` (CHECK de formato `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` :1538), `entity_kind`, `entity_id`, `payload jsonb`, `metadata jsonb`, `consumed_by text[]` :1530, `attempts smallint` :1531, `last_error`, `next_attempt_at` :1533, `status check (pending, processing, done, dead)` :1537. Índices :2582-2598 (`consumed_by` GIN, `dead`, `entity`, `org_type`, `pending`). **Nenhum unique/idempotência** na tabela; trigger `trg_event_log_touch` BEFORE UPDATE :3014. Emissão: RPC `emit_event(text,text,uuid,jsonb,jsonb,uuid)` (assinatura em :5498-5500; exige `organization_id`, `raise exception 'emit_event: organization_id obrigatorio'`) e gatilhos AFTER: `trg_messages_emit_event` :3022 → `fn_emit_message_event` :260 (`message.received` / `message.sending|sent|failed` por `direction`/`status`), `trg_emit_event_on_lead_change` :3010, `trg_channel_sessions_status_audit` :2978. RLS: `event_log_select` :4107.

Idempotência mora em outros lugares: `job_queue.source_event_id` (dedup evento→job, `lib/agent-engine/queue/queue.ts:98-104`), `idempotency_keys(organization_id, key, endpoint)` unique :2251 (para HTTP, `baseline.sql:1549-1560`), `messages.external_id` unique :2301.

**Dispatcher + drain** — `lib/event-log/dispatcher.ts:17-58` (`EventRow.organization_id` :20, `HandlerResult.status ok|skipped|error|retry` :43-49, `EventHandler {key, events[], handle}` :52-57). `lib/event-log/register-handlers.ts:28-46` registra **14 handlers**: followupReactivity, aiResponse, aiSentiment, aiHandoffFromSentiment, ragIndexer, lgpdExport, lgpdRedact, automationRules, followupGatilhoEtapa, followupGatilhoCaso, mediaPersist, mediaDerive, webPushInbound, conversaoDeVenda. `lib/event-log/drain.ts`: `MAX_ATTEMPTS = 5` :16, backoff `2^n` minutos :29-33, reclaim de `processing` órfão após 10 min :19, :68-79, claim otimista :108-114, `retry` sem contar attempt :123-143, `dead` na 5ª :145-158 (**sem notificação** ao virar `dead`), `skipped.detail` preservado :169-181.

**Dois mecanismos de fila** (o §5.13 prevê um):
1. `event_log` (acima), drenado pelo cron `app/api/v1/cron/event-log-drain/route.ts` (limite 50 :4-8) **e** pelo laço `lib/event-log/drain-loop.ts` dentro do worker (motivo :1-30: cadeia áudio→persist→derive levava 103-188 s só de fila de cron).
2. `job_queue` — `baseline.sql:6473-6497`: `organization_id not null` :6475, `contact_id` (lane) :6476, `kind` check vigente :7734 (`inbound_turn, followup_turn, watchdog, flywheel, case_reply_turn, operator_turn`), `source_event_id` :6478, `status check (pending, running, done, failed, dead)` :6481, `max_attempts default 5` :6486, `locked_by/locked_at` :6488-6489, unique parcial `uniq_job_queue_one_running_per_contact` :6497. Código `lib/agent-engine/queue/queue.ts`: `enqueueJob` :69 (insert com `organization_id` :77), `claimJobs` :206 (FOR UPDATE SKIP LOCKED :10), `failJob` :286 (backoff `10 s × 2^(n-1)` teto 120 s :298; ao exceder `max_attempts` → `dead` **e** insert em `agent_inbox_items kind='job_dead' severity='critical'` no mesmo statement :305-315), `reapExpiredJobs`.

**Pasta `workers/`** — um único **processo**: `workers/agent-worker/main.ts` (594 l.), executado por `Dockerfile.worker:26` `pnpm exec tsx workers/agent-worker/main.ts` (serviço `worker` em `docker-compose.prod.yml:58-96`, imagem `ghcr.io/melgarafael/deskcomm-worker:stable` :92). Boot :1-15: env Zod → check de schema → reaper → healthz `:8787` :174-182 → loops: `runDrainLoop` :278 (turnos do agente), `runEventLogDrainLoop` :298, `runSessionWatchdogLoop` :312, `runHealthLoop` :329, `runFlywheelLoop` :340, `runCronLoop` :349, `rodarLoopDaFila` :422 (claim/complete/fail de `job_queue`); SIGTERM/SIGINT :481-482 com `SHUTDOWN_GRACE_MS` :463. **Não há flag `--once`** (`grep -n once` só acha `process.once`/`server.once`). Os demais arquivos de `workers/` (`ai-response-worker`, `ai-sentiment-worker`, `ai-handoff-from-sentiment`, `lgpd-export/redact`, `media-persist/derive`, `rag-indexer`, `storage-cleanup`) são **handlers** do event_log (`*.handler.ts`), não processos.

**Scheduler** — `Dockerfile.scheduler` (alpine + busybox crond, healthcheck `pgrep crond` :27-28) + `docker/scheduler/entrypoint.sh:59-85`: 21 linhas `minuto|timeout|rota`, cada uma vira `curl -H 'Authorization: Bearer $INTERNAL_SECRET' http://app:3000/<rota>` :97-98. Auth das rotas de cron: `INTERNAL_CRON_SECRET` ou `INTERNAL_SECRET` (`app/api/v1/cron/event-log-drain/route.ts:33-42`; sem segredo configurado responde **403**, alvo pede 503 + contador).

**Crons em `app/api/v1/cron/*` (21, `ls`)**: `agent-dispatcher` (NO-OP permanente, `route.ts:4-7`), `agenda-google-push`, `agenda-google-refresh`, `agenda-google-sync`, `attendant-heartbeat`, `channel-health`, `contact-avatars`, `contact-phones`, `contact-proposals-watcher`, `data-retention`, `event-log-drain`, `followup-flow-worker`, `kb-conversations-batch`, `lgpd-sla-watcher`, `recover-stuck-messages`, `risk-watcher`, `routing-worker`, `snooze-watcher`, `storage-redaction`, `sync-model-catalog`, `webhook-log-retention`. Paridade dir ↔ scheduler é provada por `tests/unit/cron-routes-scheduled.test.ts` (3 casos).

**Como um job carrega `organization_id`**: pela **linha** — `event_log.organization_id NOT NULL` (selecionado em `drain.ts:88`, exposto em `EventRow` `dispatcher.ts:20`) e `job_queue.organization_id NOT NULL` (`queue.ts:24`, `:77`). Não existe `fromJob(payload)` nem rejeição contada; a garantia é o NOT NULL + `emit_event` que lança sem org. Crons varrem **todas as orgs** com admin client num tick só (ex.: `snooze-watcher/route.ts`, `recover-stuck-messages`), sem `forEachEligibleTenant`.

**`job_runs`**: não existe tabela genérica. Registros por domínio: `automation_rule_runs` :5939, `ai_agent_runs` (`lib/ai/dispatcher/index.ts:300-311`), `agent_runs` do agent-engine.

##### 3.2 Testes que cobrem

- `test:unit`: `tests/unit/cron-routes-scheduled.test.ts` (3), `event-log-drain-loop.test.ts` (6), `dreno-nao-perde-evento.test.ts` (4), `evento-comando-tem-consumidor.test.ts`, `media-persist-worker.test.ts`, `media-derive-worker.test.ts`, `gatilho-dos-jobs-de-entrega.test.ts`, `cron-audita-so-quando-ha-efeito.test.ts`, `cron-contact-phones.test.ts`, `cron-contact-avatars-corrida.test.ts`, `ai-response-worker-*.test.ts` (3).
- `test:db`: `tests/invariants/event-log-drain.test.ts` (11), `dispatcher-event-status.test.ts` (3), `queue-backoff-do-retry.test.ts` (6), `queue-cap-global-do-claim.test.ts`, `queue-relogio.test.ts`, `agent-dispatch-single-consumer.test.ts`, `webhooks-bulk-events.test.ts`, `webhooks-inbound-idempotency.test.ts` (4 — cobre `crm_leads`, não `event_log`), `gov-4b-routing-worker.test.ts`, `drain-recencia-inbound.test.ts`.
- `test:shell`: `tests/shell/scheduler-entrypoint.test.sh` (crontab gerado, escape do segredo).

##### 3.3 Classe proposta: **ADAPTAR**

Justificativa: o padrão que o §5.13 manda herdar (event log + dispatcher + drain + worker + crond) está inteiro e provado por ~25 arquivos de teste; o que difere são constantes e três peças ausentes (`--once`, `job_runs` com `counts`, `notify(job.blocked)` para `event_log` dead, `idempotency_key` explícita).
Risco: se REUTILIZAR, o invariante (2) falha (5 tentativas com backoff em minutos, não 3 com 30 s/120 s; `dead` sem aviso no `event_log`) e o (1) não roda (`node worker.js --once` não existe); se REFAZER, perdem-se o reaper de `processing`, a lane por contato (`uniq_job_queue_one_running_per_contact`) e o dedup evento→job, defeitos já pagos em produção (`drain.ts:47-63`).

##### 3.4 O que muda na Fase 1

- Inv. (1) `worker.js --once` → **F01-T02** (worker) / **F03-T08**.
- Inv. (2) 3 tentativas, 30 s/120 s, `blocked` + `notify(job.blocked)`: hoje `MAX_ATTEMPTS=5`/`2^n min` (`drain.ts:16,:29-33`), `max_attempts 5`/`10 s×2^n` (`queue.ts:298`), sem aviso no `event_log` dead → **F03-T07**, **F05-T05**.
- Inv. (3) `idempotency_key` repetido = 1 execução: hoje só `source_event_id` em `job_queue` (`queue.ts:98-104`); `event_log` sem unique → **F03-T08**, **F05-T06**.
- `enqueue()` rejeitando sem `organization_id` + contador `tenant_ctx_rejected{source=job}` (hoje NOT NULL e `raise`, sem contador) → **F01-T02**.
- `forEachEligibleTenant` (crons hoje varrem todas as orgs num tick) → **F01-T02**, **F05-T06**.
- `job_runs(... counts jsonb)` → **F03-T07**; unificação (ou decisão explícita de manter) dos dois mecanismos `event_log` × `job_queue` → ADR na F03.
- Cron sem segredo → 503 contado (hoje 403, `event-log-drain/route.ts:40-42`) → **F01-T02**/§5.14.

---

#### 4. §5.16 Notificações

##### 4.1 O que existe

**Tabela `notifications(organization_id, user_id, event, payload, read_at)`: não existe** (`grep -cE "public\.notifications\b"` em `baseline.sql` = 0; `from('notifications')` no código = 0).

**"Central de avisos" = `agent_inbox_items`** — `supabase/baseline.sql:6453-6467`: `organization_id` :6455, `kind` (CHECK vigente :10030-10050 com **18 valores**: `qr_rescan, job_dead, event_dead, budget_exceeded, handoff, promotion_review, judge_unaligned, followup_dead, snooze_expired, next_action_ambiguous, risk_backlog_seeded, reactivation_expired, capabilities_missing, message_send_stuck, midia_nao_lida, channel_template_review, channel_number_alert, promise_unfulfilled`), `severity info|warn|critical` :6459, `title`, `body`, `ref_kind`, `ref_id`, `status open|ack|resolved` :6464, `resolved_at` (0216) :18421. **Sem `user_id`** (aviso é da org, não de um destinatário) e sem `read_at`. UI: `components/shell/AlertsBell.tsx:4,14` via `hooks/ai/useAgentInbox` → `app/api/v1/ai/inbox/route.ts:43-57`; página `app/app/ai/inbox/page.tsx`.

**Quem grava `agent_inbox_items` (sem fachada `notify()`; ≥12 sítios):** `lib/ai/handoff/orchestrator.ts:314` (`handoff`), `lib/agent-engine/queue/queue.ts:305-315` (`job_dead`, SQL), `lib/channels/health.ts:75,110,138,279` (`qr_rescan`, `channel_number_alert`), `lib/channels/zernio/avisos.ts:33,97,110,204` (`channel_template_review`, `channel_number_alert`), `lib/automation/desfecho-do-envio.ts:201` (`message_send_stuck`), `app/api/v1/cron/recover-stuck-messages/route.ts:179` (`message_send_stuck`), `app/api/v1/cron/snooze-watcher/route.ts:96` (`snooze_expired`), `lib/contacts/proposta-de-dado.ts:225`, `lib/leads/risk-seed.ts:237` (`risk_backlog_seeded`), `lib/leads/reactivation.ts:194` (`reactivation_expired`), `app/api/v1/pipelines/[id]/board/route.ts:169` (`next_action_ambiguous`), `app/api/v1/ai/budget/route.ts:321`, SQL `baseline.sql:14594`, `lib/agent-engine/pacing/aviso-de-janela.ts` (janela fechada, provado em `tests/invariants/aviso-de-janela-fecha-no-banco.test.ts`).

**`lib/notifications/` é do navegador, não do servidor**: `emit.ts:37-77 emitNotification` usa `window`/`new Notification` (Notification API), `deliver.ts:17-31 entregarAviso` = toast `sonner` (`in_app`) + push do navegador; preferências em `localStorage` (`prefs.ts:18-33`: categorias `message, lead_assigned, lead_won, lead_lost, mention`; canais `in_app|push`); `kinds.ts:1-8 NOTIFY_KINDS` (`message_inbound, alerts_toggle, lead_assigned, lead_won, lead_lost, mention`); `policy.ts:1-12 shouldNotifyInbound`; `mentions.ts`. Lado servidor: **Web Push** já existe — `lib/notifications/push.handler.ts:10` (`web-push-inbound.v1`, handler do `event_log` para `message.received`) → `push_subscriptions` (`baseline.sql:14852-14861`, RLS :14868) com VAPID (`lib/env.ts:341-342`, opcional). O §5.16 põe push na Fase 2; aqui ele já é o único canal "servidor → pessoa".

**E-mail** — `lib/email/resend.ts:90 sendEmail` (SDK `resend` :27); `RESEND_API_KEY`/`RESEND_FROM_EMAIL` opcionais (`lib/env.ts:244-245`); vazio ⇒ `error:"not_configured"` (`resend.ts:44-48`), sem adapter mock. Chamadores (4): `app/api/v1/team/invite/route.ts:120`, `app/actions/onboarding/sendOnboardingInvites.ts:103`, `lib/lgpd/email-delivery.ts:95`, `lib/lgpd/sla-alarm.ts:168`. Templates: `lib/email/templates/invite.ts`, `ai-budget-alarm.tsx`. **Nenhum e-mail para handoff, tarefa, confirmação ou job.**

**Mapa evento §5.16 → o que dispara hoje:**

| Evento alvo | Hoje | Evidência |
|---|---|---|
| `handoff.created` | `agent_inbox_items kind='handoff'` (org-wide) + `push` `message_inbound` indireto | `lib/ai/handoff/orchestrator.ts:314` |
| `task.assigned` | nada (não há `tasks` do §5.5; `lib/tarefas` é outro conceito) | — |
| `confirmation.requested` | nada (não há `pending_actions`) | — |
| `customer.replied_while_human` | Web Push em **toda** inbound, sem condição de estado | `lib/notifications/push.handler.ts:12-67`, `policy.ts:1-12` |
| `reminder.no_reply` | nada | — |
| `job.blocked` | `agent_inbox_items kind='job_dead'` só para `job_queue`; `event_log` dead não avisa | `queue.ts:305-315`; `drain.ts:145-158` |

##### 4.2 Testes que cobrem

- `test:unit`: `lib/notifications/{deliver,emit,policy,prefs,push.handler,push_payload,sounds,mentions,avatar_url}.test.ts` (9), `lib/ai/agent-inbox-copy.test.ts`, `tests/unit/aviso-da-automacao-nao-enterra-a-central.test.ts`, `channel-health-aviso.test.ts`, `channel-avisos-zernio.test.ts`, `notificacoes-tela-diz-o-que-falta.test.tsx`, `aviso-ao-lead.test.ts`, `o-aviso-da-busca-nao-esconde-o-outro.test.ts`.
- `test:db`: `tests/invariants/aviso-de-janela-fecha-no-banco.test.ts` (7), `handoff-avisa-o-lead.test.ts`, `orcamento-nasce-desarmado.test.ts`, `queue-backoff-do-retry.test.ts` (job_dead).
- `test:e2e`: `tests/e2e/central-de-avisos-capacidades.spec.ts`, `notificacoes-diz-o-que-falta.spec.ts`.

##### 4.3 Classe proposta: **CRIAR**

Justificativa: o módulo do §5.16 (`notify(ctx, event, recipients[])` gravando por destinatário + adapter de e-mail com mock) não tem correspondente; o que existe ao lado são dois vizinhos de outro tipo — avisos operacionais **da organização** (`agent_inbox_items`, sem `user_id`, 18 kinds, ≥12 escritores) e notificação **do navegador** (`lib/notifications`, `window`), e ambos podem continuar como estão. `lib/email/resend.ts` vira o adapter real de e-mail sem mudança de assinatura.
Risco: se a classe fosse ADAPTAR (enxertar `user_id`/`read_at` em `agent_inbox_items`), os 6 eventos do alvo se misturam a 18 kinds e 12 escritores espalhados, e o invariante `grep "from('notifications')" fora de src/notifications/` = 0 fica inalcançável; se fosse REMOVER `agent_inbox_items`, some a única saída de `job_dead`, `qr_rescan` e `message_send_stuck`, que não têm substituto no §5.16.

##### 4.4 O que muda na Fase 1

- Tabela `notifications(organization_id, user_id, event, payload, read_at)` + `notify()` + 6 eventos + e-mail mock → **F05-T05** (dependência: `handoffs` de F05-T01, `tasks` de F02, `pending_actions` de F04-T02).
- `job.blocked` para `event_log` dead (hoje silencioso, `drain.ts:145-158`) → **F03-T07** + **F05-T05**.
- `customer.replied_while_human` condicionado ao estado da conversa (hoje push em toda inbound) → depende de **F03-T01** (estado) + **F05-T05**.
- `service_only` no manifest para `notifications` (§5.15) → **F01-T03**.
- Push do navegador e `agent_inbox_items`: manter como estão, fora do §5.16 (registrar em `target-state.md` como "vizinho não migrado"; push é Fase 2 por decisão do §5.16).

---

#### 5. Não verificado (G-04)

- Nenhum comando de teste foi executado; os N/N ficam para a F00-T02.
- A coluna `provider` de `channel_sessions` foi inferida por `lib/channels/inbound.ts:21` e pelo nome do invariante `channel-provider-schema.test.ts`; a linha da migration não foi localizada.
- Se `contact_proposal_expired` (`lib/contacts/proposta-de-dado.ts:228`) está no CHECK vigente de `agent_inbox_items` — não aparece na lista de :10031-10050; pode haver `alter` posterior não lido.
- A definição completa de `fn_emit_message_event` (:260-292) foi lida só por grep dos `event_type`.
- Estado do `webhook_events_log.status` (`processed`/`error`) — quem o atualiza não foi rastreado.

---

#### 6. Tabela resumo

| módulo | classe | evidência principal | risco |
|---|---|---|---|
| §5.6 Conversation | ADAPTAR | CHECK com 7 valores mistos (`baseline.sql:1394`, comentário :1401 "future migration may consolidate"); `status` escrito em 8 caminhos (5 TS + `fn_conversation_assign` :16999 + `fn_upsert_wa_conversation` :5128 + LGPD :384); nenhuma `transition()`; "quem manda" é derivado de 7 fatos (`lib/inbox/comando-da-conversa.ts:1-30`) | REUTILIZAR deixa `claimed`/`pending` sendo gravados por RPC que o inbox novo não lê; REFAZER perde upsert atômico, RLS e ~15 invariantes de atribuição/silêncio |
| §5.7 Channel Adapter (WAHA) | ADAPTAR | `ChannelAdapter` só de saída (`lib/channels/types.ts:150`; 3 adapters); entrada em `lib/waha/ingest.ts:1065-1089` + rotas; HMAC fail-open por default (`lib/env.ts:152`, `webhook-auth.ts:72-73`); dedup `(organization_id, external_id)` :2301 sem `provider`; `senderPn` = 0 ocorrências, `remoteJidAlt` lido (`ingest.ts:381`); WAHA `latest-2026.7.2` Core (`docker-compose.prod.yml:132`); sem mock, sem `tests/fixtures/waha/` | REUTILIZAR sobe webhook que aceita payload sem assinatura e não roda em `verify.sh` sem número real; REFAZER descarta message-id NOWEB/WEBJS, lid, eco e guarda SSRF de mídia |
| §5.13 Workers & Jobs | ADAPTAR | `event_log` :1522-1539 (sem unique) + dispatcher/drain (`drain.ts:16` 5 tentativas, `2^n` min, dead sem aviso) + `job_queue` :6473 (segunda fila, `queue.ts:298`) + `workers/agent-worker/main.ts` sem `--once` + crond com 21 rotas (`docker/scheduler/entrypoint.sh:59-85`); org vem da linha, sem `fromJob` nem `forEachEligibleTenant` | REUTILIZAR falha os 3 invariantes do §5.13 (`--once`, 3×/30 s/120 s/blocked+notify, `idempotency_key`); REFAZER perde reaper, lane por contato e dedup evento→job |
| §5.16 Notificações | CRIAR | Não há tabela `notifications` (0 em `baseline.sql`); `agent_inbox_items` :6453 é aviso da org (sem `user_id`, 18 kinds, ≥12 escritores); `lib/notifications/emit.ts:37` é `window.Notification`; Web Push servidor já existe (`push.handler.ts:10`); e-mail Resend (`resend.ts:90`) só para convite/LGPD/orçamento | ADAPTAR mistura 6 eventos com 18 kinds e 12 escritores, tornando o grep do invariante inalcançável; REMOVER `agent_inbox_items` apaga `job_dead`/`qr_rescan`/`message_send_stuck`, que o §5.16 não cobre |

Contagem deste agente: `reutilizar=0 adaptar=3 refazer=0 criar=1 remover=0` (4 módulos).

### 2.3 Lote C — AI Agent, Action Policy, RAG, Handoff, Entitlement, Observabilidade (relatório integral)


Repo: `/home/klarosk/projetos/DeskcommCRM` — código auditado em `c85f7d7` (HEAD local `55826722` difere só em `docs/` e `scripts/.gitkeep`; nenhum `.ts`/`.sql` mudou — `git diff --stat c85f7d7 HEAD`).
Toda linha citada foi conferida com Grep/Read. Scripts de teste: `test:unit` = `vitest run` (exclui `tests/e2e`, `tests/invariants`, `tests/journeys` — `vitest.config.ts:29-36`); `test:db` = `bash scripts/test-db.sh` (Postgres efêmero `pgvector/pgvector:pg17` + `tests/invariants/**`); `test:e2e` = `playwright test`.

Contagem geral: `tests/invariants/*.test.ts` = 156, `tests/unit/*.test.ts` = 423, testes colocados em `lib|workers|app` = 201, `tests/e2e/*.spec.ts` = 90.

#### Achado transversal: dois stacks de IA coexistem

| Stack | Entrada | Provedor | Uso gravado em | Handoff | Seleção |
|---|---|---|---|---|---|
| **engine** (worker) | `lib/agent-engine/agent/inbound-turn.ts` (3391 linhas) | `lib/agent-engine/edge/llm/run-model-call.ts:418` (`generateText`) | `llm_calls` (`run-model-call.ts:478`) | `lib/agent-engine/agent/human-handoff.ts:117` | `AGENT_DISPATCH_CONSUMER=engine` (default) — `lib/env.ts:183`, `lib/agent-engine/env.ts:86` |
| **native** (Next/worker legado) | `workers/ai-response-worker.ts:75` (1107 linhas) → `lib/ai/runtime/agent.ts:529` (`generateText`) | `lib/ai/gateway.ts:69` `resolveLanguageModel` | `llm_calls` via `lib/ai/log-invocation.ts:70` (comentário: "não mais em ai_invocations, migration 0130") | `lib/ai/handoff/orchestrator.ts:70` | `AGENT_DISPATCH_CONSUMER=native` |

O comentário em `lib/env.ts:178-182` diz: "NUNCA os dois — dois consumidores = turno duplicado ou perdido (bug real da fusão)". A Fase 1 (§5.9 "Provedor: `AIProvider` com `openai` e `mock`") pressupõe **um** caminho.

---

#### §5.9 AI Agent

##### 1. O que existe

**Motor (engine)**
- `lib/agent-engine/agent/inbound-turn.ts` — **3391 linhas** (`wc -l`), o maior arquivo do motor; `guardrails/before-send.ts` 1130, `agent/followup-turn.ts` 739, `agent/operator-turn.ts` 683, `edge/llm/run-model-call.ts` 672. Total do `lib/agent-engine/`: 24 402 linhas.
- Provedor: SDK `ai` v7 (`package.json:70` `"ai": "^7.0.90"`; `@ai-sdk/anthropic|google|openai` `package.json:39-41`). Chamada única em `run-model-call.ts:418` `generateText({ model: factory(config.apiKey, model, decisao.baseUrl), system, messages, tools, stopWhen: stepCountIs(maxSteps), ... })`. Registry de providers `lib/agent-engine/edge/llm/providers.ts:83` (`anthropic`, `openai`, `google`, `openrouter`), instância por chamada com chave BYOK da org (`providers.ts:2-4`), `fetch` contido por allowlist de egress (`providers.ts:85-91`).
- Resolução do modelo por "ponto" (`purpose`) via painel de provedores `ai_purpose_bindings` (`supabase/baseline.sql:11000`; colunas `purpose, provider, credential_id, model_id, base_url`) — `run-model-call.ts:322` `decidirParaOSeam`. Fallback `organizations.settings.llm.default_model` / `AGENT_DEFAULT_MODEL` (`lib/agent-engine/env.ts:44`, default `'claude-sonnet-4-5'`).
- Strings de modelo: **não** vai pelo Vercel AI Gateway no engine; `lib/ai/runtime/agent.ts:134-139` documenta que `createGateway({apiKey})` sempre falhava com "Unauthenticated". No stack native, `lib/ai/gateway.ts:72` devolve a string crua (`"anthropic/claude-sonnet-5"`) quando `AI_GATEWAY_API_KEY` está setada (roteamento pelo gateway da Vercel), senão OpenRouter (`gateway.ts:74-79`) ou provider direto (`gateway.ts:81-89`). Ids canônicos `lib/ai/gateway.ts:25-34` (`anthropic/claude-sonnet-5`, `anthropic/claude-opus-5`, `anthropic/claude-haiku-4-5`, `openai/text-embedding-3-small`).
- **Env vars de IA** (código, não doc):
  - `lib/env.ts:160` `AI_GATEWAY_API_KEY`, `:161` `AI_GATEWAY_BASE_URL`, `:165` `OPENROUTER_API_KEY`, `:166` `OPENROUTER_BASE_URL`, `:172` `OPENROUTER_APP_URL`, `:173` `OPENROUTER_APP_TITLE`, `:174` `VERCEL_AI_GATEWAY_URL`, `:175` `ANTHROPIC_API_KEY`, `:176` `OPENAI_API_KEY`, `:183` `AGENT_DISPATCH_CONSUMER`; aviso de boot `lib/env.ts:380-385`.
  - `lib/agent-engine/env.ts:26` `ANTHROPIC_API_KEY`, `:31` `OPENAI_API_KEY`, `:42` `OPENROUTER_API_KEY`, `:44` `AGENT_DEFAULT_MODEL`, `:100` `AI_BUDGET_ENFORCEMENT`, `:137` `LLM_CACHE_TTL`, `:139` `LEAD_CONTEXT_HISTORY_LIMIT` (20), `:140` `LEAD_CONTEXT_MAX_TOKENS` (1000), `:150` `COMPACTION_TRIGGER_MESSAGES` (40), `:151` `COMPACTION_MODEL`, `:152` `COMPACTION_TRANSCRIPT_MAX_TOKENS` (400), `:160` `STAGE_CLASSIFIER_MODEL`, `:161` `JAILBREAK_CLASSIFIER_MODEL`, `:167` `PROMISE_SEMANTIC_MODEL`, `:170` `FOLLOWUP_AI_MODEL`, `:172` `AGENT_MAX_STEPS` (8), `:175` `MAX_SENDS_PER_TURN` (3).
  - `lib/crypto/aes_gcm.ts:4` `AI_CRED_AES_KEY` (cifra BYOK em `ai_provider_credentials`, `baseline.sql:1192-1208`).
  - `workers/media-derive-worker.ts:92,93,99` `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`OPENROUTER_API_KEY`; `scripts/bootstrap-owner.ts:153` `AI_PROVIDER` (só instalador).
  - Nenhum `GOOGLE_*` no código (grep vazio) apesar de `@ai-sdk/google` e `provider='google'` no CHECK de `ai_models` (`baseline.sql:1171`).
- **Mock/dublê**: existe — `lib/agent-engine/edge/llm/providers.ts:126` `createFakeRegistry` com `MockLanguageModelV3` de `ai/test` (`providers.ts:10,131`), injetado por `deps.registry` (`run-model-call.ts:311`). Não é selecionável por env/`case_id`; é dependência de teste.
- **Saída estruturada**: parcial. O reply é o **texto livre** do `generateText`; o modelo envia pelo tool `send_message` (`inbound-turn.ts:154`). Estrutura só no *fechamento* do turno: `checkpointContentSchema` (`inbound-turn.ts:346-365`: `commitments, objections, next_action, rolling_summary, declaracao`) parseado de `closing.result.text` (`inbound-turn.ts:3079`). `confidence` existe apenas no roteador de intenção (`ai_router_decisions.confidence numeric(4,3)`, `baseline.sql:9145`+; gravado em `inbound-turn.ts:1547-1549`), não no turno. Não há `{reply, intent, confidence, tool_calls[], handoff}`.
- **Prompt injection**: classificador *advisório* por modelo — `lib/agent-engine/guardrails/jailbreak/classifier.ts:2-10` ("NÃO veta o inbound sozinho"), chamado em `inbound-turn.ts:2878-2879`; escalação só se correlacionado a promessa fora de tabela. Não há delimitação `<customer_message>` nem instrução "conteúdo é dado": o contexto do lead entra como `JSON.stringify(context)` sob o título `## Contexto do lead (contato + últimas mensagens)` (`inbound-turn.ts:1017`, `:1038`). Guardrails determinísticos de *saída*: `guardrails/before-send.ts` (1130 linhas), `guardrails/vazamento-interno.ts:483`.
- **Limite de contexto**: histórico 20 msgs / 1000 tokens (`lib/agent-engine/env.ts:139-140`), compaction com resumo (`agent/compaction.ts:113` `trimTranscriptToBudget`), prune de tool results (`env.ts:154-155`), cache prefix 1h (`run-model-call.ts:407-411`). Native: `ai_agent_versions.history_message_window=20`, `history_token_window=8000`, `max_steps=10`, `token_budget=50000` (`baseline.sql` ~`:975-985`).

##### 2. Testes
- `test:unit`: 29 arquivos referenciam `agent/inbound-turn` (ex.: `tests/unit/agenda-nao-mente-sobre-id-de-contato.test.ts`, `lib/agent-engine/agent/resolve-turn-agent.test.ts`, `draft-reply.test.ts`, `media-parts.test.ts`); 9 referenciam `edge/llm/run-model-call` (`tests/unit/llm-calls-registra-falha.test.ts`, `gateway-destino-por-caminho.test.ts`, `gateway-binding.test.ts`); `lib/ai/gateway-resolve-model.test.ts`; `tests/unit/vazamento-nome-de-provider.test.ts`, `vazamento-interno-detector.test.ts`.
- `test:db`: `tests/invariants/agent-no-credential.test.ts`, `case-guardrail.test.ts`, `capacidades-ausentes.test.ts`, `limite-de-envios-por-turno.test.ts`, `o-turno-diz-ao-modelo-que-dia-e-hoje.test.ts`, `agent-config-cases.test.ts`, `ai-purpose-bindings.test.ts`.
- **Zero** arquivos de teste referenciam `guardrails/jailbreak` ou `agent/search-knowledge` (grep `-l` = 0). Não existe `docs/ai-eval/cases.yaml` nem runner de avaliação.

##### 3. Classe: **REFAZER** (módulo AI Agent como unidade de 5.9), reaproveitando o seam `run-model-call.ts` + `providers.ts` como `AIProvider`.
Justificativa: o turno é um arquivo de 3391 linhas que faz contexto, tools nativas, MCP, guardrails, checkpoint, handoff e envio; não expõe saída estruturada, não delimita o texto do cliente, mistura envio (`send_message` é tool do modelo) com decisão, e coexiste com um segundo stack completo. Sete respostas de preservação: (problema) responder lead por WhatsApp com tools e memória; (quem usa) worker `workers/agent-worker/main.ts`; (dependências) `pg`, `ai`, MCP bridge, `human-handoff`, `search-knowledge`, `compaction`, `before-send`; (testes) 29 unit + ~10 invariants; (dependentes) `followup-turn.ts`, `operator-turn.ts`, flywheel; (reaproveitável) `run-model-call.ts:310-524` (budget → generateText → llm_calls), `providers.ts:83-146` (registry + fake), `compaction.ts:113`, `pricing.ts`; (ganho) módulo de ~400 linhas com contrato `{reply,intent,confidence,tool_calls,handoff}` e teste de injeção.
Risco: se for só ADAPTAR, a Fase 1 herda dois consumidores de turno e um arquivo onde nenhum invariante de 5.9 (contexto fechado, tool fora da lista descartada e contada, `confidence<threshold → handoff`) pode ser provado sem reescrever o miolo.

##### 4. O que muda na Fase 1 (F04-T01..)
Não cumpre: (a) saída estruturada obrigatória com `confidence` (G-77); (b) delimitação `<customer_message>` + handoff `forbidden_request`; (c) "o módulo não importa cliente Postgres nem `fetch`" — `inbound-turn.ts:30` importa `pg`, `:55` `createAdminClient`; (d) provedor `mock` determinístico por `case_id` (D12) selecionável fora de teste; (e) `withEntitlement(ctx,"ai.reply")` em toda chamada; (f) ai-eval com ≥30 casos.

---

#### §5.8 Action Policy

##### 1. O que existe
- **Catálogo MCP**: `lib/mcp/tools/catalogo/index.ts:30-40` `TOOL_CATALOG` = concatenação de 9 domínios; **60 nomes** `crm_*` (grep `name: "` único). Entrada `McpToolCatalogEntry` (`catalogo/tipos.ts:11-24`) com `risco: ToolRisk` (`lib/mcp/tools/pacotes.ts:22` = `"seguro" | "atencao" | "critico"`) e `apenasHumano?` (`tipos.ts:42`). Não há `executors`, `confirmation`, `input_schema/output_schema` no catálogo (schema vive na implementação da tool).
- **Teto**: `TETO_TOOLS_POR_AGENTE = 25` (`lib/mcp/tools/selecao-por-pacote.ts:56`); o comentário `:24-41` explica que era 20 e que "o modelo JÁ recebe mais que 20: o turno monta 12 ferramentas nativas" — as 12 nativas do engine em `inbound-turn.ts:148` `AGENT_TOOL_DEFS` (`get_lead_context, send_message, update_lead_state, schedule_followup, save_lead_note, get_lead_note, search_knowledge, request_human_handoff, read_skill_reference, open_human_case, provide_case_update, send_template`), somadas às MCP escolhidas (`ai_agent_versions.tool_ids text[]`, `baseline.sql` ~`:970`).
- **Executor**: no engine, `lib/agent-engine/edge/crm/mcp-tools.ts:36` `BLOCKED_TOOL_IDS = {crm_send_whatsapp_message, crm_request_human_handoff}` (envio e handoff só pelas nativas); no native, `lib/ai/runtime/tools.ts:28` filtra `apenasHumano` e `:33` auto-injeta handoff. Papéis por `ensureRole/ensureScope` na ponte MCP (`mcp-tools.ts:5`).
- **Gate humano antes de executar**: não existe mecanismo genérico de `pending_actions`. Existem dois gates específicos: (a) `contact_field_proposals` (`baseline.sql:11464`) — tool `crm_propose_contact_field` propõe, humano confirma (invariante `tests/invariants/proposta-de-dado-do-contato.test.ts:396`); (b) `flywheel_distiller_proposals` (`baseline.sql:6999`) — `lib/agent-engine/flywheel/live.ts:219` "proposta do distiller gravada (gate humano pendente)" para mudanças de playbook. Tools de `risco: "critico"` (ex.: `catalogo/operacao.ts:97,208`, `retencao.ts:87`) executam sem confirmação; o risco só informa a tela de seleção.
- **Circuit breaker por tool**: `lib/agent-engine/agent/tool-breaker.ts:110` `wrapToolsWithBreaker` (bloqueia repetição/erro), `READ_ONLY_TOOLS` `:60`.
- **Auditoria da execução**: MCP → `api_audit_log` `action='mcp.tool_called'` (`lib/mcp/audit.ts:4,45`); native → `ai_agent_runs.tool_calls jsonb` (`baseline.sql:957`); engine → `lead_checkpoints.declaracao` (`inbound-turn.ts:364`) e trace do job. Tools nativas do engine (`send_message`, `update_lead_state`…) **não** passam por `api_audit_log`.

##### 2. Testes
- `test:unit`: `tests/unit/catalogo-tools-leigo-friendly.test.ts` (nomes únicos), `tool-read-nao-muta.test.ts`, `mcp-governance-tools.test.ts`, `mcp-escalacao-tools.test.ts`, `mcp-agendamento-tools.test.ts`, `mcp-retencao-tools.test.ts`, `capacidade-alcancavel-pelo-agente.test.ts`, `uso-de-capacidades.test.ts`, `entrega-de-capacidade.test.ts`, `lib/mcp/tools/comercio.test.ts`.
- `test:db`: `tests/invariants/portao-de-capacidade-mede-quem-executa.test.ts`, `uso-de-capacidades-do-agente.test.ts`, `capacidades-ausentes.test.ts`, `gate-ativacao.test.ts`, `proposta-de-dado-do-contato.test.ts`.
- `test:e2e`: `tests/e2e/capacidades-do-agente.spec.ts`, `central-de-avisos-capacidades.spec.ts`, `qa-agente-usa-as-maos.spec.ts`.

##### 3. Classe: **CRIAR** (`src/actions/catalog.ts` + `execute/confirm/toolsFor`), REMOVENDO o catálogo MCP de 60 tools do caminho da IA da Fase 1.
Justificativa: hoje há taxonomia de risco (3 níveis) e catálogo, mas sem `executors`, sem `confirmation by_risk`, sem `pending_actions`, sem `denied` contado, e 12 tools nativas fora do catálogo — a matriz N×3 da §5.8 não é derivável de nada que exista. Sete respostas para o REMOVER parcial: (problema) agente genérico com 60 capacidades por pacote; (quem usa) tela `capacidades-do-agente`, MCP server `lib/mcp/server.ts`; (dependências) `lib/mcp/tools/*` 9 domínios; (testes) ~10 unit + 5 invariants; (dependentes) engine via `mcp-tools.ts`, native via `pickToolsFromMcp`; (reaproveitável) `pacotes.ts:22` taxonomia, `lib/mcp/audit.ts:45` padrão de audit, `tool-breaker.ts`; (ganho) 10-12 entradas com política explícita em vez de 72 sem política.
Risco: se ADAPTAR o catálogo MCP, `toolsFor(ctx,"ai")` nunca devolve "exatamente 9" e `create_order` por IA executa sem pendência humana (D17).

##### 4. O que muda na Fase 1 (F03-T06, F04-T01, F06-T03)
Não cumpre: `execute()` único que valida schema/executor/confirmação e grava `audit_events`; `confirmation: by_risk` com `actions.confirm_from_risk`; `send_message` guardado por estado da conversa; nome fora do catálogo = `denied` sem exceção; contador `actions_denied`.

---

#### §5.10 Knowledge/RAG

##### 1. O que existe
- **Colunas `vector(N)` em `supabase/baseline.sql`** (grep `vector(`, `halfvec(`, case-insensitive; migrations também varridas):
  | tabela.coluna | N | linha |
  |---|---|---|
  | `ai_chunks.embedding` | **1536** | `baseline.sql:1058` |
  Única. Índice `ai_chunks_embedding_ivfflat_idx` (`vector_cosine_ops`, lists=100) `baseline.sql:2518`. Parâmetros `p_embedding public.vector` sem dimensão nas RPCs (`:897`, `:9663`, `:12197`, `:16608`). `lead_notes.embedding` é **jsonb**, não pgvector (`baseline.sql:6851-6855`, "recall híbrido"). Metadados de dimensão: `ai_knowledge_versions.embedding_model/embedding_dims` (`:16466-16468`), `ai_models.supports_embedding/embedding_dims` (`:16668-16671`). Nas migrations: `20260429032132_0010_...sql:46` `p_embedding vector(1536)`.
- **Modelo de embedding**: constante `MODELO_DE_EMBEDDING = "openai/text-embedding-3-small"`, `DIMENSOES_DO_EMBEDDING = 1536` (`lib/ai/embeddings/chave.ts:58-59`); `lib/ai/gateway.ts:34` `DEFAULT_EMBEDDING_MODEL`. `embedText` (`lib/ai/embed.ts:59`) asserta `length === 1536` a cada chamada (`embed.ts:97-100`). Chave por escada ponto→credencial da org→gateway→env (`chave.ts:95` `resolverChaveDeEmbedding`). Preço seed `ai_pricing` `'openai/text-embedding-3-small'` = 20 cents/M (`baseline.sql:8112-8113`).
- **RPC de busca**: `fn_buscar_trechos_das_fontes(p_organization_id, p_source_ids[], p_embedding, p_k, p_threshold, p_embedding_model)` (`baseline.sql:16605-16657`), `SECURITY DEFINER`, predicado `c.organization_id = p_organization_id` (`:16644`) + filtro por fontes ativas/versão ativa (`:16645-16648`) + filtro de modelo (`:16649-16653`); gate de membership só se `auth.uid()` (`:16624-16628`). Legada `retrieve_top_k_chunks` (`:9663-9679`) filtra `organization_id` (`:9674`) + `kb_version_id`. Chamadores: engine `lib/agent-engine/agent/search-knowledge.ts:94-100` (passa `args.organizationId` como `$1`); native `workers/ai-response-worker.ts:891-899`; UI `lib/ai/knowledge/busca.ts:81`. RLS na tabela não é o que isola o engine (roda com `bypassrls`, comentário `:16603`).
- **Ingestão**: worker `workers/rag-indexer.ts:498` `processRagIndexer` (consome `event_log`), chunking `lib/ai/rag/chunker.ts` (`chunkText`, doc: `maxChars:1600, overlapChars:200` `rag-indexer.ts:220`; FAQ = 1 chunk por par `:177-181`; catálogo `:231`), `embedText` por chunk (`:375`), upsert `ai_chunks` (`:386`), versões `ai_knowledge_versions` (`baseline.sql:1135`), fontes `ai_knowledge_sources` (`:1110`, `source_type ∈ {faq, policy, catalog, conversations, conversation, nuvemshop_catalog}` `:1127`). Extractores `lib/ai/rag/extractors/{pdf,markdown}.ts`.
- Log de busca: `search-knowledge.ts:123` insere `(organization_id, job_id, kb_version_id, hits, top_score, threshold)`.

##### 2. Testes
- `test:unit`: `lib/ai/embed.test.ts` (dimensão), `lib/agent-engine/agent/search-knowledge.test.ts` (265 linhas), `tests/unit/ai-knowledge-sources-post.test.ts`, `app/api/v1/ai/knowledge/sources/route.test.ts`. Nenhum teste para `lib/ai/rag/chunker.ts` (grep = 0); 1 para `rag-indexer`.
- `test:db`: `tests/invariants/rag-acervo-da-organizacao.test.ts` (4 casos: fontes por org, busca só do material do agente — `:18-29`), `vocabulario-banco-x-typescript.test.ts`.
- `test:e2e`: `tests/e2e/acervo-de-conhecimento.spec.ts` (requer `OPENAI_API_KEY`, `:60`).

##### 3. Classe: **ADAPTAR**
Justificativa: pgvector, `vector(1536)`, `text-embedding-3-small`, assert de dimensão, RPC com `organization_id` no predicado e worker de chunking já cumprem a forma da §5.10; falta renomear/simplificar (`knowledge_documents/knowledge_chunks` vs `ai_knowledge_sources/versions/ai_chunks` com `agent_id NOT NULL`), o exit-code-2 no boot e o `ai_usage_events(operation=embedding)`.
Risco: se REFAZER, perde-se o reindex versionado e o invariante `rag-acervo`; se REUTILIZAR sem mexer, `ai_knowledge_sources.agent_id NOT NULL` (`baseline.sql:1113`) amarra a base ao agente, contrariando "acervo é da organização" da própria migration 0181.

##### 4. O que muda na Fase 1 (F04-T02/T03)
Não cumpre: (1) ping de embedding no boot com `process.exit(2)` (hoje assert por chamada, `embed.ts:97`); (3) toda chamada de embedding gera `ai_usage_events operation=embedding` — hoje `embedText` não grava `llm_calls` (grep `llm_calls|logInvocation` em `embed.ts` = 0; só `promptTokens` retornado `embed.ts:110`). ADR-002 deve fixar DIM=1536 — já é o que o banco tem.

---

#### §5.11 Handoff

##### 1. O que existe
- **Sem tabela `handoffs`**. Estado vive em `conversations`: `bot_silenced_until timestamptz`, `last_handoff_at`, `last_handoff_reason text` (`baseline.sql:1385-1387`), `assignee_kind ('user'|'ai')` (invariante `gov-6-ai-handoff.test.ts:34`), `status='ai_handling'` aceito (`:24`).
- **Motivo**: texto livre nos dois stacks. Engine: `requestHumanHandoffInputSchema.reason: z.string().min(1).max(500)` (`human-handoff.ts:235-236`), default `'requested_human'` (`:273`), gravado em `last_handoff_reason` (`:155`). Native: union TS `HandoffReason` com 7 valores (`lib/ai/handoff/orchestrator.ts:35-51`: `requested_human, low_sentiment, low_confidence, critical_stage, legal_mention, refund_mention, orcamento_de_ia`) — sem CHECK/enum no banco (grep `handoff_reason.*check` = 0). Constante compartilhada `HANDOFF_REASON_ORCAMENTO='orcamento_de_ia'` (`orcamento.ts:87`).
- **Resumo**: engine `buildHandoffSummary` (`human-handoff.ts:310`) a partir do `lead_checkpoints.rolling_summary` (sem nova chamada de modelo); resumo entra no corpo do `agent_inbox_items(kind='handoff')` (`:167-179`), dedup por episódio aberto. Native: sem resumo (orchestrator só grava atividade `crm_lead_activities` `:185`).
- **Notificação ao humano**: engine → `agent_inbox_items` (Central de avisos; `baseline.sql:6453`, kinds incl. `'handoff'` `:10031+`); native → Realtime broadcast `handoff_pending` (`orchestrator.ts:244-249`) + audit `ai.handoff_triggered` (`:264`). Move lead para etapa `crm_stages.slug='chamar-humano'` (opt-in; `lib/leads/handoff-stage-move.ts:26`, chamado `inbound-turn.ts:1890`, `orchestrator.ts:15`). Não há tabela `notifications`.
- **Silêncio da IA**: `bot_silenced_until='infinity'` (`human-handoff.ts:160` `SILENCE_INFINITY`); engine checa no início do turno `isLeadInHandoff` (`inbound-turn.ts:1314`, no-op antes de qualquer LLM); native `ai-response-worker.ts:615` (`assignee_kind==='user' → skip`) e `:663` `silencioVigente`. Retomada por humano: tool `crm_resume_ai_attendance` (catálogo) e testes `escalacao-retomada`.
- **Claim**: não há `claimed_by/claimed_at`; `agent_inbox_items.status ∈ {open, ack, resolved}` (`baseline.sql` ~`:6461`) e `crm_assign_conversation`.
- Aviso ao lead antes do handoff (`inbound-turn.ts:505`, `handoff-avisa-o-lead`).

##### 2. Testes
- `test:unit` (8 arquivos referenciam `agent/human-handoff`): `tests/unit/handoff-por-orcamento.test.ts`, `handoff-avisa-o-lead.test.ts`, `handoff-orchestrator-elegibilidade.test.ts`, `handoff-stage-move.test.ts`, `messages-handler-silencio-ia-apos-humano.test.ts`, `escalacao-retomada.test.ts`, `escalacao-expectativa.test.ts`, `mcp-handoff-assignment.test.ts`, `lib/escalacao/atendimento-manual.test.ts`.
- `test:db`: `tests/invariants/gov-6-ai-handoff.test.ts`, `handoff-avisa-o-lead.test.ts`, `escalacao-ciclo-humano.test.ts`, `operador-nao-pisa-no-humano.test.ts`, `human-cases.test.ts`.
- `test:e2e`: `tests/e2e/escalacao-ciclo.spec.ts`.

##### 3. Classe: **REFAZER** (tabela + enum + `requestHandoff/claim`), reaproveitando o mecanismo de silêncio.
Justificativa: a §5.11 exige `handoffs(...)` com `reason` enum de 8 valores (G-78), `last_messages[5]`, `summary ≥1 frase`, `claimed_by` e `notify(+1)` — hoje motivo é texto livre gravado em duas grafias possíveis, não há tabela, o resumo só existe no engine e a notificação é um item de inbox ou um broadcast, sem `claim`. Sete respostas: (problema) parar a IA e avisar humano; (quem usa) inbox/Central, engine e native; (dependências) `conversations`, `agent_inbox_items`, `lead_checkpoints`, `crm_stages`; (testes) 9 unit + 5 invariants + 1 e2e; (dependentes) `inbound-turn`, `ai-response-worker`, `orcamento.ts`, MCP `crm_request_human_handoff`; (reaproveitável) `bot_silenced_until` + `isLeadInHandoff` (`human-handoff.ts:88`), `buildHandoffSummary` (`:310`), `handoff-stage-move.ts`, aviso ao lead; (ganho) um registro consultável por motivo, o invariante `ai_msgs_after_handoff=0 summary=present assignee=present notify=+1` provável.
Risco: se ADAPTAR mantendo `last_handoff_reason text`, o teste dos 8 motivos passa por string e o `forbidden_request` nasce como mais uma grafia livre.

##### 4. O que muda na Fase 1 (F05-T01/T02)
Não cumpre: tabela `handoffs`; enum de 8 motivos (`forbidden_request` inexistente; `provider_error`, `out_of_knowledge`, `complaint`, `tenant_rule`, `high_risk_action`, `customer_request` inexistentes por esse nome); `last_messages` exatamente 5; `claim → assignee_id`; `notifications +1`; `transition(handoff.requested)` pela máquina de estados de 5.6.

---

#### §5.3 Entitlement / uso de IA

##### 1. O que existe
- **Tabela de uso ativa**: `llm_calls` (`baseline.sql:6630`): `organization_id, contact_id, job_id, variant_id, purpose, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents numeric (null = desconhecido), latency_ms, created_at` + colunas posteriores `status ('ok'|'erro')`, `origem_da_escolha`, `agent_id`, `error_code/error_message` (insert `run-model-call.ts:478-482`; índice parcial `status='erro'` `:11151`). Gravada por: engine `run-model-call.ts:478` (sucesso) e `:445` `registrarFalha` (erro); native `lib/ai/log-invocation.ts:70` (fire-and-forget, `queueMicrotask`).
- **Tabela legada**: `ai_invocations` (`baseline.sql:1084-1104`; `invocation_kind ∈ {bot_respond, sentiment_classify, triage_classify, embedding_generate}`) — ninguém mais insere (comentário `log-invocation.ts:61`), mas o trigger `trg_ai_invocations_budget` (`:2962`) continua definido.
- **Budget por org**: `ai_budgets` (`:1030-1043`: `monthly_limit_cents` default 5000, `action_at_100pct throttle|disable`, `alarm_threshold_pct`, `current_month_consumed_cents`, `is_throttled`, `is_disabled`) + colunas `enforcement_mode ('off'|'avisar'|'bloquear')`, `enforcement_effective_at` (`orcamento.ts:56-57,150-156`). Consumo alimentado pelo trigger `trg_llm_calls_budget` (`baseline.sql:9568-9569`) via `fn_update_budget_consumption` (`:747`, soma `coalesce(NEW.cost_cents,0)`). Gate `aplicarOrcamento` antes de sair byte (`run-model-call.ts:389-401`), kill switch `AI_BUDGET_ENFORCEMENT` (`lib/agent-engine/env.ts:100`), bloqueio vira handoff `orcamento_de_ia` + inbox `budget_exceeded`. Native: `lib/ai/budget/check.ts:161` lê `llm_calls`.
- **Preço por modelo**: código `lib/agent-engine/edge/llm/pricing.ts:15-19` — **só 3 prefixos** (`claude-sonnet-4`, `claude-haiku-4`, `claude-opus-4`); qualquer outro id (OpenAI, Google, OpenRouter `anthropic/...`, `claude-sonnet-5`) → `cost_cents = null` → "não consome teto" (`pricing.ts:9-11`). Tabelas paralelas com preço: `ai_pricing` (`:1178-1186`, versionada, seed embedding `:8112`) e `ai_models.input/output_price_per_million_cents` (`:1164-1165`) — três fontes de preço.
- Não há `entitlement()`/`withEntitlement()`/`Capability`. Grep `\b(plan|quota|credit|allowance)\b` em `lib app workers` (sem tests) = 13 ocorrências fora de um módulo dedicado (invariante §5.3(1) = 0 não vale).

##### 2. Testes
- `test:unit` (19 arquivos com "orcamento"): `tests/unit/orcamento-decisao.test.ts`, `orcamento-chave-de-emergencia.test.ts`, `orcamento-gate-executa-o-veredito.test.ts`, `orcamento-uma-regua-de-gasto.test.ts`, `orcamento-caminho-legado.test.ts`, `handoff-por-orcamento.test.ts`, `api-orcamento-de-ia.test.ts`, `budget-status-medicao.test.ts`, `llm-calls-registra-falha.test.ts`, `log-invocation-classifica-erro.test.ts`, `ai-invocation-sem-agente.test.ts`, `catalogo-de-modelos`/`catalogo-openrouter.test.ts`. Para `edge/llm/pricing`: 1 arquivo.
- `test:db`: `tests/invariants/orcamento-nasce-desarmado.test.ts`, `orcamento-apos-backfill.test.ts`, `catalogo-de-modelos.test.ts`, `catalogo-so-gestor-muda-preco.test.ts`, `ai-purpose-bindings.test.ts`.

##### 3. Classe: **ADAPTAR**
Justificativa: `llm_calls` + trigger de consumo + gate pré-chamada são exatamente `recordUsage` + budget; falta a fachada `withEntitlement/entitlement/Capability`, o `estimated_cost_cents` calculado para todo modelo da Fase 1 (`AI_CHAT_MODEL` OpenAI, D02 — hoje custo null) e uma única fonte de preço.
Risco: se REUTILIZAR sem tocar `pricing.ts`, o piloto com modelo OpenAI grava `cost_cents=null` e o budget nunca morde (G-20 falha silenciosamente); se REFAZER, perde-se o gate testado por 19 arquivos.

##### 4. O que muda na Fase 1 (F01-T0x, F05-T03)
Não cumpre: `Capability` enum de 6; `withEntitlement` como único instanciador do provedor e do `adapter.send`; `ai_usage_events(operation ∈ {chat, embedding, summary})` — embedding não é registrado hoje; `src/entitlement/pricing.ts` com preço por 1k tokens para o modelo escolhido; invariante "saldo antes/depois = chamadas" precisa de custo não-nulo.

---

#### §5.17 Observabilidade

##### 1. O que existe
- **`api_audit_log`** (`baseline.sql:1234-1249`): `organization_id, actor_user_id, actor_api_token_id, acting_as_platform_admin, actor_ip, actor_user_agent, action, resource_type, resource_id, request_id, bypassed_rls, metadata, created_at`; comentário "Append-only. Retenção 5 anos" (`:1255`); policies `audit_log_insert_tenant_member` (INSERT, `:4045`) e `audit_log_select` (admin da org ou platform admin, `:4053`). Sem policy de UPDATE/DELETE (append-only por ausência de policy, não por trigger). Não tem `actor_type {user, ai, automation, system}`, `risk`, `result`.
- **Helper**: `lib/audit/index.ts:49` `audit(entry)` — fire-and-forget, admin client se service role (`:55`), falha vai a `console.error` + Sentry (`:85-98`); vocabulário de `action` em `lib/audit/actions.ts`. `lib/mcp/audit.ts:45` `auditMcpToolCall`. 96 arquivos de teste referenciam `lib/audit`. Escritores: rotas API, MCP (`mcp.tool_called`), handoff native (`orchestrator.ts:264`), LGPD (`lib/lgpd/export-collector.ts:578` lê). O engine **não** escreve em `api_audit_log` (grep em `lib/agent-engine` = só comentário em `mcp-tools.ts:5`; `lib/reports/atividades.ts:18` "o motor do agente escreve por fora").
- **Sentry**: `sentry.server.config.ts:12-20` (`sendDefaultPii:false`, `...sentryScrubHooks`), `sentry.edge.config.ts`, `instrumentation-client.ts:36`. `lib/sentry/scrub.ts:153` `beforeSend`, `:166` `beforeSendTransaction`, `:170` `beforeSendSpan`; abordagem = **denylist/regex** (`scrubMessage` `:52`, `scrubUrl` `:87`, `isSensitiveHeader` "sensível por padrão" `:38-48`), não allowlist de campos que saem. Teste `lib/sentry/scrub.test.ts`, `tests/unit/sentry-comunidade-so-erro.test.ts`.
- **`/api/v1/health`** (`app/api/v1/health/route.ts:265-303`): checks `supabase`, `redis`, `waha` (ok/degraded/down + latência + alvo), `status healthy|degraded|unhealthy`, `version` (`APP_VERSION`, `:298`), HTTP 503 se down. **Sem contadores** (`tenant_ctx_rejected`, `actions_denied`…). Worker: `/healthz` + `/metrics` (`workers/agent-worker/main.ts:175-186`, porta `HEALTH_PORT` 8787) com `metricsSnapshot` (`lib/agent-engine/obs/metrics.ts:179`, cache ratio `:27`).
- **Logger estruturado**: `lib/logger.ts:13-22` (JSON por linha via `console.*`, zero deps, 88 importadores); engine `lib/agent-engine/obs/logger.ts:14-16` (`createLogger`, `withFields` `:30`), regra "PII fora de log" aplicada manualmente (ex.: `human-handoff.ts:215`).

##### 2. Testes
- `test:unit`: `app/api/v1/health/route.test.ts`, `tests/unit/health-separa-env-errado-de-servico-caido.test.ts`, `lib/sentry/scrub.test.ts`, `sentry-comunidade-so-erro.test.ts`, `lib/audit/service-role-configured.test.ts`, `tests/unit/audit-resource-id-e-uuid.test.ts`, `cron-audita-so-quando-ha-efeito.test.ts`, `duplicate-audit-diz-qual-versao.test.ts`, `contato-audit-from-to.test.ts`.
- `test:db`: `tests/invariants/contato-consent-e-auditoria.test.ts`, `rls-isolation.test.ts`, `rls-completude-varredura.test.ts`, `event-log-drain.test.ts`.

##### 3. Classe: **ADAPTAR**
Justificativa: helper único, tabela append-only com `request_id`, Sentry com hooks de scrub, health com checks e logger JSON já existem; falta o modelo `audit_events(actor_type, risk, result)`, os contadores no health, a allowlist com teste "campos capturados/campos existentes" (G-14) e o engine passar a escrever no mesmo registro.
Risco: se REUTILIZAR, `audit_events actor_type=ai = nº de execute()` (§5.8 inv. 2) é impossível porque o motor não audita; se REFAZER, perdem-se 96 arquivos de teste sobre `audit()` e a retenção LGPD.

##### 4. O que muda na Fase 1 (F01-T07, F06-T0x)
Não cumpre: colunas `actor_type/risk/result` (ou tabela `audit_events` nova com view sobre `api_audit_log`); `audit.record()` chamado por Action Policy, Conversation.transition, Identity, Jobs, setSetting; contadores em `/api/v1/health` e no `VERIFY SUMMARY`; allowlist de campos no Sentry com teste de contagem.

---

#### Tabela resumo

| módulo | classe | evidência principal | risco |
|---|---|---|---|
| §5.9 AI Agent | REFAZER (reaproveita `run-model-call.ts` + `providers.ts` como `AIProvider`) | `lib/agent-engine/agent/inbound-turn.ts` = 3391 linhas; `generateText` em `run-model-call.ts:418`; reply é texto livre (`send_message` tool `inbound-turn.ts:154`), sem `confidence` no turno; injeção só por classificador advisório `guardrails/jailbreak/classifier.ts:7`; 2º stack `workers/ai-response-worker.ts:75` selecionado por `AGENT_DISPATCH_CONSUMER` `lib/env.ts:183`; mock só em teste `providers.ts:126` | Adaptar herda dois consumidores de turno e um arquivo onde os invariantes de 5.9 (saída estruturada, tool fora da lista contada, `<customer_message>`) não são prováveis |
| §5.8 Action Policy | CRIAR (e REMOVER o catálogo MCP de 60 tools do caminho da IA) | `TOOL_CATALOG` 60 entradas `lib/mcp/tools/catalogo/index.ts:30-40` só com `risco` (`pacotes.ts:22`), sem `executors/confirmation`; teto 25 `selecao-por-pacote.ts:56`; 12 tools nativas fora do catálogo `inbound-turn.ts:148`; sem `pending_actions` (só `contact_field_proposals` `baseline.sql:11464`); auditoria só do MCP `lib/mcp/audit.ts:45` | Adaptar o catálogo MCP: `toolsFor(ctx,"ai")` nunca dá 9 e `create_order` por IA executa sem confirmação (D17) |
| §5.10 Knowledge/RAG | ADAPTAR | `ai_chunks.embedding vector(1536)` `baseline.sql:1058`; `MODELO_DE_EMBEDDING`/`DIMENSOES=1536` `lib/ai/embeddings/chave.ts:58-59`; RPC `fn_buscar_trechos_das_fontes` filtra `organization_id` `baseline.sql:16644`; worker `workers/rag-indexer.ts:498`, chunk 1600/200 `:220` | Refazer perde reindex versionado e invariante `rag-acervo`; reutilizar mantém `ai_knowledge_sources.agent_id NOT NULL` (`:1113`) e embedding sem `ai_usage_events` |
| §5.11 Handoff | REFAZER (reaproveita silêncio `bot_silenced_until`, resumo e aviso ao lead) | sem tabela `handoffs`; `conversations.last_handoff_reason text` `baseline.sql:1387`; motivo `z.string().max(500)` `human-handoff.ts:236`; union TS de 7 motivos sem enum no banco `orchestrator.ts:35-51`; silêncio `isLeadInHandoff` `inbound-turn.ts:1314`; notificação = `agent_inbox_items` `human-handoff.ts:167-179` ou broadcast `orchestrator.ts:248` | Adaptar mantendo texto livre faz o teste dos 8 motivos passar por string e `forbidden_request` virar mais uma grafia |
| §5.3 Entitlement / uso de IA | ADAPTAR | `llm_calls` `baseline.sql:6630` gravada em `run-model-call.ts:478` e `log-invocation.ts:70`; `ai_budgets` `:1030` + trigger `trg_llm_calls_budget` `:9568`; gate `aplicarOrcamento` `run-model-call.ts:389`; preço só para 3 prefixos Claude `pricing.ts:15-19` (resto = null = não consome teto) | Reutilizar sem tocar `pricing.ts`: modelo OpenAI do piloto grava `cost_cents=null` e o budget nunca morde (G-20) |
| §5.17 Observabilidade | ADAPTAR | `api_audit_log` `baseline.sql:1234-1249` sem `actor_type/risk/result`; helper `lib/audit/index.ts:49`; engine não escreve nela (`lib/reports/atividades.ts:18`); Sentry scrub por denylist `lib/sentry/scrub.ts:153`; `/api/v1/health` só supabase/redis/waha `route.ts:265-303`, sem contadores; logger JSON `lib/logger.ts:13` | Reutilizar: `audit_events actor_type=ai = nº de execute()` impossível; refazer perde 96 testes de `audit()` |

### 2.4 Lote D — CRM Core, TenantConfiguration, Recurring Reminder, API, módulos sem correspondente (relatório integral)


Repositório: `/home/klarosk/projetos/DeskcommCRM`, branch `v2`, HEAD `55826722` (= `c85f7d7` + 1 commit só de docs: `git diff --stat c85f7d7 HEAD` toca apenas `AGENTS.md`, `BUILD-STATE.md`, `docs/**`, `scripts/.gitkeep`). Toda citação abaixo é `arquivo:linha @ c85f7d7` e vale byte-a-byte para a árvore auditada.

Convenções de teste (de `package.json:24-31`): `test:unit` = `vitest run` (config `vitest.config.ts`, exclui `tests/e2e`, `tests/invariants`, `tests/journeys`; 692 arquivos `*.test.ts(x)` no include); `test:db` = `bash scripts/test-db.sh` → Postgres efêmero + `supabase/baseline.sql` install+update + `tests/invariants/**` (156 arquivos, `vitest.db.config.ts`); `test:e2e` = `playwright test` (90 specs em `tests/e2e/`); `test:shell` = 4 scripts em `tests/shell/` + `hostgator-setup-kit/test-validators.sh`.

Fato estrutural que atravessa todos os módulos: o schema real **não** está em `supabase/migrations/` — `00001_initial_schema.sql` tem 43 linhas e só cria extensions (`supabase/migrations/00001_initial_schema.sql:8-10`); as tabelas base (`contacts`, `crm_*`, `orders`, `organizations`) só existem em `supabase/baseline.sql` (18.422 linhas, pg_dump). O `MANIFEST.md` confirma: "a cadeia de `migrations/` não sobe do zero (…) 21 aplicam, 80 falham" (`supabase/migrations/MANIFEST.md:37-39`). A prova de RLS da §5.15 tem de ler `baseline.sql`, não a cadeia.

Não verificado neste lote (G-04): nenhum comando `pnpm` foi executado (restrição do pedido); `N/N` de testes é contagem de arquivos, não de casos verdes; a sub-matriz de RLS por `pg_policies` (F00-T04) não foi consultada em banco.

---

#### 1. §5.5 CRM Core (D22)

##### 1.1 O que existe

| Entidade §5.5 | O que o Deskcomm tem | Evidência @ c85f7d7 | Aderência |
|---|---|---|---|
| `customers` (nome, telefone E.164 único/tenant, e-mail, `company_id`, `recurring`, tags) | `contacts` | `supabase/baseline.sql:1324` (tabela), `:1331` `phone_number`, `:1354` CHECK E.164 `^\+\d{8,15}$`, `:2894` `uniq_contacts_org_phone (organization_id, phone_number) where is_merged_into is null`, `:1343` `tags text[]`, `:1342` `consent jsonb`, `:1350` `force_human` | Parecido. Falta `company_id` e `recurring`. Tem a mais: CPF cifrado (`:1332-1333`), LGPD (`is_anonymized :1338`), fusão (`is_merged_into :1340`, migration `20260904190000_0215_juntar_contatos_duplicados.sql:1-25`) |
| `companies` (razão social, CNPJ, tipo `pj`) | **não existe**. `grep -niE 'CREATE TABLE[^\n]*(compan|empresa)' supabase/baseline.sql` = 0. O único CNPJ do schema é o do tenant (`organizations.cnpj`, `baseline.sql:1730`) | — | Falta |
| `products` (nome, `size numeric`, `unit {ml,l,un,kg}`, `price_cents`) | `catalog_products` (`codigo, nome, descricao, marca, categoria, preco_cents bigint, moeda, custo_cents, controla_estoque, quantidade, ativo, origem, imagem_url`) | `supabase/migrations/20260901120000_0204_catalogo_de_produtos_da_loja.sql:46` (tabela), `:61` `preco_cents bigint not null`, `:62` `moeda`, `:66` `custo_cents`; API `app/api/v1/products/route.ts:31,67` lê `catalog_products`; importador `lib/catalogo/planilha.ts:136` usa `precoParaCentavos` | Parecido. Falta `size`/`unit`. Existe também `nuvemshop_products` (`baseline.sql:1673`, `price_cents :1679`) **sem nenhum escritor** em `lib/ app/ workers/` (grep `from("nuvemshop_products")` = 0) |
| `orders` (`customer_id`, `status draft→confirmed→in_production→delivered/cancelled`, `period_key`, `total_cents`, `source {ui,ai,automation}`) | `orders` **é o espelho de e-commerce**: `external_id text NOT NULL`, `external_provider` CHECK `nuvemshop|vtex|shopify` (`baseline.sql:1715`), `status` CHECK `pending|paid|cancelled|fulfilled|shipped|delivered|refunded` (`:1717`), `total_cents bigint` (`:1704`), `contact_id` nullable (`:1702`) | `baseline.sql:1696-1719`. Leitores TS: 4 (`lib/lgpd/export-collector.ts:448`, `lib/mcp/tools/comercio.ts:39`, `app/api/v1/contacts/[id]/crm-summary/route.ts:92`, `app/api/v1/admin/tenants/[id]/route.ts:81`); **escritores TS: 0**; `insert into orders` em SQL: 0 | Nome ocupado por tabela de semântica incompatível e sem produtor |
| `order_items` | **não existe** (`grep '"order_items"' baseline.sql` = 0) | — | Falta |
| `interactions` (timeline do cliente) | `crm_lead_activities` (`lead_id uuid NOT NULL`, `contact_id` nullable, `type`, `source_module`, `payload`, `actor_kind {user,ai,system,rule,contact}`, `reason`, `evidence`) | `baseline.sql:1405`; `supabase/migrations/20260725010000_0071_crm_lead_activities_barramento.sql:28-38` (`actor_kind`, `reason`); emissor "único" `lib/leads/activity-emitter.ts:116`, mas há inserts diretos em `lib/leads/stage-operations.ts:523`, `lib/ai/handoff/orchestrator.ts:185` (3 escritores, não 1) | Parecido, mas ancorado em **lead**, não em cliente — timeline por contato exige lead |
| `tasks` (título, `due_at`, `assignee_id`, `status {open,done}`) | `crm_tasks` (`title`, `due_date`, `priority`, `status {pending,in_progress,done,cancelled}`, `lead_id`, `contact_id`, `assigned_to → auth.users`) | `supabase/migrations/20260903143000_0210_tarefas_do_crm.sql:39,48,60,68`; API `app/api/v1/tasks/route.ts:68,113` (`requireRole` + `crm_tasks`) | Reaproveitável com mapeamento de enum |
| `notes` | `lead_notes` (por **contato**, write-once, `headline`+`body`+`embedding jsonb`) e `conversation_notes` (por conversa) | `supabase/migrations/20260719000000_0050_agent_harness.sql:408` / `baseline.sql:6845`; `baseline.sql:7641` | Reaproveitável (`lead_notes` já é por `contact_id`) |
| Funil (fora da Fase 1, D05) | `crm_leads` (`value_cents bigint :1452`, `status open/won/lost`), `crm_pipelines` (`vocabulary`, `settings jsonb`), `crm_stages`, `crm_lead_links` (`target_kind` inclui `order`) | `baseline.sql:1441,1477,1497,1424` | Fase 2 (pipeline/oportunidades) |

**Dinheiro:** todas as colunas monetárias de tabelas CRM estão em `_cents` inteiros (`crm_leads.value_cents bigint :1452`, `orders.total_cents bigint :1704`, `catalog_products.preco_cents/custo_cents bigint` 0204:61,66, `nuvemshop_products.price_cents :1679`). Exceções fora do CRM: `cost_cents numeric(10,4)` em `20260505140000_0023_ai_agents_module.sql:259` e `cost_cents numeric` em 0050:206 (custo de IA, tolerância documentada). Parser de reais: `lib/money.ts:22` `parseReaisToCents` (cobre `249,90`, `249.90`, `1.234`, `1.234,56`). **Não existe** teste que varre `information_schema.columns` por colunas monetárias (invariante (1) da §5.5) — `grep -rl "_cents" tests/invariants` acha só usos pontuais (`catalogo-so-gestor-muda-preco`, `orcamento-*`, `rls-isolation`, `vocabulario-banco-x-typescript`).

**Parser de quantidade (invariante 3):** não existe. `lib/followup/parse-count.ts:22` (`parseReplyCount`) lê inteiros 0–99 e palavras pt-BR para o nó `repeat` do follow-up — não cobre `0,5`, `1.000`, `12 un`, `2 cx`. `lib/catalogo/planilha.ts:31` mapeia cabeçalhos "quantidade/estoque/qtd" da planilha, só inteiro.

**Interface §5.5:** `customers.findByPhone` → não há função nomeada; a busca por telefone vive no ingest do WAHA (`idsDoContatoEGemeos` em `lib/channels/contato-por-telefone`, importado em `lib/followup/engine.ts:14`) e em `fn_upsert_wa_contact` (SQL). `customers.get360` → `app/api/v1/contacts/[id]/crm-summary/route.ts:1-60` (leads + orders + activities num pedido só) e `app/api/v1/contacts/[id]/timeline/route.ts:94`. `orders.setStatus` com tabela de transições → não existe (0 escritores em `orders`). `interactions.append` → `lib/leads/activity-emitter.ts:116`, mas com 2 bypasses.

##### 1.2 Testes

- `test:db` (`tests/invariants/`): `lead-activities-barramento.test.ts`, `nascimento-do-lead.test.ts`, `gov-5c-lead-scope.test.ts`, `gov-5e-lead-children-scope.test.ts`, `lead-owner-kind.test.ts`, `catalogo-so-gestor-muda-preco.test.ts`, `lgpd-tarefa-do-contato-anonimizado.test.ts`, `nono-digito-canonico.test.ts`, `rls-isolation.test.ts` (lista fixa `TABLES` que inclui `contacts`, `crm_*`, `orders`).
- `test:unit`: `lib/money.test.ts`, `lib/leads/*.test.ts` (18 arquivos), `lib/contacts/csv.test.ts`, `lib/kanban/*.test.ts`, `lib/catalogo/planilha.test.ts`, `tests/unit/planilha-de-leads.test.ts`, `tests/unit/tarefa-prazo-e-faixa.test.ts`, `tests/unit/tarefas-rota-nao-tem-porta-dos-fundos.test.ts`, `tests/unit/a-planilha-da-loja-vira-catalogo.test.ts`, `tests/unit/leads-import-route.test.ts`, `tests/unit/leads-bulk-assign.test.ts`.
- `test:e2e`: `tests/e2e/conversa-vira-lead.spec.ts`, `pipelines-gestao.spec.ts`, `importar-leads-planilha.spec.ts`, `kanban-owner-filter.spec.ts`, `lote-no-quadro-do-funil.spec.ts`, `escopo-de-funil-do-agente.spec.ts`.
- Cobertura zero: `orders` (só aparece em `rls-isolation`/`rls-completude` e no e2e de "zona de perigo"), `nuvemshop_products`, transições de status de pedido, parser de quantidade.

##### 1.3 Classe: **ADAPTAR**

Justificativa: `contacts`, `catalog_products`, `crm_tasks`, `lead_notes` e `crm_lead_activities` cobrem 5 das 8 entidades com RLS, API e testes já verdes; o que falta (`companies`, `order_items`, pedido com máquina de estados) é acréscimo, não substituição. Sub-classes por entidade (informativas; a linha da matriz é uma só): `customers`=ADAPTAR (`contacts` + `company_id` + `recurring`), `companies`=CRIAR, `products`=ADAPTAR (`catalog_products` + `size`/`unit`), `orders`=REFAZER (ver 1.5), `order_items`=CRIAR, `interactions`=ADAPTAR (`crm_lead_activities` com `lead_id` nullable, ou tabela nova alimentada por gatilho AFTER — F02-T03), `tasks`=ADAPTAR (`crm_tasks`), `notes`=REUTILIZAR (`lead_notes`).

Risco: se a classe for REUTILIZAR, a Fase 1 herda um `orders` que nunca é escrito e cujo CHECK de status rejeita `draft`/`in_production` — o lembrete PJ (F05-T06/T08) não tem onde gravar o pedido; se for REFAZER geral, perdem-se os 9 invariantes de `test:db` e os 6 e2e que provam RLS e escopo de `contacts`/`crm_leads`.

##### 1.4 O que muda na Fase 1

- F02-T01: migration `companies`; `contacts.company_id`, `contacts.recurring`; `catalog_products.size numeric(12,3)`, `unit` CHECK `{ml,l,un,kg}`. Não cumpre hoje: §5.5 "customers (…) `company_id`, `recurring boolean`".
- F02-T02: `orders` + `order_items` com tabela de transições (`draft→confirmed→in_production→delivered`, `cancelled`) e `source {ui,ai,automation}`; conflito de nome com a tabela Nuvemshop (ver 1.5 e §6 Nuvemshop). Não cumpre hoje: invariante (2) "transição ilegal = erro + contador".
- F02-T03: `interactions` por gatilho AFTER (G-57); fechar os 2 bypasses de `activity-emitter` (`stage-operations.ts:523`, `orchestrator.ts:185`). Não cumpre hoje: "`interactions.append` (única escrita na timeline)".
- F02-T04: `withTenant` em `products`, `tasks`, `contacts` (hoje `requireRole` + `createClient` por rota, ex. `app/api/v1/tasks/route.ts:68`).
- F02-T02/F05-T08: parser de quantidade (`0,5`, `1.000`, `12 un`, `2 cx`) — invariante (3), inexistente.
- Teste que varre `information_schema.columns` por `_cents` — invariante (1), inexistente.

##### 1.5 Sete respostas de preservação — sub-entidade `orders` (REFAZER)

1. Problema resolvido: espelhar pedidos de loja (Nuvemshop/VTEX/Shopify) para o painel do contato e para o export LGPD (`baseline.sql:1696-1719`).
2. Quem usa: 4 leitores (`crm-summary/route.ts:92`, `admin/tenants/[id]/route.ts:81`, `lib/mcp/tools/comercio.ts:39`, `lib/lgpd/export-collector.ts:448`); 0 escritores; nenhum tenant da Fase 1 é e-commerce.
3. Dependências: `tenant_integrations` (`baseline.sql:1807`), `crm_lead_links.target_kind='order'` (`:1424`), webhook `app/api/v1/webhooks/nuvemshop/[event]/route.ts:153` (emite `event_log`, não grava `orders`).
4. Testes: nenhum específico; `orders` está em `TABLES` de `tests/invariants/rls-isolation.test.ts` e no sweep `rls-completude-varredura.test.ts` (ambos passam a cobrir a tabela nova sem edição se o nome for mantido).
5. Dependentes: os 4 leitores acima; `lib/mcp/tools/comercio.ts` e `crm-summary` são os únicos com UI.
6. Parte reaproveitável: nome da tabela, `total_cents bigint`, `currency char(3)`, `contact_id`, `is_anonymized` (cascata LGPD `lib/lgpd/redact-cascade.ts:39`), índice/policy de RLS existentes.
7. Ganho real: a Fase 1 ganha a entidade central do lembrete PJ com o nome canônico e uma prova de transições; sem isso `orders` teria de virar `crm_orders` e a §5.5/§5.12 ficariam com dois "pedidos".

---

#### 2. §5.2 TenantConfiguration (D21)

##### 2.1 O que existe

Não há `tenant_settings`, `schema.ts`, `getSetting/setSetting/validateSeed/listSchema`. A configuração por organização vive em três lugares:

1. **Colunas de `organizations`** (`baseline.sql:1725-1750`): `timezone` (`:1732`, default `America/Sao_Paulo`), `locale :1733`, `display_name/legal_name/cnpj :1728-1730`, `rate_limit_rps :1734`, `ai_budget_cents :1735`, `media_retention_days :1736`, `dpo_email :1738`, `privacy_policy_url :1739`, `onboarded_at :1740`, `onboarding_state jsonb :1746`; moeda em `20260904000000_0208_moeda_da_organizacao.sql:54-78`.
2. **`organizations.settings jsonb DEFAULT '{}'`** (`baseline.sql:1737`), sem schema único. Chaves lidas no código (grep `settings(\.|->>')<chave>` em `lib app workers supabase/migrations`, ocorrências): `llm` 20 (`lib/agent-engine/edge/llm/credentials.ts:191,201`; `lib/ai/pontos/resolver.ts:76`), `routing` 13 (`lib/schemas/routing.ts:24` `routingConfigSchema`; `lib/routing/worker.ts:149`), `branding` 10 (`lib/branding/organizacao.ts:73`), `visibility_mode` 7 (`lib/schemas/routing.ts:55`), `ai_dispatch_mode` 5 (`lib/schemas/settings.ts:36` `.catch("native")`), `security` 4 (`app/actions/auth/politicaDeMfa.ts:60`), `canonical_conversation_tags` 2 (`lib/schemas/settings.ts:43`), `campanhas_whatsapp` 2, `atrito` 2 (`app/api/v1/metrics/atrito/route.ts:232`), `realtime` 2, `lost_reasons` 2.
   **Escritores do jsonb (6 caminhos, cada um faz o próprio merge):** `app/actions/settings/updateTenant.ts:56-82`, `app/api/v1/settings/routing/route.ts:127`, `app/api/v1/metrics/atrito/route.ts:232`, `app/actions/settings/updatePipelineConfig.ts:65`, `app/actions/auth/politicaDeMfa.ts:60`, `app/actions/settings/updateMarcaDaOrganizacao.ts:34-36` (via RPC; o próprio arquivo registra "`organizations.settings` já tem TRÊS donos com gates diferentes").
3. **`crm_pipelines.vocabulary` e `crm_pipelines.settings`** (`baseline.sql:1486-1487`): `fields`, `canonical_tags`, `lost_reasons`, `identity_resolution` — configuração por funil, escrita por `updatePipelineConfig.ts:65`.

Zod por escritor, não por chave: `lib/schemas/settings.ts:84` `tenantSchema` (display_name, legal_name, cnpj, timezone, locale, currency, media_retention_days, dpo_email, privacy_policy_url, lost_reasons_extra), `:123` `notificationPrefsSchema` (STUB, comentário `:6`), `:160` `pipelineConfigPatchSchema`, `:187` `platformBrandingSchema`, `:218` `marcaDaOrganizacaoSchema` (só `app_name` + `accent_hex`; **sem `logo_url`** — comentário `:208`), `lib/schemas/routing.ts:24`.

Tela: `app/app/settings/tenant/page.tsx` (organização), `app/app/settings/marca/page.tsx` (marca da org), `app/app/settings/atendimento/page.tsx` (routing), mais 11 páginas em `app/app/settings/*`; admin de plataforma em `app/admin/(protected)/marca/page.tsx` (marca da instalação). Nenhuma tela lista chaves a partir de um schema (`listSchema()` não existe).

Chaves da §5.2 que **não existem** em lugar nenhum: `business.phone/address/hours/delivery_days/delivery_regions/cancellation_policy`, `ai.unknown_answer/confidence_threshold/forbidden_topics/context_budget_tokens` (a IA hoje configura por agente em `ai_agent_versions`, não por tenant), `actions.confirm_from_risk`, `conversation.confirmation_timeout_minutes/auto_resolve_hours`, `handoff.assignment/queue_roles`, `notifications.email.*`, `orders.recurring_reminder`. `branding.name/primary_color` existem como `settings.branding.app_name/accent_hex`; `branding.logo_url` da org não existe (só da instalação, `platform_branding.logo_url`).

##### 2.2 Testes

- `test:unit`: `lib/schemas/_validate.test.ts`, `tests/unit/branding-marca-organizacao.test.ts`, `tests/unit/branding-marca-resolve.test.ts`, `tests/unit/branding.test.ts` (+17 `branding-*`/`marca-*`), `tests/unit/marca-do-produto-nao-se-edita-no-codigo.test.ts`, `lib/catalogo/moeda-da-org.test.ts`.
- `test:db`: `tests/invariants/marca-da-organizacao.test.ts`, `marca-da-instalacao.test.ts`, `marca-logo.test.ts`, `rbac-config-ia-canais.test.ts`.
- `test:e2e`: `tests/e2e/icone-da-marca.spec.ts`, `marca-logo.spec.ts`.
- Não há teste que itere um schema de settings validando default+validador (invariante 1), nem contador `settings_rejected`, nem `validateSeed`.

##### 2.3 Classe: **ADAPTAR**

Justificativa: existe armazenamento por organização com UI, RLS e testes (colunas + `settings jsonb` + 6 escritores validados por Zod), mas falta a fachada única (`getSetting/setSetting`), o schema por chave e a versão; o caminho é criar `tenant_settings` (F01-T05) e passar os 6 escritores pela fachada, mantendo colunas herdadas (`timezone`, `locale`) como leitura legada até migrarem.

Risco: se for REUTILIZAR, `branding` fica com duas fontes (`settings.branding` da org × `tenant_settings.branding`) e o resolvedor de marca (`lib/branding/organizacao.ts:73`) e a tela F02-T08 divergem; se for CRIAR do zero ignorando o jsonb, `settings.llm/routing/security` (39 leituras) continuam fora da fachada e o invariante (4) `grep from('tenant_settings')` passa por vacuidade enquanto o `grep settings->` continua em 6 escritores.

##### 2.4 O que muda na Fase 1

- F01-T05: tabela `tenant_settings(organization_id, key, value, schema_version, source, updated_by, updated_at)` + `src/tenant-config/schema.ts` com as 8 famílias da §5.2; `validateSeed` com sentinela `TODO-DEKA`. Não cumpre hoje: invariantes (1)–(4) inteiras (não há schema, não há tabela).
- F01-T06: `create-tenant.sh` deve gravar `organizations.onboarded_at` (o layout redireciona para `/onboarding` quando nulo — `app/app/layout.tsx:51`) e `timezone` (coluna, não setting).
- F02-T08: tela do tenant_admin gravando por `setSetting`; `updateTenant.ts`, `settings/routing/route.ts`, `metrics/atrito/route.ts`, `politicaDeMfa.ts`, `updatePipelineConfig.ts`, `updateMarcaDaOrganizacao.ts` deixam de fazer merge próprio do jsonb.
- F04-T10: `ai.*` passa de `ai_agent_versions` para Setting (ou o Setting aponta o agente publicado).

---

#### 3. §5.12 Recurring Reminder / automação (D23)

##### 3.1 O que existe (três motores, nenhum é o Job da §5.12)

**a) Motor QUANDO/SE/ENTÃO (Fase 2 por D05):** `automation_rules(trigger_event, conditions jsonb, actions jsonb, is_active default false)` e `automation_rule_runs` — `supabase/migrations/20260717190001_0038_webhooks_automation.sql:23-52` (`is_active default false` em `:31`); motor `lib/automation/engine.ts:1-60` (consome `event_log`, `AUTOMATION_CONSUMER_KEY :25`, anti-loop por `metadata.caused_by_rule`, gatilhos `lead.created|lead.stage_changed|lead.tag_added|contact.tag_added|message.received` em `:27-33`); 7 ações em `lib/automation/actions/` (`add-tag`, `assign-owner`, `call-webhook`, `create-or-move-lead`, `send-ai-message`, `send-whatsapp`, `start-message-flow`); throttle anti-banimento `lib/automation/throttle.ts:1-30` (janela de horário movida para `lib/automation/janela-do-canal.ts`, avaliada no fuso do tenant via `channel_knobs`); API `app/api/v1/automation-rules/**` (5 rotas).

**b) Follow-up flows (grafo, por contato):** `followup_flow_versions/pointers/enrollments/enrollment_events` (`20260721120000_0054_followup_flows.sql:3-64`); unique "1 follow-up vivo por contato na org" `idx_followup_enrollments_one_live (organization_id, contact_id) where status in (active, waiting_reply, paused_handoff)` (`20260722160001_0064_followup_enrollment_exclusivity.sql:40-42`); claim justo entre organizações `fn_claim_due_followup_enrollments` (`20260810122000_0146_claim_justo_entre_organizacoes.sql:51`, cabeçalho `:1-12` mede o starvation que corrige); motor `lib/followup/engine.ts:635` `runFollowupTick`; gatilhos `lib/followup/gatilho-etapa.ts:144`, `gatilho-caso.ts:179`, `reactivity.ts:63`.

**c) Gatilho de silêncio (time-driven):** `lib/followup/silence-sweep.ts:1-40` (cabeçalho) e `:91` `runSilenceSweep` — varre pointers `trigger_config.kind='silence'` de **todas** as orgs, corte `threshold_minutes` (`:129`), idempotência pelo unique acima ("23505 vira skip silencioso"). Chamado no mesmo tick do cron `app/api/v1/cron/followup-flow-worker/route.ts:1-21,38-47` (auth Bearer `INTERNAL_CRON_SECRET|INTERNAL_SECRET`, `:53-58`; enfileira `followup_turn` em `job_queue`). Agendado a cada minuto pelo scheduler self-host `docker/scheduler/entrypoint.sh:61`.

**Peças reaproveitáveis para um Job idempotente por (org, cliente, período):**
- `job_queue` (`20260719000000_0050_agent_harness.sql:36`): `organization_id NOT NULL`, `kind` CHECK `inbound_turn|followup_turn|watchdog|flywheel` (`:40`), `run_after`, `attempts/max_attempts`, `locked_by/locked_at`, dedup `uniq_job_queue_source_event (organization_id, source_event_id)` (`:66`).
- `send_ledger` (`0050:73-93`): `id` é a idempotency_key do envio, `unique (job_id, seq)` (`:93`); `lib/agent-engine/edge/crm/send-message.ts:9-15,88,100` reconcilia por `messages.metadata.idempotency_key` antes de reenviar — é o "exactly-once de intenção" que `execute(…, "send_message", {idempotency_key})` da §5.12 precisa.
- `cron_jobs` (`0050:345`): recorrência por **contato** com `kind {at,every,cron}`, `cron_expr`, `tz` IANA — o único lugar do repo que já avalia hora local por fuso, mas `contact_id NOT NULL` e `job_kind` restrito aos 4 kinds acima.
- Relógio/agendamento: `docker/scheduler/entrypoint.sh:60-84` (21 rotas de cron com cadência), `scripts/dev-crons.ts:14-17` (dev), `vercel.ts:20-24` (Hobby só 1 cron/dia); teste que exige que toda rota de cron esteja agendada: `tests/unit/cron-routes-scheduled.test.ts:1-10`.
- Iteração por tenant: não há `forEachEligibleTenant`; o padrão real é cross-org com fairness (`0146`) ou loop por org dentro do handler (`lib/leads/risk-worker.ts:85-110`).

**O que não existe:** `reminder_runs` (unique `(organization_id, customer_id, period_key)`), `period_key`/ISO week, conceito de cliente PJ recorrente, `cutoff_hours` → `create_task`, `mock_outbox`, tag `awaiting_quantity`.

##### 3.2 Testes

- `test:db`: `tests/invariants/automation-engine.test.ts`, `automation-actions-crud.test.ts`, `automation-send-whatsapp.test.ts`, `automation-start-message-flow.test.ts`, `event-log-drain.test.ts`, `followup-engine.test.ts`, `followup-claim-justo.test.ts`, `followup-silence-sweep.test.ts`, `followup-gatilho-etapa.test.ts`, `followup-reactivity.test.ts`, `followup-reenrollment-apos-conclusao.test.ts`, `followup-agendamento-do-banco.test.ts`, `relogio-do-silencio.test.ts` (19 arquivos `automation*|followup*|relogio*`).
- `test:unit`: `lib/automation/*.test.ts` (6), `lib/followup/*.test.ts` (22), `tests/api/followup-*.test.ts` (4, rodam no vitest raiz), `tests/unit/cron-routes-scheduled.test.ts`, `tests/unit/silencio-*.test.ts` (3), `tests/unit/relogio-hobby-workflow.test.ts`.
- `test:e2e`: `tests/e2e/automacao-diz-a-verdade.spec.ts`, `followup-*.spec.ts` (9), `retorno-anti-morte.spec.ts`, `j20-elegibilidade-followup.spec.ts`.
- `test:shell`: `tests/shell/scheduler-entrypoint.test.sh`.

##### 3.3 Classe: **CRIAR**

Justificativa: nenhum dos três motores é "um Job por (tenant, cliente, período) configurado por Setting" — o motor de regras é event-driven e é Fase 2 por D05; o follow-up é por contato/grafo com idempotência por *estado vivo*, não por período; o silêncio é o inverso do lembrete (reage a ausência, não a calendário). O Job nasce em `src/jobs/registry.ts` (5.13) reaproveitando `job_queue`, `send_ledger`/`send-message.ts`, o scheduler e o padrão de `runSilenceSweep` como esqueleto de `forEachEligibleTenant`.

Risco: se for ADAPTAR o follow-up (enrollment com `trigger_config.kind='weekly'`), o unique "1 follow-up vivo por contato" (0064:40) bloqueia o lembrete de quem está em qualquer outro fluxo e a idempotência por ISO-week não existe — o invariante (1) "Job 2× no mesmo período = +0" falha silenciosamente (skip 23505 sem contagem); se for REUTILIZAR o motor de regras, viola D05 e o cabeçalho da §5.12 ("não é um motor").

##### 3.4 O que muda na Fase 1

- F05-T06: tabela `reminder_runs` (unique `(organization_id, customer_id, period_key)`), handler `orders.recurring_reminder` em `src/jobs/registry.ts`, `forEachEligibleTenant` lendo `tenant_settings.orders.recurring_reminder` e `business.timezone`; hora local por tenant (hoje só `cron_jobs.tz` sabe fuso; o scheduler roda em `TZ=UTC`, `Dockerfile.scheduler:16`). Não cumpre hoje: invariantes (1)–(4) inteiras.
- F05-T07: envio só por `execute(ctx, automation, "send_message")` — hoje `lib/automation/actions/send-whatsapp.ts` e `lib/followup/enviar-texto-fixo.ts` chamam o envio fora de um catálogo.
- F05-T08: `cutoff` → `create_task` em `crm_tasks` (ADAPTAR) uma vez por `reminder_run`.
- `job_queue.kind` CHECK (0050:40) precisa de um valor novo ou o Job usa outra fila; `automation_rules` fica `is_active=false` (default) e o cron `followup-flow-worker` continua agendado sem pointers publicados (0 enrollments) — ou é retirado do `entrypoint.sh`, o que faz `cron-routes-scheduled.test.ts` falhar.

---

#### 4. §5.14 API

##### 4.1 O que existe

- **Envelopes:** `lib/api/wrappers.ts:51` `ok(data, {status, meta, requestId})` → `{data, meta?}`; `:66` `fail(code, message, status, {details, requestId})` → `{error: {code, message, details?}}`; `:89` `noContent`. Header `X-Request-Id` **gerado** (`randomUUID()`) em `:56`, `:81`, `:91` — só ecoa se a rota passar `requestId`. O corpo de erro **não** carrega `request_id` (§5.14 pede `{error:{code,message,request_id}}`; `lib/api/types.ts:9` declara o campo opcional, `wrappers.ts:66-82` não o preenche).
- **Eco do header de entrada:** `proxy.ts:17-18` lê `x-request-id` do request e o põe na resposta do middleware (e na 401 de `:81`); dentro das rotas, só 5 handlers de agenda leem `req.headers.get("x-request-id")` (`app/api/v1/agenda/tipos/route.ts:89,129,165,204`, `agenda/google/desconectar/route.ts:63`); as demais geram novo UUID por rota (ex. `crm-summary/route.ts:29` `randomUUID()`).
- **Códigos:** `lib/api/errors.ts:10` `ApiErrorCodes` (~50 códigos: `invalid_request`, `validation_failed`, `invalid_cursor`, `unauthenticated`, `forbidden_role`, `forbidden_tenant`, `not_found`, `idempotency_conflict :49`, `state_conflict`, `invalid_state_transition :64`, `rate_limited :80`, `internal_error :98`, mais domínio `agenda_*`, `ads_*`). `lib/api/recusa.ts:19` traduz `ApiError` de domínio (`lib/api/types.ts:15`) em `fail`.
- **Contagem:** `find app/api/v1 -name route.ts` = **235** (237 em `app/api`, +`app/api/mcp/route.ts` e `app/api/internal/agents/run/route.ts`). Importam `@/lib/api/wrappers`: **224/235**; os 11 sem wrapper: `team/[user_id]/route.ts`, `team/[user_id]/role/route.ts`, `cron/agenda-google-{sync,push,refresh}/route.ts`, `health/route.ts`, `integrations/nuvemshop/callback/route.ts`, `agenda/google/{connect,callback}/route.ts`, `channel-sessions/[id]/qr/route.ts`, `onboarding/whatsapp/qr/route.ts`. `NextResponse.json(` direto em 6 rotas.
- **Autorização:** `lib/auth/require-role.ts:52` `requireRole(min: Role, {requestId, resource, …})`; roles `viewer|agent|ai_operator|manager|admin` com rank (`lib/auth/types.ts:22-28`) — 5 valores contra os 3 da §5.4 (ADR-003). Chamam `requireRole(` diretamente: **155/235** rotas; 15 rotas delegam a `_handler.ts` (0 deles chama `requireRole` — o gate fica na rota); o restante são 21 crons (Bearer `INTERNAL_SECRET`, ex. `cron/followup-flow-worker/route.ts:53-58`), webhooks, `auth/*`, `health`, `admin/*` (guard de plataforma). **Não existe** teste que enumere as rotas do App Router e exija `requireRole` ou `public_routes.ts` (invariante (1) da §5.4); o único walker de rotas é `tests/unit/cron-routes-scheduled.test.ts` (só `cron/`).
- **Paginação por cursor:** `lib/api/wrappers.ts:19` `CursorMeta {cursor, has_more, total}`; usada em 20 arquivos (`conversations/_handler.ts`, `contacts/_handler.ts`, `leads/_handler.ts`, `messages/_handler.ts`, `audit/route.ts`, `contacts/[id]/timeline`, `leads/[id]/timeline`, `admin/{users,audit,tenants,incidents,lgpd/requests,inbox/conversations}`, `ai/agents/[id]/runs`, `ai/followups/queue`, `lead-captures`).
- **Idempotency-Key:** só `app/api/v1/lgpd/requests/[id]/approve/route.ts:44` (header obrigatório, `:47` `missing_idempotency_key`, tabela `idempotency_keys` `baseline.sql:1549`, `:83,192`). Idempotência de envio vive fora da API (`send_ledger`, §3.1).
- **`organization_id` de body/query:** `searchParams.get("organization_id"|"org_id"|"organizationId")` em `app/api/v1/**` = **0**; `body.organization_id` = **0**; `conversations/[id]/notes/route.ts:122` usa `input.organizationId` vindo de `org.orgId` da sessão (`:96-104`). Exceção: **5 rotas admin** aceitam `tenant_id` na query (`admin/lgpd/requests/route.ts:30,134`, `admin/users/route.ts:14`, `admin/incidents/route.ts:24,92`, `admin/inbox/conversations/route.ts:16,101`, `admin/usage/route.ts:15`; `admin/audit/route.ts:106` por lista) — escopo platform_admin, mas viola o texto literal "nenhuma rota lê `organization_id` (…) da query". 26 arquivos contêm comentários "nunca do body" (grep amplo) — são afirmações, não código.

##### 4.2 Testes

- `test:unit`: `lib/api/client.test.ts` (request-id e idempotência do client), 32 `route.test.ts` colocados em `app/api/v1/**`, `tests/api/followup-*.test.ts` (4), `tests/unit/tarefas-rota-nao-tem-porta-dos-fundos.test.ts`, `tests/unit/leads-import-route.test.ts`, `tests/unit/cron-routes-scheduled.test.ts`.
- `test:db`: `tests/invariants/rls-isolation.test.ts` (lista fixa `TABLES`), `rls-completude-varredura.test.ts:1-14` (sweep por catálogo + prova de policy não sabotada), `gov-hardening-anon-definer.test.ts`, `mcp-nao-alcanca-outro-tenant.test.ts`, `webhooks-rls.test.ts`.
- `test:e2e`: qualquer spec que bate na API (90); nenhum específico de envelope.

##### 4.3 Classe: **REUTILIZAR**

Justificativa: envelope, códigos, `X-Request-Id`, cursor e o gate `requireRole` já são o contrato da §5.14 em 224/235 rotas, com 32 testes de rota e 2 provas de RLS por catálogo; o que falta é pontual e cabe em F01-T07/F02-T04.

Risco: se for ADAPTAR/REFAZER, 235 handlers e 32 testes de rota são tocados sem ganho; se for REUTILIZAR sem as correções abaixo, o teste "handlers = 0 leituras de `organization_id`" da §5.14 falha nas 5 rotas admin e o `request_id` continua fora do corpo do erro.

##### 4.4 O que muda na Fase 1

- F01-T07: `requireRole` passa a aceitar o enum de 3 papéis (ADR-003) e nasce o teste que enumera rotas (`requireRole` ou `public_routes.ts`); as 5 rotas admin com `tenant_id` saem da árvore da Fase 1 ou entram em `public_routes.ts` como `platform_admin` (D05: sem UI de plataforma).
- F02-T04: `withTenant(ctx)` em toda rota CRM (hoje `createClient()` por rota + RLS por JWT, ex. `app/api/v1/tasks/route.ts:31,86`); `fail()` inclui `request_id` no corpo; os 11 handlers sem wrapper migram para `ok/fail`.
- F03-T03/F03-T10: webhook sem credencial → 503 e contador (hoje `cron/*` já faz fail-closed 403 em `followup-flow-worker/route.ts:56-58`; webhooks precisam de verificação).

---

#### 5. Módulos do Deskcomm sem correspondente na §5 (§6.2)

| Módulo | Caminho | Tamanho | Testes | Fase 1 precisa? | Classe |
|---|---|---|---|---|---|
| MCP server | `app/api/mcp/route.ts` (74 l.), `app/api/v1/mcp/tools/route.ts` (58 l.), `lib/mcp/**` (39 arq., 6.365 l.; 33 tools em `lib/mcp/tools/`) | 41 arq. | 10 (`lib/mcp/audit.test.ts`, `lib/mcp/tools/comercio.test.ts`, `tests/invariants/mcp-nao-alcanca-outro-tenant.test.ts`, …) | Não (D05: "API pública fora"; agente interno é `lib/agent-engine`) | **REUTILIZAR sem tocar** |
| Instalador / self-host | `hostgator-setup-kit/` (16 arq., 7.547 l.; `install.sh` 116 KB, `test-validators.sh` 153 KB), `docker-compose.prod.yml` (254 l.; serviços `app, worker, waha, redis, srh, scheduler, caddy` `:14-227`), `Dockerfile.scheduler` + `docker/scheduler/entrypoint.sh:60-84`, `scripts/bootstrap-owner.ts` (255 l.; cria dono + org + `admin` + `platform_admins`, `:1-16`), `lib/instalacao/` (6 arq.), `app/api/v1/system/{instalacao,agent,update,relogio/tick,version}` | ~30 arq. | `pnpm test:shell` (4 em `tests/shell/` + `hostgator-setup-kit/test-validators.sh`), `lib/instalacao/*.test.ts` (3), `tests/unit/cron-routes-scheduled.test.ts`, `tests/unit/relogio-hobby-workflow.test.ts` | Sim para F06 ("sobe de clone limpo por Docker Compose em staging"): compose + scheduler + worker. O kit HostGator e `system/update` (auto-atualização) não | **REUTILIZAR** (compose/scheduler/bootstrap); kit HostGator sem tocar |
| White-label | `lib/branding/` (15 arq., 4.113 l.): resolvedor puro `resolve.ts:316` `resolverMarca` com camadas instalação `:395`/ambiente `:425`/organização `:494`; fonte da org `organizacao.ts:73` (`organizations.settings.branding`); instalação `instalacao.ts:333` (`platform_branding`, singleton `id=1`, `20260813090000_0155_marca_da_instalacao_no_banco.sql:136-150`); envelope `schema.ts:1-60`; upload de logo `app/api/v1/marca/logo/`; telas `app/app/settings/marca/page.tsx`, `app/admin/(protected)/marca/page.tsx` | ~22 arq. | 20 unit (`tests/unit/branding-*.test.ts`, `marca-*.test.ts(x)`), 3 invariants (`marca-da-instalacao`, `marca-da-organizacao`, `marca-logo`), 2 e2e (`icone-da-marca.spec.ts`, `marca-logo.spec.ts`) | Sim (D28: nome, logo, cor por tenant na F01) | **ADAPTAR** |
| Nuvemshop | `lib/nuvemshop/` (4 arq., 430 l.: `api-client.ts:49`, `oauth.ts`, `state.ts`, `config.ts:11-13` com `APP_USER_AGENT` contendo e-mail pessoal), rotas `integrations/nuvemshop/callback`, `webhooks/nuvemshop/[event]` (+3 LGPD: `customer-redact`, `store-redact`, `customer-data-request`), tabelas `tenant_integrations` (`baseline.sql:1807`), `orders` (`:1696`), `nuvemshop_products` (`:1673`, 0 escritores), passo `app/onboarding/connect-nuvemshop/page.tsx`; 35 arquivos não-teste citam `nuvemshop` | ~12 arq. + 3 tabelas | **0** testes diretos (grep `nuvem|integrat` em `*.test.ts` = 0); `orders` só em `rls-isolation`/`rls-completude` | Não (Deka não é e-commerce; bloco 4 de D05 é pedido PJ por WhatsApp) | **REMOVER** (sete respostas em 5.1) |
| LGPD | `lib/lgpd/` (13 arq., 2.444 l.: `export-collector.ts:255` `collectExportData`, `redact-cascade.ts:39` `cascadeRedactContact`, `cascata.ts:117`, `sla.ts`, `pades-signer.ts`, `pdf-renderer.tsx`), rotas `lgpd/{requests,anonymize,requests/[id]/{preview,approve}}` (5) + `admin/lgpd/*` (2), workers `lgpd-export-worker.ts`, `lgpd-redact-worker.ts`, crons `lgpd-sla-watcher`, `data-retention`, `storage-redaction`, tabelas `lgpd_requests` (`baseline.sql:1587`), `idempotency_keys` (`:1549`), `storage_redaction_queue` | ~28 arq. | 17 (`tests/invariants/lgpd-*.test.ts` 5, `agenda-lgpd-alcanca`, `retencao-poda-e-expurgo`; `tests/unit/lgpd-*`/`retencao-*` 9) | Sim: §5.18 "Herdado: exportação e exclusão (a F00 cita rotas e testes)"; F06-T03 as expõe como 2 Actions `high` | **REUTILIZAR** |
| Flywheel (judge/distiller/memória) | `lib/agent-engine/flywheel/live.ts:1-6` (`runFlywheelOnce`), `lib/ai/evolution/aggregate.ts`, `lib/ai/apply-proposal.ts`, `lib/agent-engine/agent/org-memory.ts`, tabelas `flywheel_judge_verdicts` (0050:535), `flywheel_distiller_proposals` (0050:562), `judge_alignment_pool` (0050:584), `org_memory_{versions,pointers,entries}` (`20260724010000_0067_org_memory.sql:5-26`), rotas `ai/evolution`, `ai/agents/[id]/proposals/**`, `ai/memory/**`, telas `app/app/ai/{evolution,memory}`, `scripts/flywheel-judge-live.ts`, loop no worker (`workers/agent-worker/main.ts`), `FLYWHEEL_INTERVAL_MS` (0 = OFF) em `lib/agent-engine/env.ts:195-198` | ~25 arq. + 6 tabelas | 8 arquivos citam `flywheel` (`lib/ai/apply-proposal.test.ts`, `lib/ai/evolution/aggregate.test.ts`, `app/api/v1/ai/evolution/route.test.ts`, …) | Não (§5.9 é um agente por tenant; auto-evolução não está em D05) | **REUTILIZAR sem tocar** (desligado por `FLYWHEEL_INTERVAL_MS=0`) |
| Onboarding wizard | `app/onboarding/` (23 arq., 2.818 l.; 9 páginas: `welcome, connect-whatsapp, connect-nuvemshop, setup-ai, funil, invite-team, testar, done`), `lib/onboarding/` (9 arq.: `passos.ts:1-25` define os passos, `sugerir-funil.ts`, `pacotes-de-funil.ts`), `app/api/v1/onboarding/whatsapp/{qr,session}`, `organizations.onboarding_state jsonb` (`baseline.sql:1746`), `onboarded_at` (`:1740`; redirect em `app/app/layout.tsx:51`), `lib/schemas/onboarding.ts` | ~35 arq. | 10 (`lib/onboarding/*.test.ts` 4, `tests/unit/*onboard*`), e2e `tests/e2e/vps-fresh-onboarding.spec.ts` | Não (D05/F01 "Não entra: onboarding wizard"; F01-T06 cria tenant por seed) | **REUTILIZAR sem tocar** |

##### 5.1 Sete respostas de preservação — Nuvemshop (REMOVER)

1. Problema resolvido: OAuth + webhooks da Nuvemshop para espelhar pedidos/produtos de loja no CRM e atender redact/data-request da plataforma (`lib/nuvemshop/oauth.ts`, `app/api/v1/webhooks/nuvemshop/[event]/route.ts:1-15`).
2. Quem usa: nenhum tenant da Fase 1 (Deka = PJ recorrente por WhatsApp, D05 bloco 4); no repo, 35 arquivos citam o nome, mas o sync de produtos nunca foi implementado (`nuvemshop_products` sem escritor) e o webhook só grava `webhook_events_log` + `emit_event` (`[event]/route.ts:130,153`) — nenhum handler grava `orders`.
3. Dependências: `tenant_integrations` (`baseline.sql:1807`, tokens cifrados por `fn_encrypt_oauth/fn_decrypt_oauth` — funções `security definer` que `scripts/test-db.sh` lista entre as 6 expostas a `anon`), `orders`, `nuvemshop_products`, `crm_lead_links.target_kind='order'`, passo `connect-nuvemshop` do wizard (`lib/onboarding/passos.ts:6-13` já o trata como opcional), env `NUVEMSHOP_*` (`lib/nuvemshop/config.ts:21`).
4. Testes: 0 diretos; indiretos: `rls-isolation.test.ts`/`rls-completude-varredura.test.ts` (tabelas), `lgpd-exporta-o-que-redige.test.ts` (seção `orders` do export).
5. Dependentes: `lib/mcp/tools/comercio.ts:39`, `lib/lgpd/export-collector.ts:448`, `app/api/v1/contacts/[id]/crm-summary/route.ts:92`, `app/api/v1/admin/tenants/[id]/route.ts:81`, `app/onboarding/connect-nuvemshop/page.tsx`, `vercel.ts:11` (comentário).
6. Parte reaproveitável: padrão de OAuth com `state` assinado (`lib/nuvemshop/state.ts`), verificação HMAC de webhook, as 3 rotas LGPD de plataforma (modelo para qualquer marketplace na Fase 2), o nome `orders` e as colunas `total_cents/currency/contact_id/is_anonymized` (§1.5).
7. Ganho real: libera o nome `orders` para a §5.5 sem `crm_orders`; retira 3 tabelas, 5 rotas e 2 `security definer` da prova de RLS/hardening da F01-T03; remove um `APP_USER_AGENT` com e-mail pessoal do código (`lib/nuvemshop/config.ts:13`). Alternativa se o proprietário não aceitar REMOVER: cai para ADAPTAR (renomear `orders`→`ecommerce_orders` e manter o resto congelado), o que custa 4 leitores + 2 testes.

##### 5.2 Notas por módulo REUTILIZAR sem tocar (o que a Fase 1 precisa saber)

- **MCP:** `lib/mcp/auth.ts:93-124` resolve `organization_id` de `api_tokens` — um quarto ponto de entrada de tenant fora dos três da §5.1 (`fromSession/fromJob/fromWebhook`); 16 `.eq("organization_id", …)` em `lib/mcp/tools/*.ts` vão aparecer no grep de F01-T01. As tools escrevem em `crm_leads`/`messages` (`lib/mcp/tools/messages.ts` usa idempotency) fora do catálogo Action Policy (§5.8). Decisão para F01: excluir `lib/mcp/` do grep com ADR ou dar-lhe `fromApiToken`.
- **Instalador:** `scripts/bootstrap-owner.ts` grava role `admin` e `platform_admins` — insumo de ADR-003; `docker-compose.prod.yml:203-212` sobe o `scheduler` que chama 21 crons (`entrypoint.sh:60-84`); crons herdados que a Fase 1 não usa (agenda-google, risk-watcher, contact-avatars…) continuam sendo chamados a cada 1–15 min contra o banco do piloto — ou saem do `entrypoint.sh` (e do `cron-routes-scheduled.test.ts`), ou ficam e a §5.13 "um job run por tenant" não descreve o que roda.
- **Flywheel:** `job_queue.kind='flywheel'` (0050:40) e o loop do worker ficam; `FLYWHEEL_INTERVAL_MS=0` desliga (`env.ts:195-197`). Deve constar do `.env.example` (F01-T09).
- **Onboarding:** `app/app/layout.tsx:51` redireciona para `/onboarding` se `onboarded_at` é nulo — `create-tenant.sh` (F01-T06) precisa preencher `onboarded_at` ou o tenant seedado cai no wizard.
- **White-label (ADAPTAR):** a camada de organização lê `settings.branding.{app_name, accent_hex}` (`lib/branding/organizacao.ts:73`; schema `lib/schemas/settings.ts:218-226`) e **não tem `logo_url`** (`:208`); D28/§5.2 pedem `branding.{name, logo_url, primary_color}` em `tenant_settings`. Muda: `organizacao.ts:73` passa a ler `getSetting(ctx, "branding.*")` e `camadaDaOrganizacao` (`resolve.ts:494`) ganha `logo_url`; o resolvedor puro e os 20 testes unitários ficam. `platform_branding` (instalação) permanece como está (`PLATFORM_NAME` de D28).

---

#### 6. Tabela resumo

| módulo | classe | evidência principal (@ c85f7d7) | risco |
|---|---|---|---|
| §5.5 CRM Core | ADAPTAR | `contacts` `baseline.sql:1324,1354,2894`; `catalog_products` 0204:46,61; `crm_tasks` 0210:39,68; `crm_lead_activities` `baseline.sql:1405` + 3 escritores (`activity-emitter.ts:116`, `stage-operations.ts:523`, `orchestrator.ts:185`); `orders` `baseline.sql:1696-1717` com 0 escritores TS; sem `companies`/`order_items`; sem parser de quantidade | REUTILIZAR deixa o lembrete PJ sem tabela de pedido válida (CHECK de status rejeita `draft`); REFAZER geral joga fora 9 invariantes de RLS/escopo de `contacts`/`crm_leads` |
| §5.2 TenantConfiguration | ADAPTAR | `organizations.settings jsonb` `baseline.sql:1737` sem schema único; 6 escritores com merge próprio (`updateTenant.ts:82`, `settings/routing/route.ts:127`, `metrics/atrito/route.ts:232`, `updatePipelineConfig.ts:65`, `politicaDeMfa.ts:60`, `updateMarcaDaOrganizacao.ts:34`); Zod por escritor `lib/schemas/settings.ts:84,187,218`; nenhuma chave `business.*`, `ai.*`, `handoff.*`, `orders.recurring_reminder` | Duas fontes para `branding` e `timezone` se a fachada não absorver colunas + jsonb; invariante (4) passa por vacuidade enquanto `settings->'llm'` segue lido em 20 lugares |
| §5.12 Recurring Reminder | CRIAR | Três motores existentes, nenhum por (org, cliente, período): `automation_rules` 0038:23-31 (event-driven, `is_active=false`), `followup_enrollments` unique-vivo 0064:40-42, `silence-sweep.ts:91` (time-driven cross-org); peças reutilizáveis `job_queue` 0050:36,66, `send_ledger` 0050:73,93 + `send-message.ts:9-15`, `cron_jobs.tz` 0050:345, `entrypoint.sh:60-84` | ADAPTAR o follow-up faz o unique "1 fluxo vivo por contato" engolir lembretes (skip 23505 sem contagem) e não há ISO-week; REUTILIZAR o motor viola D05 |
| §5.14 API | REUTILIZAR | `wrappers.ts:51,66,56,81` (`ok/fail`, `X-Request-Id`), `errors.ts:10`, 224/235 rotas com wrapper, 155/235 com `requireRole` (`require-role.ts:52`; 5 roles em `types.ts:22`), cursor em 20 arquivos, `Idempotency-Key` só em `lgpd/requests/[id]/approve/route.ts:44`, `organization_id` de body/query = 0, `tenant_id` de query em 5 rotas admin | Sem F01-T07/F02-T04, o teste "handlers leem `organization_id` = 0" falha nas 5 rotas admin, `request_id` fica fora do corpo de erro e não há teste que enumere rotas por `requireRole` |
| MCP server | REUTILIZAR sem tocar | `app/api/mcp/route.ts:1-20`, `lib/mcp/` 39 arq.; `lib/mcp/auth.ts:93-124` resolve tenant por `api_tokens`; 16 `.eq("organization_id")` em tools | F01-T01 (`grep organization_id` = 0 fora do TenantContext) reprova por causa dele se não houver ADR de exclusão ou `fromApiToken` |
| Instalador / self-host | REUTILIZAR | `docker-compose.prod.yml:14-227` (7 serviços), `docker/scheduler/entrypoint.sh:60-84` (21 crons), `scripts/bootstrap-owner.ts:1-16`, `hostgator-setup-kit/` 16 arq., `test:shell` | F06 sem compose reproduz staging à mão; crons herdados rodando a cada minuto contra o banco do piloto sem constar da §5.13 |
| White-label | ADAPTAR | `lib/branding/resolve.ts:316,494` (puro), `organizacao.ts:73` lê `settings.branding`; `marcaDaOrganizacaoSchema` `settings.ts:218-226` sem `logo_url` (`:208`); `platform_branding` 0155:136 | D28 exige logo por tenant; sem adaptar a fonte, F02-T08 grava em `tenant_settings` e a tela continua lendo o jsonb |
| Nuvemshop | REMOVER (7 respostas em 5.1) | `lib/nuvemshop/` 4 arq., 5 rotas, `tenant_integrations` `baseline.sql:1807`, `orders` `:1696` (0 escritores), `nuvemshop_products` `:1673` (0 escritores), 0 testes diretos, e-mail pessoal em `config.ts:13` | Manter ocupa o nome `orders` com semântica de e-commerce e mantém 2 `security definer` expostas a `anon` na prova de hardening; remover sem as 7 respostas cai para ADAPTAR (renomear) |
| LGPD | REUTILIZAR | `lib/lgpd/export-collector.ts:255`, `redact-cascade.ts:39`, 7 rotas, 2 workers, 3 crons, 17 testes | F06-T03 reimplementaria export/apagar que já têm cascata por catálogo e 6 invariantes |
| Flywheel | REUTILIZAR sem tocar | `lib/agent-engine/flywheel/live.ts:1-6`, 6 tabelas (0050:535-584, 0067:5-26), `FLYWHEEL_INTERVAL_MS` `env.ts:195-198` | Ligado por engano gera chamadas de IA fora de `withEntitlement` (§5.3) e propostas que ninguém publica |
| Onboarding wizard | REUTILIZAR sem tocar | `app/onboarding/` 9 páginas, `lib/onboarding/passos.ts:1-25`, `onboarded_at` `baseline.sql:1740` + redirect `app/app/layout.tsx:51` | `create-tenant.sh` sem `onboarded_at` manda o tenant seedado para o wizard |

Contagem deste lote: `reutilizar=6 adaptar=3 refazer=0 criar=1 remover=1` (11 linhas; a sub-entidade `orders` é REFAZER dentro de CRM Core e tem as 7 respostas em 1.5).

## 3. Inventário de env vars (§6.3, F00-T05)

Gerado por `scripts/env-inventory.sh` (pastas em `.envscan-dirs`, 13 entradas). Resultado @ c85f7d7: `vars_no_codigo=94 vars_so_na_doc=12 vars_sem_template=31`. Decisão de formato em `docs/decisions/ADR-004-env-example-template-mais-inventario.md`: o template herdado é preservado e o bloco gerado (só comentários, com arquivo:linha) vai depois do marcador no `.env.example`. Variáveis documentadas sem uso no código: AI_ALLOWLIST_TTL_DAYS APP_LOCALE CODE_OF_CONDUCT EVENT_LOG_DRAIN_BATCH_SIZE EVENT_LOG_DRAIN_IDLE_INTERVAL_MS EVENT_LOG_DRAIN_INTERVAL_MS EVENT_LOG_WORKER_ENABLED META_APP_ID META_WABA_ID SUPABASE_ACCESS_TOKEN WAHA_API_KEY_SHA512 WHATSAPP_RESTART_ALL_SESSIONS .

## 4. Sub-matriz de RLS e grants (§6.2, F00-T04)

Obtida por consulta ao banco de dev com o `baseline.sql` aplicado (não por nome de arquivo). Consultas: `select policyname, tablename, cmd, qual, with_check, roles from pg_policies where schemaname='public'` e a junção `pg_tables × information_schema.columns(organization_id) × pg_policies × role_table_grants(anon, authenticated)`.

**Linha de contagem: `tabelas=117 com_policy=109 sem_policy=8 sem_org_id=10 service_only=4`** (`service_only` = tabelas com `organization_id` e sem grant a `authenticated`: `ad_conversion_dispatches ad_insights_connections ad_platform_connections calendar_oauth_nonces` — marcadas na F01 no manifest de migrations). Vereditos das 162 policies pelo predicado USING: 133 isolam por `organization_id` (`fn_user_org_ids()`), 10 sem USING (só WITH CHECK), 3 só `platform_admin`, 2 por usuário (`auth.uid()`), 2 públicas (`true`), 12 outras (`fn_can_view_*`, `false`, `organization_id IS NULL` — listadas abaixo). Tabelas sem `organization_id` (10): `ai_models ai_pricing organizations platform_admins platform_branding platform_google_oauth system_update_runs system_version user_recovery_codes watchdog_cursors` — candidatas à allowlist `tests/db/global_tables.txt` da F01-T04. Tabelas com `organization_id` e **sem policy** (3): `ad_conversion_dispatches ad_insights_connections ad_platform_connections`. Tabelas com `organization_id` e grant a `anon`: 49 (G-54: revogar na F01-T03).

### 4.1 Policies (162)

| policy | tabela | cmd | USING (literal) | WITH CHECK (literal) | veredito |
|---|---|---|---|---|---|
| tenant_isolation_agent_case_events_insert | agent_case_events | INSERT | `∅` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | ausente (USING vazio) |
| tenant_isolation_agent_case_events_select | agent_case_events | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_agent_cases_all | agent_cases | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_agent_inbox_items_all | agent_inbox_items | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_ai_agent_runs_all | ai_agent_runs | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_ai_agent_versions_select | ai_agent_versions | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_ai_agent_versions_write | ai_agent_versions | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | isola por organization_id |
| tenant_isolation_ai_agents_select | ai_agents | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_ai_agents_write | ai_agents | ALL | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_ai_budgets_select | ai_budgets | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_ai_budgets_write | ai_budgets | ALL | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_ai_chunks_select | ai_chunks | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_ai_chunks_write | ai_chunks | ALL | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_ai_faq_items_select | ai_faq_items | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_ai_faq_items_write | ai_faq_items | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text))` | isola por organization_id |
| tenant_isolation_ai_invocations_all | ai_invocations | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_ai_knowledge_sources_select | ai_knowledge_sources | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_ai_knowledge_sources_write | ai_knowledge_sources | ALL | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)) OR fn_is_platform_admin())` | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_ai_kbv_select | ai_knowledge_versions | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_ai_kbv_write | ai_knowledge_versions | ALL | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | isola por organization_id |
| ai_models_read_all | ai_models | SELECT | `true` | `∅` | pública (true) |
| ai_pricing_public_read | ai_pricing | SELECT | `true` | `∅` | pública (true) |
| tenant_isolation_ai_provider_credentials_select | ai_provider_credentials | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_ai_provider_credentials_write | ai_provider_credentials | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | isola por organization_id |
| tenant_isolation_ai_purpose_bindings_select | ai_purpose_bindings | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_ai_purpose_bindings_write | ai_purpose_bindings | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | isola por organization_id |
| tenant_isolation_ai_router_decisions_all | ai_router_decisions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_ai_router_members_select | ai_router_members | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_ai_router_members_write | ai_router_members | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | isola por organization_id |
| tenant_isolation_ai_routers_select | ai_routers | SELECT | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `∅` | isola por organization_id |
| tenant_isolation_ai_routers_write | ai_routers | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text))` | isola por organization_id |
| audit_log_insert_tenant_member | api_audit_log | INSERT | `∅` | `((organization_id IS NULL) OR (organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | ausente (USING vazio) |
| audit_log_select | api_audit_log | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)))` | `∅` | isola por organization_id |
| api_tokens_admin_only | api_tokens | ALL | `(fn_role_at_least(organization_id, 'admin'::text) OR fn_is_platform_admin())` | `(fn_role_at_least(organization_id, 'admin'::text) OR fn_is_platform_admin())` | isola por organization_id (função própria) |
| attendant_availability_delete | attendant_availability | DELETE | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | `∅` | isola por organization_id |
| attendant_availability_insert | attendant_availability | INSERT | `∅` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | ausente (USING vazio) |
| attendant_availability_select | attendant_availability | SELECT | `(fn_is_platform_admin() OR (organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)))` | `∅` | isola por organization_id |
| attendant_availability_update | attendant_availability | UPDATE | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | isola por organization_id |
| automation_rule_runs_select | automation_rule_runs | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| automation_rules_manager_write | automation_rules | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| automation_rules_select | automation_rules | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_before_send_traces_all | before_send_traces | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| calendar_appointments_select | calendar_appointments | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| calendar_appointments_write | calendar_appointments | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | isola por organization_id |
| calendar_availability_exceptions_select | calendar_availability_exceptions | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| calendar_availability_exceptions_write | calendar_availability_exceptions | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | isola por organization_id |
| calendar_connection_calendars_select | calendar_connection_calendars | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND (EXISTS ( SELECT 1 FROM calendar_connections c WHERE ((c.id ` | `∅` | isola por organization_id |
| calendar_connections_dono_ou_manager_read | calendar_connections | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((user_id = auth.uid()) OR fn_role_at_least(organization_id,` | `∅` | isola por organization_id |
| calendar_event_types_select | calendar_event_types | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| calendar_event_types_write | calendar_event_types | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| calendar_external_events_select | calendar_external_events | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| calendar_oauth_nonces_ninguem_le | calendar_oauth_nonces | SELECT | `false` | `∅` | ninguém (false) |
| catalog_products_select | catalog_products | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| catalog_products_write | catalog_products | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| tenant_isolation_channel_knobs_all | channel_knobs | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_channel_session_health_all | channel_session_health | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| warmup_tenant_isolation_all | channel_session_warmup | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| channel_sessions_tenant_select | channel_sessions | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| channel_sessions_tenant_write | channel_sessions | ALL | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_contact_field_proposals_all | contact_field_proposals | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_contacts_all | contacts | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| cae_insert | conversation_assignment_events | INSERT | `∅` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | ausente (USING vazio) |
| cae_select | conversation_assignment_events | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND (EXISTS ( SELECT 1 FROM conversations c WHERE (c.id = conver` | `∅` | isola por organization_id |
| conversation_notes_select | conversation_notes | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| conversation_notes_write | conversation_notes | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text))` | isola por organization_id |
| conversations_agent_delete | conversations | DELETE | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | `∅` | isola por organization_id |
| conversations_agent_insert | conversations | INSERT | `∅` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | ausente (USING vazio) |
| conversations_agent_update | conversations | UPDATE | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | isola por organization_id |
| conversations_select | conversations | SELECT | `fn_can_view_conversation(organization_id, assigned_to_user_id)` | `∅` | isola por organization_id (função própria) |
| crm_lead_activities_insert | crm_lead_activities | INSERT | `∅` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | ausente (USING vazio) |
| crm_lead_activities_select | crm_lead_activities | SELECT | `(EXISTS ( SELECT 1 FROM crm_leads l WHERE ((l.id = crm_lead_activities.lead_id) AND fn_can_view_lead(l.organization_id, l.owner_user_id))))` | `∅` | isola por organization_id (função própria) |
| crm_lead_links_delete | crm_lead_links | DELETE | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| crm_lead_links_insert | crm_lead_links | INSERT | `∅` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | ausente (USING vazio) |
| crm_lead_links_select | crm_lead_links | SELECT | `(EXISTS ( SELECT 1 FROM crm_leads l WHERE ((l.id = crm_lead_links.lead_id) AND fn_can_view_lead(l.organization_id, l.owner_user_id))))` | `∅` | isola por organization_id (função própria) |
| crm_lead_links_update | crm_lead_links | UPDATE | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_crm_lead_reactivations_all | crm_lead_reactivations | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_crm_lead_risk_states_all | crm_lead_risk_states | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_crm_lead_scores_all | crm_lead_scores | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| crm_leads_delete | crm_leads | DELETE | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text) AND (fn_rol` | `∅` | isola por organization_id |
| crm_leads_insert | crm_leads | INSERT | `∅` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text) AND (fn_rol` | ausente (USING vazio) |
| crm_leads_select | crm_leads | SELECT | `fn_can_view_lead(organization_id, owner_user_id)` | `∅` | isola por organization_id (função própria) |
| crm_leads_update | crm_leads | UPDATE | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text) AND (fn_rol` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text) AND (fn_rol` | isola por organization_id |
| crm_pipelines_manager_write | crm_pipelines | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| crm_pipelines_select | crm_pipelines | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| crm_stages_manager_write | crm_stages | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| crm_stages_select | crm_stages | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| crm_tasks_select | crm_tasks | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| crm_tasks_write | crm_tasks | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'agent'::text)))` | isola por organization_id |
| tenant_isolation_cron_jobs_all | cron_jobs | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_demanda_conversas_all | demanda_conversas | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_demandas_all | demandas | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_disclosure_template_pointers_all | disclosure_template_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_disclosure_template_versions_all | disclosure_template_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| event_log_select | event_log | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_flywheel_distiller_proposals_all | flywheel_distiller_proposals | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_flywheel_judge_verdicts_all | flywheel_judge_verdicts | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_followup_enrollment_events_all | followup_enrollment_events | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_followup_enrollments_all | followup_enrollments | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_followup_flow_pointers_all | followup_flow_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_followup_flow_versions_all | followup_flow_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| idempotency_tenant | idempotency_keys | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| platform_admin_only_incidents | incidents | ALL | `fn_is_platform_admin()` | `fn_is_platform_admin()` | só platform_admin |
| tenant_isolation_job_queue_all | job_queue | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_judge_alignment_pool_all | judge_alignment_pool | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_knowledge_searches_all | knowledge_searches | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_lead_checkpoints_all | lead_checkpoints | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_lead_notes_all | lead_notes | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_lead_state_all | lead_state | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_lead_state_transitions_all | lead_state_transitions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| lgpd_requests_admin_select | lgpd_requests | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)))` | `∅` | isola por organization_id |
| lgpd_requests_admin_write | lgpd_requests | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)))` | isola por organization_id |
| tenant_isolation_llm_calls_all | llm_calls | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| merge_queue_manager_select | merge_queue | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `∅` | isola por organization_id |
| merge_queue_manager_write | merge_queue | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| message_templates_select | message_templates | SELECT | `(((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND ((owner_user_id IS NULL) OR (owner_user_id = auth.uid()))) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| message_templates_write | message_templates | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND (((owner_user_id = auth.uid()) AND fn_role_at_least(organization_id, 'agent'::text)) OR` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND (((owner_user_id = auth.uid()) AND fn_role_at_least(organization_id, 'agent'::text)) OR` | isola por organization_id |
| messages_delete | messages | DELETE | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| messages_insert | messages | INSERT | `∅` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | ausente (USING vazio) |
| messages_select | messages | SELECT | `(fn_is_platform_admin() OR (EXISTS ( SELECT 1 FROM conversations c WHERE (c.id = messages.conversation_id))))` | `∅` | só platform_admin |
| messages_update | messages | UPDATE | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| tenant_isolation_meta_templates_all | meta_templates | ALL | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | `(organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))` | isola por organization_id |
| tenant_isolation_metrics_all | metrics | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| nuvemshop_products_tenant | nuvemshop_products | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| orders_tenant_select | orders | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| orders_tenant_write | orders | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | isola por organization_id |
| org_guardrail_layers_admin_write | org_guardrail_layers | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'admin'::text)))` | isola por organization_id |
| org_guardrail_layers_select | org_guardrail_layers | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| tenant_isolation_org_memory_entries_all | org_memory_entries | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_org_memory_pointers_all | org_memory_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_org_memory_versions_all | org_memory_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| orgs_select | organizations | SELECT | `((id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | só platform_admin |
| orgs_write_platform_admin | organizations | ALL | `fn_is_platform_admin()` | `fn_is_platform_admin()` | só platform_admin |
| tenant_isolation_outbound_copies_all | outbound_copies | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_pacing_ledger_all | pacing_ledger | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| platform_admins_self | platform_admins | SELECT | `fn_is_platform_admin()` | `∅` | só platform_admin |
| tenant_isolation_playbook_pointers_all | playbook_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_playbook_versions_all | playbook_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_promise_table_pointers_all | promise_table_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_promise_table_versions_all | promise_table_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| push_subscriptions_own | push_subscriptions | ALL | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND (user_id = auth.uid()) AND fn_role_at_least(organization_id, 'viewer'::text))` | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND (user_id = auth.uid()) AND fn_role_at_least(organization_id, 'viewer'::text))` | isola por organization_id |
| tenant_isolation_reentry_knob_pointers_all | reentry_knob_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_reentry_knob_versions_all | reentry_knob_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_reentry_template_pointers_all | reentry_template_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_reentry_template_versions_all | reentry_template_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_send_ledger_all | send_ledger | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_skill_activations_all | skill_activations | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| catalog_read_skill_pointers | skill_pointers | SELECT | `(organization_id IS NULL)` | `∅` | isola por organization_id (função própria) |
| tenant_isolation_skill_pointers_all | skill_pointers | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| catalog_read_skill_versions | skill_versions | SELECT | `(organization_id IS NULL)` | `∅` | isola por organization_id (função própria) |
| tenant_isolation_skill_versions_all | skill_versions | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_isolation_storage_redaction_queue_all | storage_redaction_queue | ALL | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | `(organization_id IN ( SELECT fn_user_org_ids.fn_user_org_ids FROM fn_user_org_ids() fn_user_org_ids(fn_user_org_ids)))` | isola por organization_id |
| tenant_integrations_admin_write | tenant_integrations | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| tenant_integrations_select | tenant_integrations | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |
| user_orgs_delete | user_organizations | DELETE | `(fn_role_at_least(organization_id, 'admin'::text) OR fn_is_platform_admin())` | `∅` | isola por organization_id (função própria) |
| user_orgs_insert | user_organizations | INSERT | `∅` | `(fn_role_at_least(organization_id, 'admin'::text) OR fn_is_platform_admin())` | ausente (USING vazio) |
| user_orgs_select | user_organizations | SELECT | `((user_id = auth.uid()) OR fn_role_at_least(organization_id, 'manager'::text) OR fn_is_platform_admin())` | `∅` | por usuário (auth.uid) |
| user_orgs_update | user_organizations | UPDATE | `(fn_role_at_least(organization_id, 'admin'::text) OR fn_is_platform_admin())` | `∅` | isola por organization_id (função própria) |
| recovery_codes_self | user_recovery_codes | ALL | `(user_id = auth.uid())` | `(user_id = auth.uid())` | por usuário (auth.uid) |
| webhook_events_log_tenant_read | webhook_events_log | SELECT | `(fn_is_platform_admin() OR ((organization_id IS NOT NULL) AND (organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids))))` | `∅` | isola por organization_id |
| webhook_lead_captures_manager_read | webhook_lead_captures | SELECT | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `∅` | isola por organization_id |
| webhook_sources_manager_write | webhook_sources | ALL | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | `(fn_is_platform_admin() OR ((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) AND fn_role_at_least(organization_id, 'manager'::text)))` | isola por organization_id |
| webhook_sources_select | webhook_sources | SELECT | `((organization_id IN ( SELECT fn_user_org_ids() AS fn_user_org_ids)) OR fn_is_platform_admin())` | `∅` | isola por organization_id |

### 4.2 Tabelas (117)

| tabela | organization_id | policies | RLS ligada | grants anon/authenticated |
|---|---|---|---|---|
| ad_conversion_dispatches | sim | 0 | sim |  |
| ad_insights_connections | sim | 0 | sim |  |
| ad_platform_connections | sim | 0 | sim |  |
| agent_case_events | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| agent_cases | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| agent_inbox_items | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_agent_runs | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_agent_versions | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_agents | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_budgets | sim | 2 | sim | anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE |
| ai_chunks | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_faq_items | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_invocations | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_knowledge_sources | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_knowledge_versions | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_models | não | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_pricing | não | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_provider_credentials | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_purpose_bindings | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_router_decisions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_router_members | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| ai_routers | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| api_audit_log | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| api_tokens | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| attendant_availability | sim | 4 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| automation_rule_runs | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| automation_rules | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| before_send_traces | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_appointments | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_availability_exceptions | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_connection_calendars | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_connections | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_event_types | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_external_events | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| calendar_oauth_nonces | sim | 1 | sim |  |
| catalog_products | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| channel_knobs | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| channel_session_health | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| channel_session_warmup | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| channel_sessions | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| contact_field_proposals | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| contacts | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| conversation_assignment_events | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| conversation_notes | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| conversations | sim | 4 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_lead_activities | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_lead_links | sim | 4 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_lead_reactivations | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_lead_risk_states | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_lead_scores | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_leads | sim | 4 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_pipelines | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_stages | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| crm_tasks | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| cron_jobs | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| demanda_conversas | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| demandas | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| disclosure_template_pointers | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| disclosure_template_versions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| event_log | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| flywheel_distiller_proposals | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| flywheel_judge_verdicts | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| followup_enrollment_events | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| followup_enrollments | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| followup_flow_pointers | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| followup_flow_versions | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| idempotency_keys | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| incidents | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| job_queue | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| judge_alignment_pool | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| knowledge_searches | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| lead_checkpoints | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| lead_notes | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| lead_state | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| lead_state_transitions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| lgpd_requests | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| llm_calls | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| merge_queue | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| message_templates | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| messages | sim | 4 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| meta_templates | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| metrics | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| nuvemshop_products | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| orders | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| org_guardrail_layers | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| org_memory_entries | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| org_memory_pointers | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| org_memory_versions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| organizations | não | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| outbound_copies | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| pacing_ledger | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| platform_admins | não | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| platform_branding | não | 0 | sim |  |
| platform_google_oauth | não | 0 | sim |  |
| playbook_pointers | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| playbook_versions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| promise_table_pointers | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| promise_table_versions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| push_subscriptions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| reentry_knob_pointers | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| reentry_knob_versions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| reentry_template_pointers | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| reentry_template_versions | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| send_ledger | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| skill_activations | sim | 1 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| skill_pointers | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| skill_versions | sim | 2 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| storage_redaction_queue | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| system_update_runs | não | 0 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| system_version | não | 0 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| tenant_integrations | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| user_organizations | sim | 4 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| user_recovery_codes | não | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| watchdog_cursors | não | 0 | sim | authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| webhook_events_log | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| webhook_lead_captures | sim | 1 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |
| webhook_sources | sim | 2 | sim | anon:DELETE,anon:INSERT,anon:REFERENCES,anon:SELECT,anon:TRIGGER,anon:TRUNCATE,anon:UPDATE,authenticated:DELETE,authenticated:INSERT,authenticated:REFERENCES,authenticated:SELECT,authenticated:TRIGGER,authenticated:TRUNCATE,authenticated:UPDATE |

## 5. `.skip` / `.only`

15 `.skip(`, 0 `.only(` @ c85f7d7 — contados e listados, não removidos (D30). Cada um é `it.skip`/`describe.skip` condicional ou documentado no próprio arquivo; a F01 não os toca.

- `tests/e2e/acervo-de-conhecimento.spec.ts:197`
- `tests/e2e/acervo-de-conhecimento.spec.ts:228`
- `tests/e2e/acervo-de-conhecimento.spec.ts:260`
- `tests/e2e/acervo-de-conhecimento.spec.ts:287`
- `tests/e2e/acervo-de-conhecimento.spec.ts:315`
- `tests/e2e/agenda-conectar-google.spec.ts:126`
- `tests/e2e/agenda-google-volta-do-consentimento.spec.ts:108`
- `tests/e2e/followup-dossie.spec.ts:188`
- `tests/e2e/inbox-responder-citando.spec.ts:104`
- `tests/e2e/inbox-responder-citando.spec.ts:76`
- `tests/e2e/system-update.spec.ts:46`
- `tests/invariants/webhooks-inbound.test.ts:539`
- `tests/journeys/canal-oficial.spec.ts:93`
- `tests/unit/entrega-sem-tela-declara-quem-prova.test.ts:149`
- `tests/unit/entrega-sem-tela-declara-quem-prova.test.ts:57`

## 6. ADRs da F00 (§6.4)

- `docs/decisions/ADR-001-agents-md-herdado.md` — AGENTS.md herdado seção a seção (mantida/mesclada/removida).
- `docs/decisions/ADR-002-dimensao-do-embedding.md` — DIM=1536, `text-embedding-3-small`, **provisório** até a Etapa 5 do dono.
- `docs/decisions/ADR-003-papeis.md` — mapa `platform_admins`/`admin`/`agent` → `platform_admin`/`tenant_admin`/`attendant`; CHECK inalterado.
- `docs/decisions/ADR-004-env-example-template-mais-inventario.md` — formato do `.env.example`.

## 7. Comandos que não rodaram (cinco itens)

| Comando | O que tentei | Por que não rodou | O que era necessário | Alternativa | Impacto |
|---|---|---|---|---|---|
| `pnpm test:integration` (passo 4b) | `pnpm test:integration` | script não existe no `package.json` @ c85f7d7 (`ERR_PNPM_NO_SCRIPT`) | a F03 cria o script (§6.1, AGENTS.md §4) | testes de API/worker com banco hoje vivem em `tests/invariants` (`test:db`) | `integration=pending` no VERIFY SUMMARY até F03 |
| `pnpm test:e2e` (passo 5) | não executado na F00 | exige `next build` + `next start` + Supabase local semeado + `.env.e2e` gerado por `scripts/gerar-env-e2e.sh` (receita de `.github/workflows/e2e.yml`); a F00 escreve só em `docs/`/`scripts/` e não semeia banco | app rodando e seeds | o CI do upstream roda 50 specs contra o mesmo `baseline.sql`; a F02 liga o `e2e` no `verify.sh` (§8.3: obrigatório a partir de F02) | `e2e=pending`; N0 soma só unit + db |
| `pnpm typecheck` sem `NODE_OPTIONS` | `pnpm typecheck` | `FatalProcessOutOfMemory` (exit 134) nesta VPS de 7,8 GB com o Supabase local de pé | heap de 4–5 GB para o `tsc` | `NODE_OPTIONS=--max-old-space-size=5120` (exportado pelo `verify.sh`) | nenhum; registrado para quem reproduzir na própria máquina |

## 8. O que NÃO foi verificado (G-04)

- Nenhum teste E2E foi executado (ver seção 7); a jornada de instalação fresca (`vps-fresh-onboarding`, fora do CI do upstream) continua sem prova.
- Os relatórios das seções 2.1–2.4 foram produzidos por leitura de código (grep/Read), não por execução: contagens de rotas, handlers e policies são de `grep`, e as de policies/tabelas da seção 4 são de consulta ao banco de dev com o `baseline.sql` aplicado — não a um banco de produção do Deskcomm (não existe um; é upstream open-source).
- Os três módulos REUTILIZAR com comando de teste para o dono reproduzir (critério 6.6.3) estão em `BUILD-STATE.md`/commit de fechamento; o dono ainda não os rodou (Etapa 9).
- O baseline "provisório" da Etapa 3 foi medido pelo agente, não pelo dono — o controle independente que a DIRETRIZ pede continua pendente (`baseline_n0_owner` no BUILD-STATE).
- Provedor real de IA, WAHA real, e-mail real, produção, dados reais, restore, teste visual: `NOT VALIDATED (real)` (BUILD-STATE).
- Não foi verificado se o `hostgator-setup-kit` continua funcional depois da mudança do `.env.example` além do que `pnpm test:shell` cobre (que não roda na bateria da §6.1 — o `verify.sh` v0 não o inclui; a F06 decide).
- A branch `v2`/`feat/F00-auditoria` não foi comparada com o `upstream/main` depois de `c85f7d7` (o upstream recebeu push em 07/09 03:20 UTC); a F01 começa com `git fetch upstream` e decide se rebaseia.
