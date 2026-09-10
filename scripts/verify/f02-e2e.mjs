import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_F02_E2E_SPECS = Object.freeze([
  "tests/e2e/f02-crm-cadastros.spec.ts",
  "tests/e2e/f02-crm-orders.spec.ts",
  "tests/e2e/f02-crm-work.spec.ts",
  "tests/e2e/f02-crm-navigation.spec.ts",
  "tests/e2e/f02-api-active-org.spec.ts",
  "tests/e2e/f02-support-readonly-api.spec.ts",
  "tests/e2e/f02-daily-checks.spec.ts",
]);

export const EXPECTED_F02_E2E_TESTS = 13;
export const F02_SANDBOX_ID = "f02-crm-cadastros-disposable";

/**
 * F03 ACRESCENTA, nunca substitui (ADR-018): o conjunto obrigatório da fase é o
 * de F02 mais a spec de inbox de §7.4. As sete specs e os treze testes de F02
 * continuam obrigatórios dentro do conjunto de F03 — o denominador já provado
 * não diminui.
 *
 * A jornada de inbox roda as sete ações nas DUAS organizações fictícias, que é
 * o "7/7 por tenant" exigido pela prova de F03-T09: 14 testes numa spec.
 *
 * O sandbox descartável continua com a identidade criada na F02: é o mesmo
 * ambiente fechado em loopback, e trocar o rótulo só invalidaria o contrato já
 * provado sem mudar nada do que ele garante.
 */
export const REQUIRED_F03_E2E_SPECS = Object.freeze([
  ...REQUIRED_F02_E2E_SPECS,
  "tests/e2e/f03-inbox.spec.ts",
]);

export const EXPECTED_F03_E2E_TESTS = EXPECTED_F02_E2E_TESTS + 14;

/** Fases com gate fechado de navegador. O nome deste arquivo é histórico. */
const CLOSED_E2E_PHASES = Object.freeze({
  F02: { specs: REQUIRED_F02_E2E_SPECS, tests: EXPECTED_F02_E2E_TESTS },
  F03: { specs: REQUIRED_F03_E2E_SPECS, tests: EXPECTED_F03_E2E_TESTS },
});

export function hasClosedE2E(phase) {
  return Object.hasOwn(CLOSED_E2E_PHASES, phase);
}

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const INPUT_DIRECTORIES = ["app", "components", "hooks", "lib", "src", "public", "types", "tests", "scripts", "config"];

function fail(message) {
  throw new Error(`E2E fechado: ${message}`);
}

export function closedE2EPlan(phase) {
  const plan = CLOSED_E2E_PHASES[phase];
  if (!plan) fail(`fase ${phase} não tem gate fechado de navegador`);
  return plan;
}

function parseEnvFile(filename) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(".env.e2e deve ser arquivo regular, sem symlink");
  const values = {};
  const safeValue = /^[A-Za-z0-9_./:@%+,?=-]*$/;
  for (const [index, raw] of readFileSync(filename, "utf8").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !safeValue.test(match[2])) fail(`.env.e2e contém sintaxe recusada na linha ${index + 1}`);
    if (Object.hasOwn(values, match[1])) fail(`.env.e2e repete a variável ${match[1]}`);
    values[match[1]] = match[2];
  }
  return values;
}

function requireValue(values, key) {
  if (typeof values[key] !== "string" || values[key].length === 0) fail(`.env.e2e não define ${key}`);
  return values[key];
}

function exactLoopbackHttp(raw, port, key) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${key} não é URL válida`);
  }
  if (url.protocol !== "http:" || !loopback.has(url.hostname) || url.port !== String(port)) {
    fail(`${key} deve apontar por HTTP ao loopback na porta ${port}`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) {
    fail(`${key} deve conter somente origem local`);
  }
}

function exactDatabase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("SUPABASE_DB_URL não é URL válida");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || !loopback.has(url.hostname) || url.port !== "55422") {
    fail("SUPABASE_DB_URL deve apontar ao PostgreSQL loopback na porta 55422");
  }
  if (url.pathname !== "/postgres" || url.search || url.hash) {
    fail("SUPABASE_DB_URL deve selecionar somente o banco postgres do sandbox");
  }
}

export function verifyF02Sandbox(root, processEnv = process.env) {
  const envPath = path.join(root, ".env.e2e");
  const rootReal = realpathSync(root);
  const envReal = realpathSync(envPath);
  if (path.dirname(envReal) !== rootReal) fail(".env.e2e deve pertencer à raiz verificada");
  const values = parseEnvFile(envPath);

  const api = requireValue(values, "NEXT_PUBLIC_SUPABASE_URL");
  const app = requireValue(values, "NEXT_PUBLIC_APP_URL");
  const database = requireValue(values, "SUPABASE_DB_URL");
  requireValue(values, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  requireValue(values, "SUPABASE_SERVICE_ROLE_KEY");
  exactLoopbackHttp(api, 55421, "NEXT_PUBLIC_SUPABASE_URL");
  exactLoopbackHttp(app, 3102, "NEXT_PUBLIC_APP_URL");
  exactDatabase(database);

  if (processEnv.F02_E2E_SANDBOX_ID !== F02_SANDBOX_ID) fail("marker do sandbox descartável está ausente ou incorreto");
  if (processEnv.E2E_PORT !== "3102") fail("E2E_PORT deve ser 3102");
  if (processEnv.WHATSAPP_MODE !== "mock" || processEnv.AI_PROVIDER !== "mock") fail("provedores devem estar em modo mock");
  if (processEnv.CI !== "1") fail("CI deve ser 1 para execução fechada");

  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
    "NEXT_PUBLIC_APP_URL",
  ]) {
    if (processEnv[key] !== undefined && processEnv[key] !== values[key]) {
      fail(`${key} diverge entre processo e .env.e2e`);
    }
  }

  return {
    ok: true,
    sandbox: F02_SANDBOX_ID,
    api: "loopback:55421",
    database: "loopback:55422/postgres",
    app: "loopback:3102",
    providers: { whatsapp: "mock", ai: "mock" },
    credentials: { anon: "present", service_role: "present" },
  };
}

function excludedInput(relative) {
  const parts = relative.split("/");
  const basename = parts.at(-1) ?? "";
  return parts.some((part) => ["node_modules", ".next", ".verify-logs", ".git"].includes(part)) ||
    basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".tsbuildinfo");
}

function inputFiles(root) {
  const files = new Set();
  const add = (relative) => {
    if (excludedInput(relative)) return;
    const absolute = path.join(root, relative);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(`input não pode ser symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) add(path.posix.join(relative, entry));
    } else if (stat.isFile()) files.add(relative);
  };
  for (const directory of INPUT_DIRECTORIES) add(directory);
  add("next-env.d.ts");
  add("supabase/baseline.sql");
  add("supabase/migrations");
  for (const entry of readdirSync(root).sort()) {
    if (entry === "package.json" || /^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(entry) ||
        /^tsconfig.*\.json$/.test(entry) || entry.includes(".config.")) add(entry);
  }
  return [...files].sort();
}

export function snapshotF02Inputs(root) {
  const files = inputFiles(root);
  const hash = createHash("sha256");
  for (const relative of files) {
    const contents = readFileSync(path.join(root, relative));
    const mode = lstatSync(path.join(root, relative)).mode & 0o777;
    hash.update(relative); hash.update("\0");
    hash.update(String(mode)); hash.update("\0");
    hash.update(String(contents.length)); hash.update("\0");
    hash.update(contents); hash.update("\0");
  }
  return { algorithm: "sha256", files: files.length, hash: hash.digest("hex") };
}

export function compareF02Inputs(root, before) {
  const after = snapshotF02Inputs(root);
  const validBefore = before?.algorithm === "sha256" && integer(before.files) && before.files > 0 &&
    typeof before.hash === "string" && /^[a-f0-9]{64}$/.test(before.hash);
  return {
    ok: Boolean(validBefore && before.files === after.files && before.hash === after.hash),
    algorithm: "sha256",
    files_before: validBefore ? before.files : null,
    files_after: after.files,
    hash_before: validBefore ? before.hash : null,
    hash_after: after.hash,
  };
}

function repoFile(root, testDir, filename) {
  if (typeof filename !== "string" || filename.length === 0) fail("relatório contém arquivo inválido");
  const absolute = path.isAbsolute(filename) ? path.normalize(filename) : path.resolve(testDir, filename);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!relative || relative === ".." || relative.startsWith("../")) fail("relatório contém arquivo fora do repositório");
  return relative;
}

function validateConfig(report, label, root) {
  if (!report || typeof report !== "object" || !report.config || !Array.isArray(report.suites)) {
    fail(`relatório ${label} ausente ou inválido`);
  }
  if (report.config.workers !== 1 || report.config.fullyParallel !== false || report.config.forbidOnly !== true) {
    fail(`${label} não comprova execução serial e sem test.only`);
  }
  if (!Array.isArray(report.config.projects) || report.config.projects.length !== 1) {
    fail(`${label} deve executar um único projeto`);
  }
  const project = report.config.projects[0];
  if (project?.name !== "chromium" || project?.id !== "chromium" || project?.retries !== 0 || project?.repeatEach !== 1) {
    fail(`${label} deve executar chromium uma vez e sem retries`);
  }
  const expectedTestDir = path.resolve(root, "tests/e2e");
  if (path.resolve(report.config.rootDir ?? "") !== expectedTestDir || path.resolve(project.testDir ?? "") !== expectedTestDir) {
    fail(`${label} deve usar o diretório tests/e2e da raiz verificada`);
  }
  if (!Array.isArray(report.errors) || report.errors.length !== 0) fail(`${label} contém erros globais`);
  return expectedTestDir;
}

function forbiddenAnnotation(annotations) {
  return Array.isArray(annotations) && annotations.some((annotation) => ["skip", "fixme"].includes(annotation?.type));
}

function declarations(report, root, label, actual) {
  const testDir = validateConfig(report, label, root);
  const rows = [];
  const files = new Set();
  const visit = (suite, parents = []) => {
    if (!suite || typeof suite !== "object" || !Array.isArray(suite.specs)) fail(`${label} contém suíte inválida`);
    const titles = typeof suite.title === "string" && suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs) {
      if (!spec || typeof spec.title !== "string" || !Array.isArray(spec.tests) || spec.tests.length === 0) {
        fail(`${label} contém spec vazia ou inválida`);
      }
      const file = repoFile(root, testDir, spec.file);
      files.add(file);
      if (actual && spec.ok !== true) fail(`${file}: spec falhou`);
      for (const test of spec.tests) {
        if (typeof spec.id !== "string" || !spec.id || typeof test?.projectId !== "string" || !test.projectId) {
          fail(`${file}: identidade de teste inválida`);
        }
        if (test.projectId !== "chromium" || test.projectName !== "chromium") fail(`${file}: projeto inesperado`);
        if (test.expectedStatus !== "passed" || forbiddenAnnotation(test.annotations)) fail(`${file}: skip/fixme declarado`);
        const title = [...titles, spec.title].join(" > ");
        rows.push({
          key: [file, spec.line, spec.column, spec.id, test.projectId, title].join("\u0000"),
          file,
          title,
        });
        if (actual) {
          if (test.status !== "expected" || !Array.isArray(test.results) || test.results.length !== 1) {
            fail(`${file}: teste falhou, foi ignorado, repetido ou ficou incompleto`);
          }
          const result = test.results[0];
          if (result?.status !== "passed" || result.retry !== 0 || !Array.isArray(result.errors) || result.errors.length !== 0 ||
              result.error != null || forbiddenAnnotation(result.annotations)) {
            fail(`${file}: resultado não é passe limpo na primeira tentativa`);
          }
        }
      }
    }
    if (suite.suites !== undefined && !Array.isArray(suite.suites)) fail(`${label} contém sub-suíte inválida`);
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite);
  if (new Set(rows.map((row) => row.key)).size !== rows.length) fail(`${label} contém identidade duplicada`);
  return { rows, files };
}

export function parseF02E2E(plan, actual, root, phase = "F02") {
  const { specs, tests: expectedTests } = closedE2EPlan(phase);
  const planned = declarations(plan, root, "inventário", false);
  const executed = declarations(actual, root, "execução", true);
  const required = [...specs].sort();
  const plannedFiles = [...planned.files].sort();
  const executedFiles = [...executed.files].sort();
  if (JSON.stringify(plannedFiles) !== JSON.stringify(required)) fail(`inventário não contém exatamente as ${required.length} specs obrigatórias de ${phase}`);
  if (JSON.stringify(executedFiles) !== JSON.stringify(required)) fail(`execução não contém exatamente as ${required.length} specs obrigatórias de ${phase}`);
  if (planned.rows.length !== expectedTests) {
    fail(`inventário deve conter ${expectedTests} testes completos`);
  }
  const plannedKeys = planned.rows.map((row) => row.key).sort();
  const executedKeys = executed.rows.map((row) => row.key).sort();
  if (JSON.stringify(executedKeys) !== JSON.stringify(plannedKeys)) {
    fail("execução parcial: identidades/títulos divergem do inventário sem filtro");
  }
  const stats = actual.stats;
  if (!stats || ![stats.expected, stats.unexpected, stats.flaky, stats.skipped].every(integer) ||
      stats.expected !== expectedTests || stats.unexpected !== 0 || stats.flaky !== 0 || stats.skipped !== 0) {
    fail("denominadores do Playwright indicam falha, skip, retry ou execução parcial");
  }
  return {
    passed: expectedTests,
    total: expectedTests,
    failed: 0,
    skipped: 0,
    pending: 0,
    expectedFailures: 0,
    debt: [],
    errors: [],
    specs: required.length,
    requiredSpecs: required.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, output, beforeFile] = process.argv.slice(2);
  try {
    // `specs <fase>`: o verify.sh pede o inventário da fase que está rodando.
    if (mode === "specs") process.stdout.write(`${closedE2EPlan(root ?? "F02").specs.join("\n")}\n`);
    else if (mode === "environment" && root && output) {
      writeFileSync(output, `${JSON.stringify(verifyF02Sandbox(root), null, 2)}\n`, { flag: "wx" });
    } else if (mode === "snapshot" && root && output) {
      writeFileSync(output, `${JSON.stringify(snapshotF02Inputs(root), null, 2)}\n`, { flag: "wx" });
    } else if (mode === "compare" && root && output && beforeFile) {
      const evidence = compareF02Inputs(root, JSON.parse(readFileSync(beforeFile, "utf8")));
      writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
      if (!evidence.ok) fail("inputs mudaram durante a execução");
    } else fail("modo inválido");
  } catch (error) {
    process.stderr.write(`[verify] ${error instanceof Error ? error.message : "F02 E2E: falha desconhecida"}\n`);
    process.exitCode = 1;
  }
}
