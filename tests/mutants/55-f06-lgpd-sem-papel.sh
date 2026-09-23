#!/usr/bin/env bash
# F06-T03, G-38: só o tenant_admin exporta e apaga um cliente (§5.18, §7.7).
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# O catálogo barra IA e automação pelo executor, mas quem confere o PAPEL do
# humano é o handler (`papel !== "admin"`). A mutação apaga essa conferência:
# qualquer membro com sessão — um `agent`, um `viewer` — passa a poder apagar
# o dossiê inteiro de um cliente. Nada lança, nada muda de tela; a régua de
# RBAC herdada não vê, porque a rota continua pedindo `admin` — e o catálogo
# também é chamado por outros caminhos (MCP, tela futura).
#
# Tem de deixar "papel insuficiente de agent e executor ai são recusados" vermelho em
# tests/integration/f06-lgpd.test.ts.
#
# Mecânica: mutação em MEMÓRIA (plugin de transform), sobre a suíte de
# INTEGRAÇÃO, que precisa do Postgres efêmero. Nenhum arquivo é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/actions/tools/lgpd.ts" \
  --de 'if (papel !== "admin") {' \
  --para 'if (false) { /* MUTANTE: qualquer membro apaga */' \
  --suite "tests/integration/f06-lgpd.test.ts" \
  --titulo "papel insuficiente de agent e executor ai são recusados e contados — nada é lido nem apagado" \
  --espera "denied" \
  --nome "f06-lgpd-sem-papel"
