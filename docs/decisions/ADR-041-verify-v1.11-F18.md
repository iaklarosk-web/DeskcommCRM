# ADR-041 — verify.sh v1.11: F18 no gate com a spec do motor único, a linha `engine:` e mutantes 77–80

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md),
[ADR-031](ADR-031-verify-v1.6-F11-F12.md), [ADR-033](ADR-033-verify-v1.7-F08.md),
[ADR-035](ADR-035-verify-v1.8-F13.md), [ADR-037](ADR-037-verify-v1.9-F15.md) e
[ADR-039](ADR-039-verify-v1.10-F14.md). D25 permite mudança no `verify.sh` só
por ADR; §8.3 manda acrescentar campos, nunca remover. As decisões de produto
da F18 estão em [ADR-040](ADR-040-F18-motor-unico-de-ia.md).

## Contexto

`current_phase: F18` cai no `*)` do `case` de `scripts/verify.sh` e sai
`NOT READY`. O que a F18 entrega — quem atende o despacho, quais ferramentas a
IA tem, o que acontece com a que falta — não é coberto por nenhum campo do
bloco: `autonomy:` mede a política sobre o catálogo, `channels:` mede o canal,
e nenhuma das duas sabe dizer QUAL motor respondeu.

## Decisão

### 1. F18 entra em `GATED_PHASES` e no FIM de `CLOSING_ORDER`

`F18) CLOSED_E2E=1; EXPECTED_SPECS=16; REPLICABILITY_TENANTS="deka,demo2"`;
`REQUIRED_F18_E2E_SPECS = [...REQUIRED_F14_E2E_SPECS, "tests/e2e/f18-motor-unico.spec.ts"]`;
`EXPECTED_F18_E2E_TESTS = EXPECTED_F14_E2E_TESTS + 7` (79).
`CLOSING_ORDER` recebe `F18` depois de `F14` (`…, "F15", "F14", "F18"`), e
`F18` passa a ser a última da ordem: `admin`, `billing`, `crm`, `autonomy` e
`channels` continuam obrigatórios. A cláusula posicional de `closesAtOrAfter`
não muda (ADR-039 §1).

### 2. Linha `engine:` obrigatória a partir da F18

Lida de `metrics/engine.line` (suíte `tests/integration/f18-motor-unico.test.ts`),
`pending` antes da F18 e obrigatória quando `closesAtOrAfter(phase, "F18")`
(`requiresEngine`, marcador `// MUTANT: engine-required`). Campos e contrato:

| Campo | Contrato |
|---|---|
| `saas_turns` | turnos que o despacho entregou ao turno SaaS com `ai.engine=saas` (> 0) |
| `legacy_turns` | turnos entregues ao motor herdado com `ai.engine=legacy` (> 0: a volta atrás é medida, não declarada) |
| `volta_atras` | `1/1` — a mesma organização atendida pelos dois motores ao trocar a chave |
| `tools_migradas` | `13/13` — cada ação nova responde pelo catálogo, com política e auditoria |
| `fora_do_catalogo_negado` | `1/1` — ferramenta declarada pelo agente e não migrada vira handoff com auditoria (fail-closed, objeção 1) |
| `heranca_prompt` | `1/1` — o `system_prompt` da versão publicada chega ao contexto do turno SaaS (objeção 2) |
| `heranca_acervo` | `1/1` — a busca fica restrita aos `knowledge_source_ids` da versão publicada |
| `policy_approve_pendura` | `1/1` — ação `approve` do catálogo novo pendura na conversa |
| `limite_diario_nega` | `1/1` — o teto da F15 nega ANTES do provedor no caminho do despacho |
| `cancel_allow` | `1/1` — `cancel_appointment` executa sem aprovação (D56) |
| `cancel_passado_negado` | `1/1` — compromisso passado não é cancelável |
| `cancel_auditado` | `1/1` — `action_runs` + `audit_log` para cada cancelamento |
| `auditoria` | `N/N` — toda execução de ação nova auditada |
| `roles_denied` | papel sem permissão recusado nas ações novas |

### 3. Mutantes 77–80

| # | Mutante | Quem mata |
|---|---|---|
| 77 | `requiresEngine` sempre `false` | régua do report: a linha `engine:` deixa de ser exigida na F18 |
| 78 | roteamento ignora `ai.engine` e sempre usa o herdado | `saas_turns`/`volta_atras` |
| 79 | ferramenta fora do catálogo é ignorada em silêncio (sem handoff) | `fora_do_catalogo_negado` |
| 80 | cancelamento aceita compromisso passado | `cancel_passado_negado` |

### 4. `lint:channels` volta ao gate (§B19)

A régua reprova desde a F11 por um arquivo de mock (`conectarCanalMock.ts`) e o
gate não a roda. A T04 conserta o arquivo e o `verify.sh` passa a rodar
`pnpm lint:channels` no passo `lint`. Campo novo: nenhum — o passo já é medido
por `lint=ok`.

## Consequências

- `EXPECTED_SPECS` 15 → 16 e `e2e` 72 → 79 por passe; o gate ganha ~6 min.
- Fase futura que mexer no despacho herda `engine:` sem ADR novo (posicional).
- A linha `engine:` é a primeira que mede QUEM respondeu, não o que foi
  respondido. É ela que fecha o §B8 como fato, e não como intenção.

## Data

2026-09-18.
