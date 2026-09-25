# ADR-046 — verify.sh v1.13: F20 no gate com a spec dos convites e a linha `invites:`

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-043](ADR-043-verify-v1.12-F19.md)
e às versões intermediárias. D25 permite mudança no `verify.sh` só por ADR; §8.3
manda acrescentar campos, nunca remover. As decisões de produto da F20 estão em
[ADR-045](ADR-045-F20-convites-curtos-e-membership.md).

## Contexto

`current_phase: F20` cai no `*)` do `case` de `scripts/verify.sh` e sai
`NOT READY`. O que a F20 entrega — um link de convite que cabe no WhatsApp,
revogação que mata o link anterior, aceite que acontece uma vez só, e a empresa
criada para outra pessoa nascendo sem o criador dentro — não é coberto por
nenhum campo do bloco. `admin:` mede o painel do dono da F11 e não sabe dizer
se o convite tem ciclo de vida; `rbac:` conta negações de rota e não distingue
"gerente revoga" de "atendente não revoga".

## Decisão

### 1. F20 entra em `GATED_PHASES` e no FIM de `CLOSING_ORDER`

`F20) CLOSED_E2E=1; EXPECTED_SPECS=18; REPLICABILITY_TENANTS="deka,demo2"`;
`REQUIRED_F20_E2E_SPECS = [...REQUIRED_F19_E2E_SPECS, "tests/e2e/f20-convites.spec.ts"]`;
`EXPECTED_F20_E2E_TESTS = EXPECTED_F19_E2E_TESTS + 5` (91). `CLOSING_ORDER`
recebe `F20` depois de `F19`: `stripe`, `engine`, `channels`, `autonomy`, `crm`,
`billing` e `admin` continuam obrigatórios.

### 2. Linha `invites:` obrigatória a partir da F20

Lida de `metrics/invites.line` (suíte `tests/integration/f20-convites-de-equipe.test.ts`),
`pending` antes da F20 e obrigatória quando `closesAtOrAfter(phase, "F20")`
(`requiresInvites`, marcador `// MUTANT: invites-required`). O nome entra nas
TRÊS listas do `report.mjs` — contrato, leitura (`metrics[name]`) e render —
porque linha gravada e não lida sai `pending` com a suíte verde (lição da F18).

| Campo | Contrato |
|---|---|
| `link_len` | `N/64` — o link do convite cabe em 64 chars (era 559; §B27) |
| `reenvio_revoga` | `1/1` — emitir de novo revoga o convite vivo anterior (D61 b) |
| `aceite` | `1/1` — aceitar cria a membership com o papel do convite |
| `email_apagado_no_aceite` | `1/1` — o e-mail sai da linha no aceite (D61 d) |
| `duas_aceitacoes` | `1/1` — o mesmo convite não é aceito duas vezes |
| `revogado_recusado` | `1/1` — convite revogado não é aceito |
| `pendentes_listados` | `N` — quantos convites vivos a organização tinha ao fim |

### 3. Spec `f20-convites` (5 testes, por tenant do seed)

Cinco jornadas de TELA: (1–2, por tenant) o gerente vê o convite pendente e o
link cabe em 64 chars; (3–4, por tenant) cancelar tira-o da lista e o
`/i/<token>` passa a dizer "cancelado" com essa palavra — dizer "inválido" para
um link revogado pelo administrador esconde o que houve; (5) o painel do dono
lista os convites da empresa, emite outro e o link anterior morre na hora.

**O que NÃO está na spec, e por quê**: a matriz de papéis (gerente gere,
atendente não — D61 c) é medida na integração `f20-rotas-de-convite`, que é
onde este repositório mede papel negado; e o estado "Aguardando aceite" da
lista do `/admin` (D60) depende de uma empresa sem membros, que a fixture da
F11/F12 não produz — fica declarado como não coberto pelo navegador no
FINAL-VALIDATION, medido pelo `typecheck` e pela query filtrada por convite
vivo.

### 4. Mutantes 89–91

| # | Mutante | Quem mata |
|---|---|---|
| 89 | índice do "um vivo por pessoa" deixa de ser parcial | a guarda da migration 9035 (o baseline não aplica) e, se ela sair, a prova do índice |
| 90 | reenviar deixa de revogar | integração "reenviar revoga o anterior e o link antigo para de valer na hora" |
| 91 | criador volta a virar membro de toda empresa | invariante "o criador entrou numa empresa que não é dele" |

### 5. Nada muda no que já existia

`EXPECTED_SPECS` 17 → 18 e `e2e` 86 → 91 por passe; o gate ganha ~5 min. As
linhas `admin:` e `rbac:` seguem com os mesmos contratos — a F20 acrescenta
campo, não reinterpreta nenhum.

## Consequências

- Fase futura que mexer em convite herda `invites:` sem ADR novo (posicional).
- A spec nova entra também na lista `SPECS_PARTE_x` do `.github/workflows/e2e.yml`
  (régua `e2e-cobertura-completa`, que custou o f19-gate-01).

## Data

2026-09-23.
