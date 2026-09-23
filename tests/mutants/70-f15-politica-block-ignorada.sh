#!/usr/bin/env bash
# F15-T01 (ADR-037 §3), G-38: a política da organização tem de prevalecer sobre
# o D33 — `block` nega. A mutação faz `modoEfetivo` ignorar a entrada da
# organização (devolve sempre o modo de D33): `create_task` sobrescrito como
# `block` voltaria a `allow`; a unit "block nega e audita" de
# tests/unit/f15-t01-politica-por-acao tem de ficar vermelha. Mutação em
# MEMÓRIA (tests/mutants/f13-unit-mutante.mjs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/actions/politica.ts" \
  --de '  const daOrganizacao = configurable ? politica[nome] : undefined;' \
  --para '  const daOrganizacao = undefined; /* MUTANTE: a organização não manda */' \
  --suite "tests/unit/f15-t01-politica-por-acao.test.ts" \
  --titulo "block nega e audita" \
  --espera "block" \
  --nome "f15-politica-block-ignorada"
