import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.cwd();
const scratch = mkdtempSync(path.join(os.tmpdir(), "debts-mutants-"));
const mutants = [
  { name: "agenda-inicio", file: "components/agenda/HistoricoDaAgenda.tsx", from: "new Date(a.termina).getTime() <= agora.getTime()", to: "new Date(a.comeca).getTime() < agora.getTime()",
    suite: "tests/unit/agenda-separar-historico.test.tsx", title: "o compromisso EM ANDAMENTO ainda é Próximos — começou, mas não terminou" },
  { name: "stop-pausa-manual", file: "lib/followup/reactivity.ts", from: '["active", "waiting_reply", "paused_handoff", "paused_manual"]', to: '["active", "waiting_reply", "paused_handoff"]',
    suite: "tests/unit/followup-reactivity-manual.test.ts", title: "STOP encerra paused_manual pelo adapter e replay não duplica o evento" },
  { name: "handoff-pausa-manual", file: "lib/followup/reactivity.ts", from: 'if (e.status === "paused_manual") continue;', to: "// MUTANT: handoff pode sobrescrever pausa manual",
    suite: "tests/unit/followup-reactivity-manual.test.ts", title: "handoff pause e inbound comum preservam a pausa manual" },
  { name: "webhook-limite", file: "app/api/v1/webhooks/in/[token]/route.ts", from: "if (!rl.allowed) {", to: "if (false) {",
    suite: "tests/unit/webhooks-inbound-rate-limit.test.ts", title: "limite HTTP usa contador real e recusa antes do banco" },
];
try {
  for (const mutant of mutants) {
    const source = readFileSync(path.join(root, mutant.file), "utf8");
    assert.equal(source.split(mutant.from).length, 2, `Alvo deve ser único: ${mutant.name}`);
    const config = path.join(scratch, `${mutant.name}.config.mjs`);
    const output = path.join(scratch, `${mutant.name}.json`);
    writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
export default { ...base, plugins: [...(base.plugins ?? []), {
  name: "debt-regression", enforce: "pre",
  transform(code, id) {
    if (id.split("?")[0] !== ${JSON.stringify(path.join(root, mutant.file))}) return;
    return { code: code.replace(${JSON.stringify(mutant.from)}, ${JSON.stringify(mutant.to)}), map: null };
  }
}] };`);
    const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", mutant.suite,
      "--config", config, "--maxWorkers=1", "--allowOnly=false", "--reporter=json", "--outputFile", output],
    { cwd: root, encoding: "utf8", timeout: 45000 });
    assert.equal(run.status, 1, `${mutant.name}: não foi reprovado por teste\n${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(readFileSync(output, "utf8"));
    const target = result.testResults.flatMap((file) => file.assertionResults).find((test) => test.title === mutant.title);
    assert.equal(target?.status, "failed", `${mutant.name}: falha não ocorreu na asserção esperada`);
    assert.ok(target.failureMessages.some((message) => /AssertionError/.test(message)), `${mutant.name}: erro de infraestrutura não mata mutante`);
    process.stdout.write(`MORTO ${mutant.name}: ${mutant.title}\n`);
  }
  const gate = readFileSync("scripts/verify/report.mjs", "utf8");
  const target = 'const unknownDebt = debt.filter((entry) => !KNOWN_DEBT.some((known) => Object.keys(known).every((key) => known[key] === entry[key])));';
  assert.equal(gate.split(target).length, 2);
  const copy = path.join(scratch, "report.mjs");
  writeFileSync(copy, gate.replace(target, "const unknownDebt = []; // MUTANT: aceita dívida aposentada"));
  copyFileSync(path.join(root, "scripts/verify/f02-e2e.mjs"), path.join(scratch, "f02-e2e.mjs"));
  const run = spawnSync(process.execPath, ["--test", "--test-name-pattern=retired debt cannot return", "tests/verify/gate.cases.mjs"],
    { cwd: root, encoding: "utf8", timeout: 15000, env: { ...process.env, VERIFY_GATE_MODULE: copy } });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /not ok .*retired debt cannot return/);
  assert.match(run.stdout, /ERR_ASSERTION/);
  process.stdout.write("MORTO gate-divida-aposentada: asserção esperada\nmutants_killed=5/5 (dívidas saneadas)\n");
} finally { rmSync(scratch, { recursive: true, force: true }); }
