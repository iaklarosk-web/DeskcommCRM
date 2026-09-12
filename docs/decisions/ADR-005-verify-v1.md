# ADR-005 — verify.sh v1: campos da F01, métricas gravadas pelas suítes, mutante de RLS

## Contexto
O v0 (F00-T07) rodava build/lint/typecheck/unit/db e imprimia todo o resto `pending`. A F01 criou os mecanismos que faltavam — `test:integration` (T02), as provas de isolamento e catálogo de RLS (T03/T04), a matriz RBAC (T07), o entitlement (T08) e o scanner de segredos (T10) — e o DoD da F01-T11 exige o bloco com os campos da fase preenchidos, mais um mutante que prove que a régua de isolamento reprova sabotagem (G-38). Dois fatos medidos moldaram o desenho: o reporter do vitest em CI engole `console.log` de teste que passa (a linha do VERIFY impressa pela suíte não chega ao log), e esta VPS de 7,9 GB mata a suíte sem teto de workers.

## Decisão
1. **As linhas de métrica vêm das próprias suítes, por arquivo.** Cada suíte que produz uma linha do VERIFY (`isolation`, `rls-coverage`, `rbac`, `entitlement`) a grava em `.verify-logs/metrics/<nome>.line` via `tests/lib/verify-metrics.ts` (best-effort: teste nunca falha por métrica). O verify.sh apaga `metrics/` no início e lê depois das suítes — a linha é SEMPRE do run que ele disparou; linha ausente imprime o `pending` da grafia. Alternativa rejeitada: recalcular os números no shell (duplicaria as consultas das provas e derivaria em silêncio).
2. **`test:integration` entra nos obrigatórios** quando o script existe (has_script, como no v0).
3. **`secrets:` vem de `scripts/scan-secrets.sh`** — a linha e o exit (findings>0 OU fixture negativa não pega = 1, G-51).
4. **Mutantes**: mantido o contrato do v0 (`tests/mutants/*.sh`; morto = sai 0). O primeiro mutante existe agora: `01-rls-policy-desabilitada.sh` aplica `using (true)` em contacts via o gancho `TEST_DB_POS_BASELINE_SQL` de scripts/test-db.sh (sabotagem no MOLDE, depois do baseline) e espera a isolation-varredura vermelha — leaks em 4 ops × 2 direções.
5. **Teto de vitest no próprio verify** (`VITEST_MAX_THREADS/FORKS=2`, sobrescrevível): a régua tem de rodar nesta máquina sem OOM.
6. **STATUS**: `READY (F01)` quando todos os obrigatórios com mecanismo passam; F02+ continua `NOT READY` até a fase criar seus campos.

## Alternativas rejeitadas
- Parsear o stdout do vitest atrás das linhas: o reporter as engole (medido em 2026-09-07); grep sobre o que não existe.
- Rodar o mutante fora do verify: mutante que não roda no gate é mutante decorativo — exatamente o que G-38 proíbe.

## Consequências
- O verify completo passa a custar ~50–60 min nesta VPS (unit+db+integration+mutante). O mutante domina; se virar dor, a saída é rodá-lo com `-t isolation-varredura` (já é) ou paralelizar o container, nunca removê-lo.
- D25 segue: o dono ainda não congelou o verify.sh; quando congelar, mudanças futuras passam a exigir ADR novo.

## Data
2026-09-07

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-005-verify-v1.md`).
