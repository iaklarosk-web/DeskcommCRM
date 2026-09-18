#!/usr/bin/env bash
# F18-T03 (ADR-041 §3; D56 e), G-38: `cancel_appointment` está em `allow` — a
# IA desmarca sozinha, e a única trava que sobra é não poder desmarcar o que já
# aconteceu. A mutação deixa cancelar o passado; a unit "compromisso passado
# NÃO é cancelável" tem de ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/agenda/marcar.ts" \
  --de '  return inicio.getTime() > agora.getTime(); // MUTANT: cancel-past' \
  --para '  return true; /* MUTANTE: o passado também se desmarca */' \
  --suite "tests/unit/f18-t01-motor-e-freios.test.ts" \
  --titulo "compromisso passado NÃO é cancelável" \
  --espera "o passado foi desmarcado" \
  --nome "f18-cancela-o-passado"
