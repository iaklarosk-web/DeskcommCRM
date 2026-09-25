#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d tests/.mutant-loopback.XXXXXXXX)
trap 'rm -rf "$scratch"' EXIT
python3 - "$scratch" <<'PY'
from pathlib import Path
import sys
target = Path(sys.argv[1])
target.joinpath('loopback-url.ts').write_text('export function isLoopbackHttpUrl(value: string): boolean { return value.startsWith("http://localhost") || value.startsWith("http://127.0.0.1"); }\n')
source = Path('tests/unit/e2e-loopback-url.test.ts').read_text()
target.joinpath('loopback.test.ts').write_text(source.replace('@/tests/lib/loopback-url', './loopback-url'))
PY
if pnpm exec vitest run "$scratch/loopback.test.ts" --maxWorkers=1 --reporter=json --outputFile="$scratch/result.json" >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: hostname remoto aceito por prefixo textual' >&2
  exit 1
fi
python3 - "$scratch/result.json" <<'PY'
import json,sys
report=json.load(open(sys.argv[1]))
target=[t for f in report['testResults'] for t in f['assertionResults'] if t['title']=='recusa domínio disfarçado de prefixo localhost']
assert len(target)==1 and target[0]['status']=='failed'
assert any('AssertionError' in m for m in target[0]['failureMessages'])
print('mutants_killed=1/1 (e2e-loopback; asserção observada)')
PY
