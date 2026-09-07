#!/usr/bin/env bash
# Mutante 01 (F01-T11, G-38): policy sabotada TEM de deixar a prova de
# isolamento vermelha. Sabota o molde com uma policy `using (true)` FOR ALL em
# contacts (OR com as policies de tenant existentes → o usuário da org A passa
# a ler/afetar as linhas da org B em contacts: 4 ops × 2 direções = 8 casos
# vermelhos, leaks=8). Morto = este script sai 0.
#
# ⚠️ Vermelho POR VAZAMENTO, não por quebra (corolário do G-04: a primeira
# versão deste script "matava" o mutante com um `vitest: command not found` —
# exit 127 também é ≠ 0). Por isso: (a) roda via pnpm (PATH do .bin), e
# (b) exige VER ≥ 8 casos cross-org reprovando no log. Suíte verde OU vermelho
# sem os 8 casos = mutante vivo = exit 1.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

SABOTAGEM=$(mktemp "${TMPDIR:-/tmp}/mutante-rls.XXXXXX.sql")
LOG=$(mktemp "${TMPDIR:-/tmp}/mutante-rls-log.XXXXXX")
trap 'rm -f "$SABOTAGEM" "$LOG"' EXIT
cat > "$SABOTAGEM" <<'SQL'
-- MUTANTE: abre contacts para qualquer authenticated, cross-org.
create policy mutante_contacts_aberta on public.contacts
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.contacts to authenticated;
SQL

if TEST_DB_POS_BASELINE_SQL="$SABOTAGEM" pnpm test:db -t isolation-varredura > "$LOG" 2>&1; then
  echo "MUTANTE VIVO: a prova de isolamento passou com policy using(true) em contacts" >&2
  exit 1
fi

CASOS_VERMELHOS=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -acE "×.*cross-org afeta 0 linhas" || true)
if [ "$CASOS_VERMELHOS" -lt 8 ]; then
  echo "MUTANTE VIVO: a suíte falhou, mas não pelos vazamentos ($CASOS_VERMELHOS casos cross-org vermelhos; esperava >= 8) — vermelho por quebra não prova a régua" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
exit 0
