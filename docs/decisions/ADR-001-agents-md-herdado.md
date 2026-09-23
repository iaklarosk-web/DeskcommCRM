# ADR-001 — O que foi mantido, mesclado e removido do AGENTS.md e do docs/current-state.md do Deskcomm

## Contexto
D01 manda auditar o DeskcommCRM em vez de recriar, e o repositório herdado traz um `AGENTS.md` de 18.435 bytes (agora em `docs/migration/AGENTS.deskcomm.md`) e um `docs/current-state.md` de 348 linhas datado de 2026-07-29 (@ `789dfa6`, hoje 1.000+ commits atrás — o próprio arquivo diz que é retrato, não estado). D08 fixa o `AGENTS.md` da raiz em ≤ 9,5 KB. Dois testes herdados leem o `AGENTS.md`: `tests/unit/agents-md-versoes.test.ts` (exige a MAJOR de 8 bibliotecas com rótulo exato) e `tests/unit/documentacao-aponta-para-o-que-existe.test.ts` (todo path entre crases com prefixo `app|lib|docs|scripts|tests|…` e extensão `.ts|.md|.sh|…` tem de existir). D30 proíbe apagar ou afrouxar teste.

## Decisão
O `AGENTS.md` da raiz é o texto da DIRETRIZ §9 (v2) mais uma seção "0. Herdado do Deskcomm" que condensa o que do arquivo antigo continua valendo. `CLAUDE.md` herdado fica intocado como doutrina do código do Deskcomm (nível 3 da hierarquia D09): vale onde não contradiz `AGENTS.md` e `docs/DIRETRIZ.md`. `docs/current-state.md` fica intocado como histórico; o estado atual é `docs/migration/deskcomm-audit.md` (F00) e `BUILD-STATE.md`.

Seção a seção do `AGENTS.md` herdado (linhas de `docs/migration/AGENTS.deskcomm.md` @ `c85f7d7`):

| Seção herdada (linha) | Destino | Onde ficou |
|---|---|---|
| Objetivo do projeto (10) | removida | v2 §1 diz o que este produto é |
| Stack CONFIRMADO (20) | **mantida** (majors + Node/pnpm) | §0, linha "Stack" — formato exigido pelo teste de versões |
| Estrutura que importa (48) | mesclada (6 paths que a Fase 1 toca) | §0 "Paths" |
| Comandos (64) | mesclada | v2 §4 já lista os nomes; §0 acrescenta `gov:verify` não cobre `test:db`/`test:e2e` |
| Padrões de código (115) | mesclada | §0 "Padrões": Zod → guard → `organization_id` → `audit()` → `ok()/fail()`; snake_case; `_cents`; logger; PT-BR |
| Marca própria (125) | mesclada | §0 "Marca": nunca "Deskcomm" em código de usuário; marca vem do banco |
| Diretórios SENSÍVEIS (134) | mesclada | §0 "Sensíveis": `baseline.sql`, migrations aplicadas, `admin.ts`, `public-paths.ts`, `.env*`, revoke de função |
| Arquivos GERADOS (154) | mesclada (1 linha) | §0 |
| Como validar (160) | removida | v2 §9 (DoD) e `verify.sh` substituem |
| Testes existentes (175) | removida | contagens envelhecem; `deskcomm-audit.md` traz as medidas @ commit |
| Limitações conhecidas (195) | removida | viram linhas da matriz de auditoria (F00-T03) |
| Regras de segurança (222) | mesclada | v2 §5 já cobre a maior parte; §0 acrescenta `getUser()` nunca `getSession()`, token só em header, hash SHA256 |
| Packaging (232) | mesclada (2 linhas) | §0 "Packaging" |
| Critério de conclusão (248) | removida | v2 §9 |
| Regra final — não invente (255) | mesclada | §0: marcar CONFIRMADO/INFERIDO |
| Bloco `nextjs-agent-rules` (264) | **mantida** | fim do arquivo; o `next dev` o recria se faltar |

Do `docs/current-state.md`, nada foi copiado: as afirmações são de 2026-07-29 e o arquivo manda remedir. As remedições estão em `docs/migration/deskcomm-audit.md`.

## Alternativas rejeitadas
- Substituir o AGENTS.md inteiro pelo v2, sem a §0: reprova `agents-md-versoes` (8 majors ausentes) e perde as regras do kit self-host que os testes de packaging vigiam.
- Manter os dois arquivos (AGENTS.md herdado + AGENTS-v2.md): dois contratos para o agente é exatamente o defeito que D08 corrige.
- Mesclar o CLAUDE.md também: 18 KB de doutrina útil que os testes citam por nome (`evento-comando-tem-consumidor` cita "anti-pattern nº 3 do CLAUDE.md"); mover quebra ponteiros sem ganho.

## Consequências
- `AGENTS.md` resultante: ver `wc -c AGENTS.md` (teto 9.728 bytes).
- Paths de artefatos que ainda não existem (`verify.sh` antes da F00-T07, `create-tenant.sh` antes da F01, `cases.yaml` antes da F04) aparecem no AGENTS.md sem crase ou sem a extensão dentro da crase, para não virar "ponteiro morto" no teste herdado; quando o arquivo nascer, a crase volta.
- Contradição entre CLAUDE.md e este arquivo é nível (a) da D10: vale o AGENTS.md, e a divergência vira ADR.

## Data
2026-09-07

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-001-agents-md-herdado.md`).
