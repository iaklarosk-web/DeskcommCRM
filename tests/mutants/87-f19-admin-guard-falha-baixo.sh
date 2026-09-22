#!/usr/bin/env bash
# F19-T06 (incidente de produção 21–22/09/2026), G-38: a guarda do /admin tem de
# ESTOURAR quando a consulta a `platform_admins` falha — nunca mandar para
# /admin/forbidden, que acusa falta de permissão e MFA. A mutação volta ao
# comportamento antigo (descartar o erro); a unit "consulta que FALHA estoura
# com auth_permissions_unavailable e NÃO manda para /admin/forbidden" tem de
# ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "lib/auth/requirePlatformAdmin.ts" \
  --de "  if (paErro) {" \
  --para "  if (false) { /* MUTANTE: erro de infra volta a virar Acesso negado */" \
  --suite "tests/unit/f19-t06-admin-guard-falha-alto.test.ts" \
  --titulo "consulta que FALHA estoura com auth_permissions_unavailable e NÃO manda para /admin/forbidden" \
  --espera "NEXT_REDIRECT:/admin/forbidden" \
  --nome "f19-admin-guard-falha-baixo"
