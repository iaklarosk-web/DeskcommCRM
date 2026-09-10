import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closedE2EPlan, hasClosedE2E, parseF02E2E } from "./f02-e2e.mjs";

// Dívidas de c85f7d72 saneadas: não podem reaparecer nem em revalidação.
// As identidades e resultados históricos permanecem na evidência de ADR-007.
export const KNOWN_DEBT = [];
const integer = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Fases com gate implementado. ADR-018 acrescenta F03 sem afrouxar nada: F03
 * herda TODOS os controles de F02 (sandbox descartável, snapshot SHA-256 dos
 * inputs, E2E fechado) e acrescenta o campo `webhook` medido.
 */
const GATED_PHASES = ["F00", "F01", "F02", "F03"];

/** §8.3: `webhook` é obrigatório a partir de F03; antes disso imprime pending. */
const phaseNumber = (phase) => Number(phase.slice(1));
const requiresWebhook = (phase) => phaseNumber(phase) >= phaseNumber("F03");

export function phaseContext(state, requestedPhase) {
  const active = /^current_phase:\s*(F\d{2})\b/m.exec(state)?.[1];
  if (!active) throw new Error("BUILD-STATE sem current_phase válido");
  const phase = requestedPhase ?? active;
  if (!/^F\d{2}$/.test(phase)) throw new Error("Fase inválida");
  if (requestedPhase && !new RegExp(`^\\| ${phase} \\|[^\\n]+\\| done\\(verify=`, "m").test(state)) {
    throw new Error(`Revalidação exige fase concluída no BUILD-STATE: ${phase}`);
  }
  const total = Number(/^baseline_n0:\s*(\d+)/m.exec(state)?.[1]);
  const detail = /^baseline_detail:\s*(.+)$/m.exec(state)?.[1] ?? "";
  const unit = Number(/\bunit=(\d+)\//.exec(detail)?.[1]);
  const db = Number(/\bdb=(\d+)\//.exec(detail)?.[1]);
  const baselineCommit = /^f00_commit:\s*([a-f0-9]{7,40})\b/m.exec(state)?.[1];
  if (![total, unit, db].every((n) => integer(n) && n > 0) || total < unit + db || !baselineCommit) {
    throw new Error("Baseline F00 ausente/inválido; não há denominador comparável");
  }
  return { active, phase, revalidation: Boolean(requestedPhase), baseline: { total, unit, db, commit: baselineCommit } };
}

export function parseSuite(report, suite, root) {
  if (!report || !Array.isArray(report.testResults)) throw new Error(`${suite}: relatório ausente/inválido`);
  const counters = ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites"];
  if (!counters.every((key) => integer(report[key]))) throw new Error(`${suite}: contagem inválida`);
  const result = { passed: 0, total: 0, failed: 0, skipped: 0, pending: 0, expectedFailures: 0, debt: [], errors: [] };
  for (const file of report.testResults) {
    if (!Array.isArray(file.assertionResults) || typeof file.name !== "string") throw new Error(`${suite}: arquivo de resultado inválido`);
    if (file.status !== "passed") result.errors.push(`${suite}: módulo falhou: ${file.name}`);
    for (const test of file.assertionResults) {
      if (typeof test.meta?.verifyExpectedFailure !== "boolean") {
        throw new Error(`${suite}: resultado sem metadata do reporter de verificação`);
      }
      result.total++;
      const identity = { suite, file: path.relative(root, file.name).split(path.sep).join("/"), title: test.title };
      if (test.status === "passed") {
        if (test.meta?.verifyExpectedFailure === true) {
          result.expectedFailures++;
          result.debt.push({ ...identity, kind: "expected_failure" });
        } else result.passed++;
      } else if (test.status === "failed") result.failed++;
      else if (["skipped", "todo", "disabled"].includes(test.status)) {
        result.skipped++;
        result.debt.push({ ...identity, kind: test.status });
      } else result.pending++;
    }
  }
  if (result.total === 0 || result.total !== report.numTotalTests ||
      result.passed + result.expectedFailures !== report.numPassedTests || result.failed !== report.numFailedTests ||
      result.skipped + result.pending !== report.numPendingTests + report.numTodoTests) {
    throw new Error(`${suite}: denominadores inconsistentes ou vazios`);
  }
  if (report.success !== true || report.numFailedTestSuites > 0 || result.failed > 0 || result.pending > 0) {
    result.errors.push(`${suite}: falha ou execução incompleta`);
  }
  return result;
}

export function evaluate(input) {
  const errors = [];
  const debt = [];
  const suites = {};
  const context = input.context;
  if (!GATED_PHASES.includes(context.phase)) errors.push(`Fase ${context.phase} ainda sem gate completo; requisitos posteriores pendentes`);
  for (const name of ["typecheck", "lint", "build", "shell", "secrets"]) {
    if (input.exits[name] !== 0) errors.push(`${name}: comando falhou ou não executou`);
  }
  for (const name of ["unit", "integration", "db"]) {
    if (input.exits[name] !== 0) errors.push(`${name}: comando falhou ou não executou`);
    try {
      const parsed = parseSuite(input.reports[name], name, input.root);
      suites[name] = parsed;
      errors.push(...parsed.errors);
      debt.push(...parsed.debt);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (hasClosedE2E(context.phase)) {
    for (const name of ["inputs-before", "sandbox", "e2e-plan", "e2e", "inputs"]) {
      if (input.exits[name] !== 0) errors.push(`${name}: comando falhou ou não executou`);
    }
    const inputs = input.inputs;
    if (!inputs || inputs.ok !== true || inputs.algorithm !== "sha256" ||
        !integer(inputs.files_before) || inputs.files_before < 1 || inputs.files_after !== inputs.files_before ||
        typeof inputs.hash_before !== "string" || !/^[a-f0-9]{64}$/.test(inputs.hash_before) ||
        inputs.hash_after !== inputs.hash_before) {
      errors.push("inputs: snapshot ausente, inválido ou árvore alterada durante o gate");
    }
    const sandbox = input.sandbox;
    if (!sandbox || sandbox.ok !== true || sandbox.sandbox !== "f02-crm-cadastros-disposable" ||
        sandbox.api !== "loopback:55421" || sandbox.database !== "loopback:55422/postgres" ||
        sandbox.app !== "loopback:3102" || sandbox.providers?.whatsapp !== "mock" ||
        sandbox.providers?.ai !== "mock" || sandbox.credentials?.anon !== "present" ||
        sandbox.credentials?.service_role !== "present") {
      errors.push("sandbox: evidência segura ausente ou inválida");
    }
    try {
      const parsed = parseF02E2E(input.reports["e2e-plan"], input.reports.e2e, input.root, context.phase);
      suites.e2e = parsed;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "e2e: relatório inválido");
    }
  }
  const unknownDebt = debt.filter((entry) => !KNOWN_DEBT.some((known) => Object.keys(known).every((key) => known[key] === entry[key])));
  if (unknownDebt.length > 0) errors.push(`Dívida nova ou não reconhecida: ${unknownDebt.length}`);
  if (new Set(debt.map((entry) => JSON.stringify(entry))).size !== debt.length) errors.push("Identidade de dívida duplicada");
  if (!context.revalidation && debt.length > 0) errors.push(`DoD exige ausência de dívida: ${debt.length}`);
  const corePassed = (suites.unit?.passed ?? 0) + (suites.db?.passed ?? 0);
  const baselineCore = context.baseline.unit + context.baseline.db;
  if (corePassed < baselineCore) errors.push(`Regressão no baseline comparável unit+db: ${corePassed}/${baselineCore}`);
  for (const suite of ["unit", "db"]) {
    if ((suites[suite]?.passed ?? 0) < context.baseline[suite]) errors.push(`Baseline de ${suite} diminuiu`);
  }
  for (const key of ["testsDeleted", "tenantReferences"]) {
    if (input[key] !== 0) errors.push(`${key}: deve ser zero (medido=${input[key] ?? "pending"})`);
  }
  if (!integer(input.mutants?.total) || input.mutants.total < 1 || input.mutants.killed !== input.mutants.total) errors.push("Mutante ausente ou vivo");

  function metric(name, fields) {
    const line = input.metrics[name];
    if (typeof line !== "string" || !line.startsWith(`${name}: `) || /pending/.test(line)) {
      errors.push(`Métrica obrigatória ausente: ${name}`); // MUTANT: required-metric
      return null;
    }
    const numbers = {};
    for (const field of fields) {
      const values = [...line.matchAll(new RegExp(`\\b${field}=(\\d+)(?=\\s|[)/]|$)`, "g"))];
      if (values.length !== 1) {
        errors.push(`Métrica inválida: ${name}.${field}`);
        return null;
      }
      numbers[field] = Number(values[0][1]);
      if (!integer(numbers[field])) errors.push(`Métrica fora de faixa: ${name}.${field}`);
    }
    return numbers;
  }
  const sec = metric("secrets", ["files_scanned", "findings"]);
  if (sec && (sec.files_scanned < 1 || sec.findings !== 0)) errors.push("Segredos: varredura vazia ou achados");
  if (context.phase !== "F00") {
    const isolation = metric("isolation", ["tables", "ops", "dirs", "leaks"]);
    const rls = metric("rls-coverage", ["tables_with_org_id", "policies_found", "missing", "service_only_with_grant"]);
    const rbac = metric("rbac", ["roles", "denied_expected", "denied_actual"]);
    const entitlement = metric("entitlement", ["usage_events_written"]);
    if (isolation && (isolation.tables < 1 || isolation.ops !== 4 || isolation.dirs !== 2 || isolation.leaks !== 0)) errors.push("Isolamento fora do contrato");
    if (rls && (rls.tables_with_org_id < 1 || rls.policies_found < 1 || rls.missing !== 0 || rls.service_only_with_grant !== 0)) errors.push("Cobertura de RLS fora do contrato");
    if (isolation && rls && isolation.tables !== rls.tables_with_org_id) errors.push("Denominadores de isolamento/RLS divergem");
    if (rbac && (rbac.roles !== 3 || rbac.denied_expected < 1 || rbac.denied_expected !== rbac.denied_actual)) errors.push("RBAC fora do contrato");
    if (entitlement && entitlement.usage_events_written < 2) errors.push("Entitlement sem prova mínima de uso");
  }
  // §8.3: mesma fixture 2x; linhas criadas em cada uma das T tabelas do
  // pipeline. `stored=1` é o contrato — a segunda entrega não grava mensagem.
  if (requiresWebhook(context.phase)) {
    const webhook = metric("webhook", ["replay", "stored", "tables_checked"]);
    if (webhook && (webhook.replay < 2 || webhook.stored !== 1 || webhook.tables_checked < 4)) {
      errors.push("Webhook fora do contrato: exige replay>=2, stored=1, tables_checked>=4");
    }
  }
  const clean = errors.length === 0;
  const status = !clean ? "NOT READY" : context.revalidation
    ? `${debt.length ? "REVALIDATED WITH DEBT" : "REVALIDATED"} (${context.phase})`
    : `READY (${context.phase})`;
  return { status, exitCode: clean ? 0 : 1, errors, debt, suites, corePassed, baselineCore };
}

function read(file) {
  try { return readFileSync(file, "utf8").trim(); } catch { return null; }
}
function git(args, root) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }

export function collect(root, directory, context) {
  const reports = {}, exits = {}, metrics = {};
  for (const name of ["typecheck", "lint", "build", "shell", "unit", "integration", "db", "secrets", "inputs-before", "sandbox", "e2e-plan", "e2e", "inputs"]) {
    const raw = read(path.join(directory, `${name}.exit`));
    exits[name] = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  }
  for (const suite of ["unit", "integration", "db"]) {
    try { reports[suite] = JSON.parse(readFileSync(path.join(directory, `${suite}.json`), "utf8")); } catch { reports[suite] = null; }
  }
  for (const name of ["e2e-plan", "e2e"]) {
    try { reports[name] = JSON.parse(readFileSync(path.join(directory, `${name}.json`), "utf8")); } catch { reports[name] = null; }
  }
  let sandbox = null;
  try { sandbox = JSON.parse(readFileSync(path.join(directory, "sandbox.json"), "utf8")); } catch { sandbox = null; }
  let inputs = null;
  try { inputs = JSON.parse(readFileSync(path.join(directory, "inputs.json"), "utf8")); } catch { inputs = null; }
  for (const name of ["isolation", "rls-coverage", "rbac", "entitlement", "webhook"]) metrics[name] = read(path.join(directory, "metrics", `${name}.line`));
  metrics.secrets = read(path.join(directory, "secrets.log"));
  let testsDeleted = null, tenantReferences = null, skipOnlyOccurrences = null;
  try {
    testsDeleted = git(["diff", "--diff-filter=D", "--name-only", context.baseline.commit, "--"], root)
      .split("\n").filter((file) => file.startsWith("tests/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)).length;
    const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "tests"], root).split("\0").filter(Boolean);
    tenantReferences = 0;
    skipOnlyOccurrences = 0;
    for (const file of new Set(files)) {
      const contents = readFileSync(path.join(root, file), "utf8");
      if (file.startsWith("src/") && /deka/i.test(contents)) tenantReferences++;
      skipOnlyOccurrences += [...contents.matchAll(/\.(?:skip|only)\(/g)].length;
    }
  } catch {
    testsDeleted = null; tenantReferences = null; skipOnlyOccurrences = null;
  }
  const mutantCounts = (read(path.join(directory, "mutants.count")) ?? "").split("/").map(Number);
  return { root, context, exits, reports, sandbox, inputs, metrics, testsDeleted, tenantReferences, skipOnlyOccurrences,
    mutants: { killed: mutantCounts[0], total: mutantCounts[1] } };
}

export function render(input, result) {
  const fraction = (name) => result.suites[name] ? `${result.suites[name].passed}/${result.suites[name].total}` : "pending";
  const ok = (name) => input.exits[name] === 0 ? "ok" : "fail";
  const closed = hasClosedE2E(input.context.phase);
  const expectedSuiteCount = closed ? 4 : 3;
  const count = (key) => Object.keys(result.suites).length === expectedSuiteCount
    ? Object.values(result.suites).reduce((sum, suite) => sum + suite[key], 0) : "pending";
  const e2e = result.suites.e2e;
  const requiredSpecs = closed ? closedE2EPlan(input.context.phase).specs.length : null;
  const specFraction = e2e ? `${e2e.specs}/${e2e.requiredSpecs}` : requiredSpecs ? `pending/${requiredSpecs}` : "pending";
  const replicability = closed
    ? `replicability: e2e[fictitious_A_B]=${fraction("e2e")} specs=${specFraction} grep_deka_in_src=${input.tenantReferences ?? "pending"}`
    : `replicability: e2e[deka]=pending e2e[demo2]=pending src_diff_lines=pending grep_deka_in_src=${input.tenantReferences ?? "pending"}`;
  return [
    "VERIFY SUMMARY",
    `scope=${input.context.revalidation ? "revalidation" : "phase"} phase=${input.context.phase} current_phase=${input.context.active}`,
    `build=${ok("build")} lint=${ok("lint")} typecheck=${ok("typecheck")} shell=${ok("shell")}`,
    `unit=${fraction("unit")} integration=${fraction("integration")} db=${fraction("db")} e2e=${fraction("e2e")} baseline_n0=${input.context.baseline.total}`,
    `baseline_comparable: scope=unit+db passed=${result.corePassed} required=${result.baselineCore} full_n0=pending`,
    `e2e_scope: ${input.context.phase}-required passed=${fraction("e2e")} specs=${specFraction}`,
    ...["isolation", "rls-coverage", "rbac", "entitlement"].map((name) => input.metrics[name] ?? `${name}: pending`),
    "ai_eval: cases=pending pass=pending unknown=pending injection=pending cross_tenant=pending provider_calls_at_zero_balance=pending",
    "handoff: ai_msgs_after_handoff=pending summary=pending assignee=pending notify=pending",
    "reminder: runs=pending sent=pending duplicates=pending",
    input.metrics.webhook ?? "webhook: replay=pending stored=pending tables_checked=pending",
    replicability,
    input.metrics.secrets ?? "secrets: pending",
    `tests_deleted=${input.testsDeleted ?? "pending"} tests_skipped=${count("skipped")} expected_failures=${count("expectedFailures")} tests_failed=${count("failed")} tests_pending=${count("pending")} mutants_killed=${input.mutants.killed ?? "pending"}/${input.mutants.total ?? "pending"}`,
    `debt_known=${result.debt.filter((entry) => KNOWN_DEBT.some((known) => Object.keys(known).every((key) => known[key] === entry[key]))).length} skip_only_occurrences=${input.skipOnlyOccurrences ?? "pending"} violations=${result.errors.length}`,
    ...result.debt.map((entry) => `debt: ${entry.suite} ${entry.kind} ${entry.file} :: ${entry.title}`),
    ...result.errors.map((error) => `violation: ${error}`),
    `STATUS: ${result.status}`,
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, directory, phase] = process.argv.slice(2);
  try {
    const context = phaseContext(readFileSync(path.join(root, "BUILD-STATE.md"), "utf8"), phase);
    if (mode === "context") {
      process.stdout.write(JSON.stringify(context));
    } else if (mode === "report") {
      const input = collect(root, directory, context);
      const result = evaluate(input);
      writeFileSync(path.join(directory, "summary.json"), JSON.stringify({ ...result, context, metrics: input.metrics }, null, 2));
      process.stdout.write(`${render(input, result)}\n`);
      process.exitCode = result.exitCode;
    } else throw new Error("Modo inválido");
  } catch (error) {
    process.stderr.write(`[verify] ${error.message}\n`);
    process.stdout.write("VERIFY SUMMARY\nSTATUS: NOT READY\n");
    process.exitCode = 1;
  }
}
