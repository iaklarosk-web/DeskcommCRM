#!/usr/bin/env bash
# F18-T01 (ADR-041 §3), G-38: quem responde ao cliente sai da chave `ai.engine`
# da organização. A mutação faz o roteamento devolver sempre o motor herdado —
# o §B8 de volta, em silêncio; a unit "valor que ninguém reconhece cai no motor
# NOVO" tem de ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/ai/despacho.ts" \
  --de '  return valor === "legacy" ? "legacy" : "saas"; // MUTANT: engine-routing' \
  --para '  return "legacy"; /* MUTANTE: sempre o motor herdado */' \
  --suite "tests/unit/f18-t01-motor-e-freios.test.ts" \
  --titulo "valor que ninguém reconhece cai no motor NOVO, nunca no herdado" \
  --espera "o roteamento caiu no herdado" \
  --nome "f18-roteamento-ignora-a-chave"
