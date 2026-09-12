# ADR-004 — `.env.example` = template herdado do operador + bloco gerado por grep

## Contexto
D08 e a §6.3 mandam gerar o `.env.example` por grep no código, com `arquivo:linha`. O Deskcomm trata o `.env.example` como artefato de produto: o kit self-host o lê (`hostgator-setup-kit/_common.sh` faz `val="${line#*=}"`), e quatro testes herdados vigiam seu conteúdo — `tests/unit/env-example-sync.test.ts` (toda chave de `lib/env.ts` presente), `tests/unit/env-template-sem-comentario-inline.test.ts` (nenhum `NOME=valor # comentário`), `tests/unit/openrouter-alcance.test.ts` (aviso sobre modelo × ferramentas depois da palavra "openrouter"), `tests/unit/env-vazia-no-exemplo-nao-usa-coalescencia-nula.test.ts`. Um arquivo só com `NOME= # arquivo:linha` reprova o segundo e o terceiro; D30 proíbe afrouxar teste.

## Decisão
`scripts/env-inventory.sh` **não reescreve** o template: acrescenta, depois do marcador `# ==== inventário por grep (scripts/env-inventory.sh, F00-T05) …`, um bloco gerado em que cada variável lida no código recebe uma linha de comentário `# NOME lido em: arquivo:linha[, …]`; a que o template não declara recebe a marca `[sem template]`. O bloco **não cria `NOME=`**: variável presente e vazia no template é contrato do kit, e `tests/unit/env-vazia-no-exemplo-nao-usa-coalescencia-nula.test.ts` reprova `??` sobre ela (medido: acrescentar 30 `NOME=` vazios reprovou esse teste). Reexecutar substitui o bloco (idempotente). Pastas varridas ficam em `.envscan-dirs` (versionado; `.gitignore` ganhou `!.envscan-dirs` porque `.env*` o engolia). Variáveis que só existem no template/docs e não em `process.env` (lidas por compose ou pelo kit, ex.: `WAHA_API_KEY_SHA512`, `EVENT_LOG_*`) ficam listadas no fim do bloco como "documentadas sem uso no código", não são removidas.

## Alternativas rejeitadas
- Arquivo 100 % gerado: reprova dois testes herdados e apaga os avisos que o self-hoster lê.
- Inventário só em `docs/migration/`: cumpre a letra de D08 pela metade (o `.env.example` continuaria sem `arquivo:linha`).

## Consequências
- A prova de F01-T09 (`diff` entre `process.env.X` nas pastas de `.envscan-dirs` e `^NOME=` no `.env.example`) passa a ter dois lados legítimos de diferença: chaves do schema Zod (lidas via `schema.safeParse(process.env)`, não como `process.env.X`) e variáveis de compose/kit. F01-T09 usa a saída de `scripts/env-inventory.sh` (`vars_no_codigo=N`, com as chaves Zod incluídas) como fonte e mantém a lista "documentadas sem uso" como allowlist explícita — a task registra a adaptação da prova no commit.
- Medido em 2026-09-07 @ `c85f7d7`: `vars_no_codigo=94 vars_so_na_doc=12 vars_sem_template=31`. O template herdado já tinha `ANTHROPIC_API_KEY` duplicada e um comentário inline em `OPENROUTER_BASE_URL` (linha 127) — pré-existentes, não tocados.

## Data
2026-09-07

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-004-env-example-template-mais-inventario.md`).
