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
const helperPath = path.join(path.dirname(modulePath), "f02-e2e.mjs");
const {
  EXPECTED_F02_E2E_TESTS,
  EXPECTED_F03_E2E_TESTS,
  EXPECTED_F04_E2E_TESTS,
  EXPECTED_F05_E2E_TESTS,
  REQUIRED_F02_E2E_SPECS,
  REQUIRED_F03_E2E_SPECS,
  REQUIRED_F04_E2E_SPECS,
  REQUIRED_F05_E2E_SPECS,
  compareF02Inputs,
  snapshotF02Inputs,
  verifyF02Sandbox,
} = await import(pathToFileURL(helperPath).href);
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
const F02_SPEC_COUNTS = [1, 2, 2, 2, 3, 1, 2];
// ADR-018: F03 acrescenta a spec de inbox com 14 testes (7 ações x 2 tenants).
const F03_SPEC_COUNTS = [...F02_SPEC_COUNTS, 14];
function playwrightReport({ actual = false, specs = REQUIRED_F02_E2E_SPECS, counts = F02_SPEC_COUNTS, total = EXPECTED_F02_E2E_TESTS } = {}) {
  const suites = specs.map((requiredFile, fileIndex) => {
    const file = path.basename(requiredFile);
    return {
      title: file,
      file,
      line: 0,
      column: 0,
      specs: Array.from({ length: counts[fileIndex] }, (_, testIndex) => ({
        title: `jornada ${fileIndex + 1}.${testIndex + 1}`,
        ok: true,
        id: `f02-${fileIndex + 1}-${testIndex + 1}`,
        file,
        line: 10 + testIndex,
        column: 1,
        tags: [],
        tests: [{
          timeout: 30_000,
          annotations: [],
          expectedStatus: "passed",
          projectName: "chromium",
          projectId: "chromium",
          status: "expected",
          results: actual ? [{ status: "passed", retry: 0, error: undefined, errors: [], annotations: [] }] : [],
        }],
      })),
    };
  });
  return {
    config: {
      workers: 1,
      fullyParallel: false,
      forbidOnly: true,
      rootDir: path.join(ROOT, "tests/e2e"),
      projects: [{ name: "chromium", id: "chromium", retries: 0, repeatEach: 1, testDir: path.join(ROOT, "tests/e2e") }],
    },
    suites,
    errors: [],
    stats: actual
      ? { expected: total, unexpected: 0, flaky: 0, skipped: 0 }
      : { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
  };
}
function f02Input() {
  const data = input();
  data.context = phaseContext(state);
  Object.assign(data.exits, { "inputs-before": 0, sandbox: 0, "e2e-plan": 0, e2e: 0, inputs: 0 });
  data.reports["e2e-plan"] = playwrightReport();
  data.reports.e2e = playwrightReport({ actual: true });
  data.sandbox = {
    ok: true,
    sandbox: "f02-crm-cadastros-disposable",
    api: "loopback:55421",
    database: "loopback:55422/postgres",
    app: "loopback:3102",
    providers: { whatsapp: "mock", ai: "mock" },
    credentials: { anon: "present", service_role: "present" },
  };
  data.inputs = {
    ok: true,
    algorithm: "sha256",
    files_before: 321,
    files_after: 321,
    hash_before: "a".repeat(64),
    hash_after: "a".repeat(64),
  };
  return data;
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
test("F02 becomes ready only with 13 clean tests from all seven explicit specs", () => {
  const data = f02Input();
  const result = evaluate(data);
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "READY (F02)");
  assert.deepEqual([result.suites.e2e.passed, result.suites.e2e.total], [13, 13]);
  assert.match(render(data, result), /e2e=13\/13/);
  assert.match(render(data, result), /specs=7\/7/);
  assert.match(render(data, result), /full_n0=pending/);
  assert.match(render(data, result), /e2e_scope: F02-required passed=13\/13 specs=7\/7/);
});
for (const missing of REQUIRED_F02_E2E_SPECS) test(`F02 rejects missing required spec ${missing}`, () => {
  const data = f02Input();
  data.reports.e2e.suites = data.reports.e2e.suites.filter((suite) => suite.file !== path.basename(missing));
  assert.equal(evaluate(data).exitCode, 1);
});
test("F02 rejects a filtered run even when every executed test passed", () => {
  const data = f02Input();
  data.reports.e2e.suites[1].specs.pop();
  data.reports.e2e.stats.expected--;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1);
  assert.ok(result.errors.some((error) => /execução parcial/.test(error)));
});
test("F02 compares complete test titles and identities with the unfiltered inventory", () => {
  const data = f02Input();
  data.reports.e2e.suites[0].specs[0].title = "mesmo teste selecionado por outro título";
  assert.equal(evaluate(data).exitCode, 1);
});
test("F02 rejects skip, failure, retry and flaky Playwright evidence", () => {
  const mutations = [
    (report) => {
      const test = report.suites[0].specs[0].tests[0];
      test.expectedStatus = "skipped"; test.status = "skipped"; test.results = [];
      report.stats.expected--; report.stats.skipped++;
    },
    (report) => {
      const test = report.suites[0].specs[0].tests[0];
      test.status = "unexpected"; test.results[0].status = "failed"; test.results[0].errors = [{ message: "failure" }];
      report.stats.expected--; report.stats.unexpected++;
    },
    (report) => {
      const test = report.suites[0].specs[0].tests[0];
      test.status = "flaky"; test.results.push({ status: "passed", retry: 1, error: undefined, errors: [], annotations: [] });
      report.stats.expected--; report.stats.flaky++;
    },
  ];
  for (const mutate of mutations) {
    const data = f02Input(); mutate(data.reports.e2e);
    assert.equal(evaluate(data).exitCode, 1);
  }
});
test("F02 rejects non-serial, repeated, non-chromium or incomplete runner metadata", () => {
  const mutations = [
    (report) => { report.config.workers = 2; },
    (report) => { report.config.projects[0].retries = 1; },
    (report) => { report.config.projects[0].name = "webkit"; },
    (report) => { report.errors.push({ message: "configuration failed" }); },
    (report) => { report.stats.expected = 12; },
  ];
  for (const mutate of mutations) {
    const data = f02Input(); mutate(data.reports.e2e);
    assert.equal(evaluate(data).exitCode, 1);
  }
});
test("F02 rejects missing process evidence or an untrusted sandbox", () => {
  for (const mutate of [
    (data) => { data.exits.e2e = null; },
    (data) => { data.reports["e2e-plan"] = null; },
    (data) => { data.sandbox.database = "loopback:54322/postgres"; },
    (data) => { data.sandbox.providers.ai = "real"; },
    (data) => { data.inputs.hash_after = "b".repeat(64); },
  ]) {
    const data = f02Input(); mutate(data);
    assert.equal(evaluate(data).exitCode, 1);
  }
});
test("F02 input snapshot stays equal when only excluded artifacts change", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-f02-inputs-"));
  try {
    mkdirSync(path.join(dir, "src"));
    mkdirSync(path.join(dir, ".verify-logs"));
    writeFileSync(path.join(dir, "src/value.ts"), "export const value = 1;\n");
    writeFileSync(path.join(dir, ".env.e2e"), "SECRET=never-hashed\n");
    writeFileSync(path.join(dir, ".verify-logs/run.log"), "artifact\n");
    const before = snapshotF02Inputs(dir);
    assert.equal(compareF02Inputs(dir, before).ok, true);
    writeFileSync(path.join(dir, ".verify-logs/run.log"), "changed artifact\n");
    assert.equal(compareF02Inputs(dir, before).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("F02 input snapshot detects a source change", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-f02-inputs-change-"));
  try {
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src/value.ts"), "export const value = 1;\n");
    const before = snapshotF02Inputs(dir);
    writeFileSync(path.join(dir, "src/value.ts"), "export const value = 2;\n");
    assert.equal(compareF02Inputs(dir, before).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("F02 sandbox evidence accepts only the dedicated local ports and never contains credentials", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-f02-sandbox-"));
  const filename = path.join(dir, ".env.e2e");
  const contents = [
    "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-private-fixture",
    "SUPABASE_SERVICE_ROLE_KEY=service-private-fixture",
    "SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:55422/postgres",
    "NEXT_PUBLIC_APP_URL=http://localhost:3102",
  ].join("\n");
  const environment = {
    F02_E2E_SANDBOX_ID: "f02-crm-cadastros-disposable",
    E2E_PORT: "3102",
    WHATSAPP_MODE: "mock",
    AI_PROVIDER: "mock",
    CI: "1",
  };
  try {
    writeFileSync(filename, contents);
    const evidence = verifyF02Sandbox(dir, environment);
    assert.equal(evidence.ok, true);
    assert.doesNotMatch(JSON.stringify(evidence), /private-fixture/);
    writeFileSync(filename, contents.replace(":55421", ":54321"));
    assert.throws(() => verifyF02Sandbox(dir, environment), /porta 55421/);
    writeFileSync(filename, `${contents}\nUNSAFE=$(touch should-not-run)`);
    assert.throws(() => verifyF02Sandbox(dir, environment), /sintaxe recusada/);
    writeFileSync(filename, `${contents}\nUNSAFE=fixture&/bin/true`);
    assert.throws(() => verifyF02Sandbox(dir, environment), /sintaxe recusada/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
    copyFileSync(helperPath, path.join(dir, "scripts/verify/f02-e2e.mjs"));
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
const fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'exec' && args[1] === 'bash') {
  const run = child.spawnSync('bash', args.slice(2), { stdio: 'inherit', env: process.env });
  process.exit(run.status ?? 1);
}
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

// ─── ADR-018 — verify.sh v1.1: F03 herda os controles de F02 e mede `webhook` ──

const stateF03 = `current_phase: F03
baseline_n0: 7
f00_commit: c85f7d72
baseline_detail: "unit=2/2 db=2/2 e2e=3/3"
| F01 | Fundação | done(verify=2026-09-07 6f7c56fc) |
| F02 | CRM | done(verify=2026-09-10 03ec6a3b) |
| F03 | Conversa | pending |
`;
const WEBHOOK_OK = "webhook: replay=2 stored=1 tables_checked=5";

function f03Input() {
  const data = f02Input();
  data.context = phaseContext(stateF03);
  const parametros = { specs: REQUIRED_F03_E2E_SPECS, counts: F03_SPEC_COUNTS, total: EXPECTED_F03_E2E_TESTS };
  data.reports["e2e-plan"] = playwrightReport(parametros);
  data.reports.e2e = playwrightReport({ ...parametros, actual: true });
  data.metrics.webhook = WEBHOOK_OK;
  return data;
}

test("F03 is a gated phase and reaches READY with the webhook line measured", () => {
  const result = evaluate(f03Input());
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F03)");
  const bloco = render(f03Input(), result);
  assert.match(bloco, new RegExp(WEBHOOK_OK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(bloco, /e2e_scope: F03-required passed=27\/27 specs=8\/8/);
  assert.match(bloco, /replicability: e2e\[fictitious_A_B\]=27\/27 specs=8\/8/);
});

test("F03 keeps every F02 spec: dropping one is rejected, so the denominator never shrinks", () => {
  for (const herdada of REQUIRED_F02_E2E_SPECS) {
    assert.ok(REQUIRED_F03_E2E_SPECS.includes(herdada), `F03 perdeu a spec ${herdada}`);
  }
  assert.equal(REQUIRED_F03_E2E_SPECS.length, REQUIRED_F02_E2E_SPECS.length + 1);
  assert.ok(EXPECTED_F03_E2E_TESTS > EXPECTED_F02_E2E_TESTS);
  const data = f03Input();
  const restantes = REQUIRED_F03_E2E_SPECS.filter((file) => file !== REQUIRED_F02_E2E_SPECS[0]);
  const parametros = { specs: restantes, counts: F03_SPEC_COUNTS.slice(1), total: EXPECTED_F03_E2E_TESTS };
  data.reports["e2e-plan"] = playwrightReport(parametros);
  data.reports.e2e = playwrightReport({ ...parametros, actual: true });
  const result = evaluate(data);
  assert.equal(result.exitCode, 1);
  assert.ok(result.errors.some((erro) => /specs obrigatórias de F03/.test(erro)), result.errors.join("\n"));
});

test("missing webhook line makes otherwise green F03 fail", () => {
  const data = f03Input();
  delete data.metrics.webhook;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1);
  assert.ok(result.errors.includes("Métrica obrigatória ausente: webhook"), result.errors.join("\n"));
  assert.match(render(data, result), /webhook: replay=pending stored=pending tables_checked=pending/);
});

for (const [rotulo, linha] of [
  ["duplicata gravada", "webhook: replay=2 stored=2 tables_checked=5"],
  ["sem reentrega", "webhook: replay=1 stored=1 tables_checked=5"],
  ["pipeline raso", "webhook: replay=2 stored=1 tables_checked=3"],
  ["campo pendente", "webhook: replay=2 stored=pending tables_checked=5"],
]) test(`F03 rejects a webhook line out of contract: ${rotulo}`, () => {
  const data = f03Input();
  data.metrics.webhook = linha;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1, `linha aceita indevidamente: ${linha}`);
  assert.ok(
    result.errors.some((erro) => /webhook/i.test(erro)),
    result.errors.join("\n"),
  );
});

test("F02 keeps webhook pending without failing: the field is required only from F03", () => {
  const data = f02Input();
  delete data.metrics.webhook;
  const result = evaluate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F02)");
  assert.match(render(data, result), /webhook: replay=pending stored=pending tables_checked=pending/);
  assert.match(render(data, result), /e2e_scope: F02-required passed=13\/13 specs=7\/7/);
});

test("F03 still requires the disposable sandbox and the untouched input snapshot", () => {
  for (const quebra of [
    (data) => { data.sandbox = null; },
    (data) => { data.inputs = { ...data.inputs, hash_after: "b".repeat(64), ok: false }; },
    (data) => { data.exits.sandbox = 1; },
  ]) {
    const data = f03Input();
    quebra(data);
    const result = evaluate(data);
    assert.equal(result.exitCode, 1);
  }
});

// ─── ADR-022 — verify.sh v1.2: F04 mede `ai_eval` ─────────────────────────

const stateF04 = `current_phase: F04
baseline_n0: 7
f00_commit: c85f7d72
baseline_detail: "unit=2/2 db=2/2 e2e=3/3"
| F01 | Fundação | done(verify=2026-09-07 6f7c56fc) |
| F02 | CRM | done(verify=2026-09-10 03ec6a3b) |
| F03 | Conversa | done(verify=2026-09-11 6d742a6b) |
| F04 | IA | pending |
`;
const F04_SPEC_COUNTS = [...F03_SPEC_COUNTS, 10];
const AI_EVAL_OK =
  "ai_eval: cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0";

function f04Input() {
  const data = f03Input();
  data.context = phaseContext(stateF04);
  const parametros = { specs: REQUIRED_F04_E2E_SPECS, counts: F04_SPEC_COUNTS, total: EXPECTED_F04_E2E_TESTS };
  data.reports["e2e-plan"] = playwrightReport(parametros);
  data.reports.e2e = playwrightReport({ ...parametros, actual: true });
  data.metrics.ai_eval = AI_EVAL_OK;
  data.metrics.entitlement = "entitlement: usage_events_written=6";
  return data;
}

test("F04 is gated and reaches READY with ai_eval measured", () => {
  const result = evaluate(f04Input());
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F04)");
  const bloco = render(f04Input(), result);
  assert.match(bloco, /ai_eval: cases=30 pass=30\/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0/);
  assert.match(bloco, /e2e_scope: F04-required passed=37\/37 specs=9\/9/);
});

test("F04 keeps every F03 spec: the denominator never shrinks", () => {
  for (const herdada of REQUIRED_F03_E2E_SPECS) {
    assert.ok(REQUIRED_F04_E2E_SPECS.includes(herdada), `F04 perdeu a spec ${herdada}`);
  }
  assert.equal(REQUIRED_F04_E2E_SPECS.length, REQUIRED_F03_E2E_SPECS.length + 1);
  assert.ok(EXPECTED_F04_E2E_TESTS > EXPECTED_F03_E2E_TESTS);
});

test("missing ai_eval line makes otherwise green F04 fail", () => {
  const data = f04Input();
  delete data.metrics.ai_eval;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1);
  assert.ok(result.errors.includes("Métrica obrigatória ausente: ai_eval"), result.errors.join("\n"));
  assert.match(render(data, result), /ai_eval: cases=pending/);
});

for (const [rotulo, linha] of [
  ["dataset curto", "ai_eval: cases=29 pass=29/29 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0"],
  ["caso reprovado", "ai_eval: cases=30 pass=29/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=0"],
  ["injeção a menos", "ai_eval: cases=30 pass=30/30 unknown=6 injection=9 cross_tenant=5 provider_calls_at_zero_balance=0"],
  ["cross-tenant a menos", "ai_eval: cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=4 provider_calls_at_zero_balance=0"],
  ["chamou o provedor sem saldo", "ai_eval: cases=30 pass=30/30 unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=1"],
]) test(`F04 rejects an ai_eval line out of contract: ${rotulo}`, () => {
  const data = f04Input();
  data.metrics.ai_eval = linha;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1, `linha aceita indevidamente: ${linha}`);
  assert.ok(result.errors.some((erro) => /ai_eval/i.test(erro)), result.errors.join("\n"));
});

test("F04 requires entitlement at least the dataset's normal cases", () => {
  const data = f04Input();
  data.metrics.entitlement = "entitlement: usage_events_written=5";
  const result = evaluate(data);
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.errors.some((erro) => /Entitlement abaixo dos casos normais/.test(erro)),
    result.errors.join("\n"),
  );
});

test("F03 keeps ai_eval pending without failing: required only from F04", () => {
  const data = f03Input();
  delete data.metrics.ai_eval;
  const result = evaluate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F03)");
  assert.match(render(data, result), /ai_eval: cases=pending/);
});

// ─── ADR-024 — verify.sh v1.3: F05 mede `handoff` e `reminder` ────────────

const stateF05 = `current_phase: F05
baseline_n0: 7
f00_commit: c85f7d72
baseline_detail: "unit=2/2 db=2/2 e2e=3/3"
| F03 | Conversa | done(verify=2026-09-11 6d742a6b) |
| F04 | IA | done(verify=2026-09-11 aaaaaaaa) |
| F05 | Handoff | pending |
`;
const F05_SPEC_COUNTS = [...F04_SPEC_COUNTS, 4];
const HANDOFF_OK = "handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7 assignee=3/3 notify=3/3";
const REMINDER_OK = "reminder: runs=2 sent=1 duplicates=0";

function f05Input() {
  const data = f04Input();
  data.context = phaseContext(stateF05);
  const parametros = { specs: REQUIRED_F05_E2E_SPECS, counts: F05_SPEC_COUNTS, total: EXPECTED_F05_E2E_TESTS };
  data.reports["e2e-plan"] = playwrightReport(parametros);
  data.reports.e2e = playwrightReport({ ...parametros, actual: true });
  data.metrics.handoff = HANDOFF_OK;
  data.metrics.reminder = REMINDER_OK;
  return data;
}

test("F05 is gated and reaches READY with handoff and reminder measured", () => {
  const result = evaluate(f05Input());
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F05)");
  const bloco = render(f05Input(), result);
  assert.match(bloco, /handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7\/7 assignee=3\/3 notify=3\/3/);
  assert.match(bloco, /reminder: runs=2 sent=1 duplicates=0/);
  assert.match(bloco, /e2e_scope: F05-required passed=41\/41 specs=10\/10/);
});

for (const [rotulo, linha] of [
  ["sem handoff nenhum", "handoff: handoffs=0 ai_msgs_after_handoff=0 summary=7/7 assignee=0/0 notify=0/0"],
  ["poucos handoffs", "handoff: handoffs=2 ai_msgs_after_handoff=0 summary=7/7 assignee=2/2 notify=2/2"],
  ["IA falou depois", "handoff: handoffs=3 ai_msgs_after_handoff=1 summary=7/7 assignee=3/3 notify=3/3"],
  ["resumo incompleto", "handoff: handoffs=3 ai_msgs_after_handoff=0 summary=6/7 assignee=3/3 notify=3/3"],
  ["responsável faltando", "handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7 assignee=2/3 notify=3/3"],
  ["notificação faltando", "handoff: handoffs=3 ai_msgs_after_handoff=0 summary=7/7 assignee=3/3 notify=2/3"],
]) test(`F05 rejects a handoff line out of contract: ${rotulo}`, () => {
  const data = f05Input();
  data.metrics.handoff = linha;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1, `linha aceita indevidamente: ${linha}`);
  assert.ok(result.errors.some((e) => /handoff/i.test(e)), result.errors.join("\n"));
});

for (const [rotulo, linha] of [
  ["rodou uma vez só", "reminder: runs=1 sent=1 duplicates=0"],
  ["mandou duas vezes", "reminder: runs=2 sent=2 duplicates=0"],
  ["duplicou", "reminder: runs=2 sent=1 duplicates=1"],
]) test(`F05 rejects a reminder line out of contract: ${rotulo}`, () => {
  const data = f05Input();
  data.metrics.reminder = linha;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1, `linha aceita indevidamente: ${linha}`);
  assert.ok(result.errors.some((e) => /reminder/i.test(e)), result.errors.join("\n"));
});

test("missing handoff or reminder line makes otherwise green F05 fail", () => {
  for (const campo of ["handoff", "reminder"]) {
    const data = f05Input();
    delete data.metrics[campo];
    const result = evaluate(data);
    assert.equal(result.exitCode, 1);
    assert.ok(result.errors.includes(`Métrica obrigatória ausente: ${campo}`), result.errors.join("\n"));
  }
});

test("F04 keeps handoff and reminder pending without failing", () => {
  const data = f04Input();
  delete data.metrics.handoff;
  delete data.metrics.reminder;
  const result = evaluate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F04)");
  assert.match(render(data, result), /handoff: ai_msgs_after_handoff=pending/);
  assert.match(render(data, result), /reminder: runs=pending/);
});

// ─── ADR-028 — verify.sh v1.4: F06 mede `logs`, `rate-limit`, `lgpd`; ambiente `staging` ──

const stateF06 = `current_phase: F06
baseline_n0: 7
f00_commit: c85f7d72
baseline_detail: "unit=2/2 db=2/2 e2e=3/3"
| F04 | IA | done(verify=2026-09-11 aaaaaaaa) |
| F05 | Handoff | done(verify=2026-09-12 5aa5de54) |
| F06 | Hardening | pending |
`;
const LOGS_OK = "logs: routes=269 routes_logged=269 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=4/7";
const RATE_LIMIT_OK = "rate-limit: requests=101 status_429=1 auth_requests=101 auth_blocked=1 routes=269 routes_with_schema=269 routes_reading_input=142 validated=142";
const LGPD_OK = "lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=2";

function f06Input() {
  const data = f05Input();
  data.context = phaseContext(stateF06);
  data.metrics.logs = LOGS_OK;
  data.metrics["rate-limit"] = RATE_LIMIT_OK;
  data.metrics.lgpd = LGPD_OK;
  return data;
}

function stagingEvidence() {
  return {
    ok: true,
    environment: "staging",
    sandbox: "crm-staging",
    api: "loopback:56421",
    database: "loopback:56422/postgres",
    app: "loopback:3202",
    providers: { whatsapp: "mock", ai: "mock" },
    credentials: { anon: "present", service_role: "present" },
  };
}

test("F06 is gated: in the sandbox it reaches READY (F06) with the three hardening lines measured", () => {
  const data = f06Input();
  const result = evaluate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F06)");
  const bloco = render(data, result);
  assert.match(bloco, /environment=sandbox/);
  assert.match(bloco, /logs: routes=269 routes_logged=269/);
  assert.match(bloco, /rate-limit: requests=101 status_429=1/);
  assert.match(bloco, /lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=2/);
  assert.match(bloco, /e2e_scope: F06-required passed=41\/41 specs=10\/10/);
});

test("F06 inside the staging environment prints READY (staging) and environment=staging", () => {
  const data = f06Input();
  data.sandbox = stagingEvidence();
  const result = evaluate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (staging)");
  assert.match(render(data, result), /environment=staging/);
});

test("staging evidence with the wrong ports or marker is rejected, and F05 never earns READY (staging)", () => {
  for (const patch of [{ api: "loopback:55421" }, { sandbox: "f02-crm-cadastros-disposable" }, { app: "loopback:3102" }, { database: "loopback:56422/outro" }]) {
    const data = f06Input();
    data.sandbox = { ...stagingEvidence(), ...patch };
    const result = evaluate(data);
    assert.equal(result.exitCode, 1, JSON.stringify(patch));
    assert.ok(result.errors.some((e) => /sandbox: evidência/.test(e)), result.errors.join("\n"));
  }
  const f05 = f05Input();
  f05.sandbox = stagingEvidence();
  const result = evaluate(f05);
  assert.equal(result.status, "READY (F05)");
});

for (const [rotulo, campo, linha] of [
  ["rota sem log", "logs", "logs: routes=269 routes_logged=268 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=4/7"],
  ["worker sem log", "logs", "logs: routes=269 routes_logged=269 workers=4 workers_logged=3 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=4/7"],
  ["request sem organization_id", "logs", "logs: routes=269 routes_logged=269 workers=4 workers_logged=4 request_log_org_id=0/1 sentry_mock_captured=1 pii_fields=4/7"],
  ["sentry mudo", "logs", "logs: routes=269 routes_logged=269 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=0 pii_fields=4/7"],
  ["allowlist vazou", "logs", "logs: routes=269 routes_logged=269 workers=4 workers_logged=4 request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=7/7"],
  ["sem 429", "rate-limit", "rate-limit: requests=101 status_429=0 auth_requests=101 auth_blocked=1 routes=269 routes_with_schema=269 routes_reading_input=142 validated=142"],
  ["login sem teto", "rate-limit", "rate-limit: requests=101 status_429=1 auth_requests=101 auth_blocked=0 routes=269 routes_with_schema=269 routes_reading_input=142 validated=142"],
  ["rota sem schema", "rate-limit", "rate-limit: requests=101 status_429=1 auth_requests=101 auth_blocked=1 routes=269 routes_with_schema=268 routes_reading_input=142 validated=141"],
  ["poucas requisições", "rate-limit", "rate-limit: requests=50 status_429=1 auth_requests=101 auth_blocked=1 routes=269 routes_with_schema=269 routes_reading_input=142 validated=142"],
  ["sobrou linha", "lgpd", "lgpd: tables=9 rows=11 rows_remaining=1 audit_rows=2"],
  ["sem auditoria", "lgpd", "lgpd: tables=9 rows=11 rows_remaining=0 audit_rows=1"],
  ["cliente vazio", "lgpd", "lgpd: tables=1 rows=1 rows_remaining=0 audit_rows=2"],
]) test(`F06 rejects a hardening line out of contract: ${rotulo}`, () => {
  const data = f06Input();
  data.metrics[campo] = linha;
  const result = evaluate(data);
  assert.equal(result.exitCode, 1, `linha aceita indevidamente: ${linha}`);
  assert.ok(result.errors.some((e) => e.includes(campo)), result.errors.join("\n"));
});

test("missing logs, rate-limit or lgpd line makes otherwise green F06 fail", () => {
  for (const campo of ["logs", "rate-limit", "lgpd"]) {
    const data = f06Input();
    delete data.metrics[campo];
    const result = evaluate(data);
    assert.equal(result.exitCode, 1);
    assert.ok(result.errors.includes(`Métrica obrigatória ausente: ${campo}`), result.errors.join("\n"));
  }
});

test("F05 keeps logs, rate-limit and lgpd pending without failing", () => {
  const data = f05Input();
  const result = evaluate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "READY (F05)");
  assert.match(render(data, result), /logs: routes=pending/);
  assert.match(render(data, result), /rate-limit: requests=pending/);
  assert.match(render(data, result), /lgpd: tables=pending/);
});
