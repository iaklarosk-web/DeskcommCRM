#!/usr/bin/env bash
# Provas negativas F02: truncar centavos e permitir confirmação pela IA reprovam.
# Só cópias temporárias são alteradas; produção permanece intacta.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d tests/.mutant-quantity.XXXXXXXX)
trap 'rm -rf "$scratch"' EXIT
python3 - "$scratch" <<'PY'
from pathlib import Path
import sys
target = Path(sys.argv[1])
source = Path('src/crm/orders/quantities.ts').read_text()
guard = 'if (numerator % SCALE !== 0n) {'
assert source.count(guard) == 1, 'alvo do mutante ausente/ambíguo'
(target/'quantities.ts').write_text(source.replace(guard, 'if (false) {'))
test = Path('tests/unit/crm-pedidos-quantidades.test.ts').read_text()
(target/'quantities.test.ts').write_text(test.replace('@/src/crm/orders/quantities', './quantities'))
source = Path('src/crm/orders/state.ts').read_text()
guard = 'if (executor !== "human") {'
assert source.count(guard) == 1, 'alvo do mutante de executor ausente/ambíguo'
(target/'state.ts').write_text(source.replace(guard, 'if (false) {'))
test = Path('tests/unit/crm-pedidos-estados.test.ts').read_text()
(target/'state.test.ts').write_text(test.replace('@/src/crm/orders/state', './state'))
PY
if pnpm exec vitest run "$scratch/quantities.test.ts" "$scratch/state.test.ts" --maxWorkers=1 --reporter=json --outputFile="$scratch/result.json" >"$scratch/result.log" 2>&1; then
  echo 'MUTANTES VIVOS: truncamento de centavos e confirmação pela IA' >&2
  exit 1
fi
python3 - "$scratch/result.json" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
for target in ['não escolhe arredondamento para meio centavo', 'IA e automação não confirmam nem entregam pedidos']:
    tests = [t for f in report['testResults'] for t in f['assertionResults'] if t['title'] == target]
    assert len(tests) == 1 and tests[0]['status'] == 'failed', 'falha não atingiu a prova esperada'
    assert any('AssertionError' in message for message in tests[0]['failureMessages']), 'não foi falha de asserção'
print('mutants_killed=2/2 (crm-quantidade/estado; duas asserções observadas)')
PY
