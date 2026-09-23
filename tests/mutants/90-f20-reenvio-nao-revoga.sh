#!/usr/bin/env bash
# F20-T02 (ADR-045 §2; D61 b), G-38: "reenviar revoga o anterior" é o que faz um
# link vazado morrer no reenvio. A mutação tira a revogação da emissão; a prova
# nominal tem de ficar vermelha. O fonte real não é alterado — a sabotagem entra
# por `transform` do vitest, e o título do caso é sem parênteses porque `-t` é
# regex (lição da F19).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/f20-reenvio-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/vitest.integration.mutant.config.mjs" <<'EOF'
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.resolve(root, "src/convites/repositorio.ts");
const setupFile = path.resolve(root, "tests/db/banco-limpo-por-arquivo.ts");
const from = "          set revoked_at = now(), revoked_by = $3, revoked_reason = 'reenviado', updated_at = now()\n";
const to = "          set updated_at = now()\n";

const source = readFileSync(target, "utf8");
const sourceHits = source.split(from).length - 1;
if (sourceHits !== 1) {
  throw new Error(`alvo da revogação no reenvio apareceu ${sourceHits} vezes`);
}

export default {
  test: {
    environment: "node",
    include: [path.resolve(root, "tests/integration/**/*.test.ts")],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: [setupFile],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-a-placeholder-1234567890-1234567890",
    },
  },
  resolve: { alias: { "@": root } },
  plugins: [
    {
      name: "f20-reenvio-nao-revoga",
      enforce: "pre",
      transform(code, id) {
        if (path.resolve(id.split("?")[0]) !== target) return;
        const hits = code.split(from).length - 1;
        if (hits !== 1) throw new Error(`alvo da mutação apareceu ${hits} vezes`);
        return { code: code.replace(from, to), map: null };
      },
    },
  ],
};
EOF

title="reenviar revoga o anterior e o link antigo para de valer na hora"
set +e
TEST_DB_SUITE_DIR="$PWD/tests/integration" \
TEST_DB_VITEST_CONFIG="$scratch/vitest.integration.mutant.config.mjs" \
  pnpm exec bash scripts/test-db.sh tests/integration/f20-convites-de-equipe.test.ts \
  -t "$title" --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE VIVO: saída $status; esperava falha de asserção (1)" >&2
  exit 1
fi
if [ ! -s "$scratch/result.json" ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE SEM VEREDITO: vitest saiu 1 sem relatório JSON" >&2
  exit 1
fi

node --input-type=module - "$scratch/result.json" "$title" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const alvo = report.testResults.flatMap((f) => f.assertionResults).filter((t) => t.title === process.argv[3]);
assert.equal(alvo.length, 1, "o relatório não contém exatamente a prova nominal");
assert.equal(alvo[0].status, "failed", "falha não atingiu a prova esperada");
JS
echo 'mutants_killed=1/1 (f20-reenvio-nao-revoga; asserção observada)'
