#!/usr/bin/env bash
# F18-T00 (ADR-041 §3; objeção 1 do contraponto), G-38: ferramenta que o agente
# DECLARA e o catálogo não tem vira handoff com nome, nunca silêncio. A mutação
# faz a fila de espera sair sempre vazia — e aí o descarte volta a ser mudo; a
# unit "fila de espera" tem de ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/ai/heranca.ts" \
  --de '  return heranca.tools_declaradas.filter((nome) => !cobertas.has(nome));' \
  --para '  return []; /* MUTANTE: nada falta, nunca */' \
  --suite "tests/unit/f18-t01-motor-e-freios.test.ts" \
  --titulo "fila de espera: o que a versão declara e o catálogo não cobre aparece" \
  --espera "a ferramenta que falta sumiu em silêncio" \
  --nome "f18-ferramenta-que-falta-em-silencio"
