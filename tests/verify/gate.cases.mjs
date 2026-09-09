import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = process.env.VERIFY_GATE_MODULE ?? path.join(ROOT, "scripts/verify/report.mjs");
const { evaluate, parseSuite, phaseContext, KNOWN_DEBT, render, collect } = await import(pathToFileURL(modulePath).href);
// Identidades históricas, somente como tentativas de regressão contra o gate atual.
const RETIRED_DEBT = [
  { suite: "db", file: "tests/invariants/webhooks-inbound.test.ts", title: "rate limit 429 após estourar a janela — coberto por unit test do fallback in-memory", kind: "skipped" },
  { suite: "unit", file: "tests/unit/agenda-separar-historico.test.tsx", title: "o compromisso EM ANDAMENTO ainda é Próximos — começou, mas não terminou", kind: "expected_failure" },
  { suite: "db", file: "tests/invariants/followup-reactivity.test.ts", title: "STOP alcança também o enrollment PAUSADO MANUALMENTE — opt-out não abre exceção de estado", kind: "expected_failure" },
];
const state = `current_phase: F02
baseline_n0: 7
f00_commit: c85f7d72
baseline_detail: "unit=2/2 db=2/2 e2e=3/3"
| F01 | Fundação | done(verify=2026-09-07 6f7c56fc) |
| F02 | CRM | pending |
`;

function report(rows = []) {
  const all = rows.length ? rows : [{ status: "passed" }, { status: "passed" }];
  const assertionResults = all.map((row, index) => ({ title: `case ${index}`, meta: { verifyExpectedFailure: false }, ...row }));
  return {
    success: !all.some((row) => row.status === "failed"),
    numTotalTests: all.length,
    numPassedTests: all.filter((row) => row.status === "passed").length,
    numFailedTests: all.filter((row) => row.status === "failed").length,
    numPendingTests: all.filter((row) => ["skipped", "pending", "disabled"].includes(row.status)).length,
    numTodoTests: all.filter((row) => row.status === "todo").length,
    numFailedTestSuites: 0,
    testResults: [{ name: path.join(ROOT, "tests/example.test.ts"), status: "passed", assertionResults }],
  };
}
function input() {
  return {
    root: ROOT,
    context: phaseContext(state, "F01"),
    exits: Object.fromEntries(["typecheck", "lint", "build", "shell", "secrets", "unit", "db", "integration"].map((name) => [name, 0])),
    reports: { unit: report(), db: report(), integration: report() },
    testsDeleted: 0, tenantReferences: 0, skipOnlyOccurrences: 15,
    mutants: { killed: 2, total: 2 },
    metrics: {
      isolation: "isolation: tables=110 ops=4 dirs=2 leaks=0 (material_cross_org=86/110)",
      "rls-coverage": "rls-coverage: tables_with_org_id=110 policies_found=106 missing=0 service_only_with_grant=0",
      rbac: "rbac: roles=3 denied_expected=17 denied_actual=17",
      entitlement: "entitlement: usage_events_written=2",
      secrets: "secrets: files_scanned=337 findings=0",
    },
  };
}
function addDebt(data, entry) {
  const existing = data.reports[entry.suite];
  const extra = report([{ title: entry.title, status: entry.kind === "expected_failure" ? "passed" : entry.kind,
    meta: { verifyExpectedFailure: entry.kind === "expected_failure" } }]);
  extra.testResults[0].name = path.join(ROOT, entry.file);
  for (const key of ["numTotalTests", "numPassedTests", "numPendingTests", "numTodoTests"]) existing[key] += extra[key];
  existing.testResults.push(...extra.testResults);
}

test("revalidates F01 without declaring F02 ready or changing current phase", () => {
  const data = input();
  const result = evaluate(data);
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "REVALIDATED (F01)");
  assert.match(render(data, result), /current_phase=F02/);
  assert.match(render(data, result), /e2e=pending/);
  assert.match(render(data, result), /full_n0=pending/);
});
test("refuses revalidation of a phase without a recorded completion", () => {
  assert.throws(() => phaseContext(state, "F02"), /fase concluída/);
});
test("normal F02 does not become ready with F01 evidence", () => {
  const data = input(); data.context = phaseContext(state);
  assert.equal(evaluate(data).exitCode, 1);
});
test("does not invent a phase or comparable baseline", () => {
  assert.throws(() => phaseContext("", "F01"), /current_phase/);
  assert.throws(() => phaseContext(state.replace("unit=2/2", "unit=pending"), "F01"), /Baseline/);
});
test("missing mandatory metric makes otherwise green F01 fail", () => {
  const data = input(); delete data.metrics.rbac;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1);
  assert.ok(result.errors.includes("Métrica obrigatória ausente: rbac"));
});
for (const [name, replacement] of [
  ["isolation", "isolation: tables=110 ops=4 dirs=2 leaks=1"],
  ["isolation", "isolation: tables=0 ops=4 dirs=2 leaks=0"],
  ["rls-coverage", "rls-coverage: tables_with_org_id=109 policies_found=106 missing=0 service_only_with_grant=0"],
  ["rls-coverage", "rls-coverage: tables_with_org_id=110 policies_found=106 missing=1 service_only_with_grant=0"],
  ["rbac", "rbac: roles=3 denied_expected=17 denied_actual=16"],
  ["entitlement", "entitlement: usage_events_written=1"],
  ["secrets", "secrets: files_scanned=337 findings=1"],
  ["secrets", "secrets: files_scanned=0 findings=0"],
  ["rbac", "rbac: roles=3 denied_expected=17 denied_actual=pending"],
]) test(`rejects invalid measurement ${replacement}`, () => {
  const data = input(); data.metrics[name] = replacement;
  assert.equal(evaluate(data).exitCode, 1);
});
test("test deletion, tenant references and a live mutant each fail the gate", () => {
  for (const patch of [{ testsDeleted: 1 }, { tenantReferences: 1 }, { mutants: { killed: 1, total: 2 } }, { mutants: { killed: 0, total: 0 } }]) {
    assert.equal(evaluate({ ...input(), ...patch }).exitCode, 1);
  }
});
test("missing report and contradictory denominators are failures", () => {
  const data = input(); delete data.reports.db;
  assert.equal(evaluate(data).exitCode, 1);
  const inconsistent = report(); inconsistent.numTotalTests = 100;
  assert.throws(() => parseSuite(inconsistent, "unit", ROOT), /inconsistentes/);
});
test("standard JSON without explicit reporter metadata cannot claim functional passes", () => {
  for (const value of [undefined, null, "false", 0]) {
    const ordinaryJson = report();
    ordinaryJson.testResults[0].assertionResults[0].meta = { verifyExpectedFailure: value };
    const data = input(); data.reports.unit = ordinaryJson;
    const result = evaluate(data);
    assert.equal(result.exitCode, 1);
    assert.ok(result.errors.some((error) => error.includes("sem metadata do reporter")));
    assert.match(render(data, result), /unit=pending/);
  }
});
test("process or module failure wins over passed assertions", () => {
  const data = input(); data.exits.db = 1;
  assert.equal(evaluate(data).exitCode, 1);
  data.exits.db = 0; data.reports.db.testResults[0].status = "failed";
  assert.equal(evaluate(data).exitCode, 1);
});
test("real failures and unfinished tests are never inherited debt", () => {
  for (const status of ["failed", "pending", "todo"]) {
    const data = input(); data.reports.db = report([{ status }, { status: "passed" }]);
    assert.equal(evaluate(data).exitCode, 1);
  }
});
test("retired debt cannot return in revalidation or normal readiness", () => {
  assert.deepEqual(KNOWN_DEBT, []);
  for (const entry of RETIRED_DEBT) {
    for (const revalidation of [true, false]) {
      const data = input(); data.context.revalidation = revalidation;
      addDebt(data, entry);
      const result = evaluate(data);
      assert.equal(result.exitCode, 1);
      assert.equal(result.status, "NOT READY");
      assert.equal(result.debt.length, 1);
      assert.ok(result.errors.includes("Dívida nova ou não reconhecida: 1"));
    }
  }
});
test("new skip cannot spend an inherited skip allowance", () => {
  const data = input(); addDebt(data, { ...RETIRED_DEBT[0], title: "a different skipped behavior" });
  assert.equal(evaluate(data).exitCode, 1);
});
test("duplicate inherited debt identity cannot increase the allowance", () => {
  const data = input(); addDebt(data, RETIRED_DEBT[0]); addDebt(data, RETIRED_DEBT[0]);
  assert.equal(evaluate(data).exitCode, 1);
});
test("reduced unit baseline cannot be compensated by new DB tests", () => {
  const data = input(); data.reports.unit = report([{ status: "passed" }]);
  data.reports.db = report([{ status: "passed" }, { status: "passed" }, { status: "passed" }]);
  assert.equal(evaluate(data).exitCode, 1);
});
test("text occurrences are diagnostics, not skipped executed tests", () => {
  const data = input(); data.skipOnlyOccurrences = 42;
  const result = evaluate(data);
  assert.equal(result.exitCode, 0);
  assert.match(render(data, result), /tests_skipped=0/);
  assert.match(render(data, result), /skip_only_occurrences=42/);
});
test("native Vitest reporter distinguishes a passed expected failure and runtime skip", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-reporter-"));
  try {
    const fixture = path.join(dir, "outcomes.test.mjs");
    const config = path.join(dir, "vitest.config.mjs");
    writeFileSync(fixture, `import { it, expect } from ${JSON.stringify(path.join(ROOT, "node_modules/vitest/dist/index.js"))};
it('works', () => expect(1).toBe(1));
it.fails('known defect', () => expect(1).toBe(2));
it.skip('unavailable capability', () => {});
`);
    writeFileSync(config, `export default {test:{environment:'node',include:['**/*.test.mjs']}};`);
    const output = path.join(dir, "outcomes.json");
    const run = spawnSync(process.execPath, [path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "--config", config, "--root", dir,
      "--maxWorkers=1", "--allowOnly=false", "--reporter", path.join(ROOT, "scripts/verify/reporter.mjs"), "--outputFile", output],
    { cwd: ROOT, encoding: "utf8", timeout: 20000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const parsed = parseSuite(JSON.parse(readFileSync(output, "utf8")), "unit", ROOT);
    assert.deepEqual([parsed.passed, parsed.expectedFailures, parsed.skipped, parsed.total], [1, 1, 1, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("inventory failure is pending, never a partial zero", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-inventory-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const gathered = collect(dir, dir, phaseContext(state, "F01"));
    assert.equal(gathered.testsDeleted, null);
    assert.equal(evaluate(gathered).exitCode, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("shell orchestration isolates mutant evidence and honors custom log directory", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-shell-"));
  try {
    for (const sub of ["scripts/verify", "tests/mutants", "src", "bin"]) mkdirSync(path.join(dir, sub), { recursive: true });
    copyFileSync(path.join(ROOT, "scripts/verify.sh"), path.join(dir, "scripts/verify.sh"));
    copyFileSync(modulePath, path.join(dir, "scripts/verify/report.mjs"));
    writeFileSync(path.join(dir, "src/fixture.ts"), "export const fixture = true;\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "src/fixture.ts"], { cwd: dir });
    execFileSync("git", ["-c", "user.name=Gate fixture", "-c", "user.email=gate@example.test", "commit", "-qm", "fixture"], { cwd: dir });
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(path.join(dir, "BUILD-STATE.md"), state.replace("c85f7d72", base));
    writeFileSync(path.join(dir, "scripts/scan-secrets.sh"), "echo 'secrets: files_scanned=1 findings=0'\n");
    writeFileSync(path.join(dir, "tests/mutants/fixture.sh"), 'mkdir -p "$VERIFY_LOG_DIR/metrics"\necho "isolation: tables=110 ops=4 dirs=2 leaks=99" > "$VERIFY_LOG_DIR/metrics/isolation.line"\n');
    const healthy = input().metrics;
    const pnpm = path.join(dir, "bin/pnpm");
    writeFileSync(pnpm, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args[0].startsWith('test:') && args[0] !== 'test:shell') {
  if (!args.includes('--maxWorkers=1') || !args.includes('--allowOnly=false')) process.exit(2);
  const output = args.find(a => a.startsWith('--outputFile='))?.slice('--outputFile='.length);
  if (!output) process.exit(3);
  fs.writeFileSync(output, ${JSON.stringify(JSON.stringify(report()))});
  const metrics = ${JSON.stringify(healthy)};
  for (const [name, line] of Object.entries(metrics)) if (name !== 'secrets') fs.writeFileSync(path.join(process.env.VERIFY_LOG_DIR, 'metrics', name + '.line'), line);
}
`);
    chmodSync(pnpm, 0o755);
    const logs = path.join(dir, "custom evidence");
    const run = spawnSync("bash", ["scripts/verify.sh", "--revalidate", "F01"], {
      cwd: dir, encoding: "utf8", timeout: 15000, env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, VERIFY_LOG_DIR: logs },
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /STATUS: REVALIDATED \(F01\)/);
    assert.doesNotMatch(run.stdout, /leaks=99/);
    const runs = readdirSync(logs);
    assert.equal(runs.length, 1);
    const evidence = path.join(logs, runs[0]);
    assert.match(readFileSync(path.join(evidence, "metrics/isolation.line"), "utf8"), /leaks=0/);
    assert.match(readFileSync(path.join(evidence, "mutants/fixture/metrics/isolation.line"), "utf8"), /leaks=99/);
    assert.equal(JSON.parse(readFileSync(path.join(evidence, "summary.json"), "utf8")).context.active, "F02");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
