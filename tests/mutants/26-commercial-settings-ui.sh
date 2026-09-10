#!/usr/bin/env bash
# Muta somente o módulo carregado pelo Vite; não edita a árvore do produto.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const scratch = mkdtempSync(path.join(tmpdir(), "commercial-settings-mutants-"));
const cases = [
  ["materializa-defaults", "app/app/settings/commercial/_values.ts", "JSON.stringify(baseline[key]) !== JSON.stringify(draft[key])", "true", "commercial-fields-ui.test.tsx", "patch não materializa"],
  ["ignora-retorno", "app/app/settings/commercial/_client.tsx", "setDraft(valuesOf(response.data));", "setDraft(draft);", "commercial-settings-ui.test.tsx", "envia só seis campos alterados"],
  ["viewer-escreve", "app/app/settings/commercial/_client.tsx", "profile.capabilities.can_write_commercial && !blocked", "!blocked", "commercial-settings-ui.test.tsx", "viewer ou suporte readonly"],
  ["pagina-plataforma", "app/app/settings/commercial/page.tsx", "(user.is_platform_admin && !user.support)", "false", "commercial-settings-page.test.tsx", "nega plataforma direta"],
  ["cartao-plataforma", "lib/navigation/interface.ts", "if (platform && d.allowPlatform === false) return false;", "if (false) return false;", "navegacao-registry.test.ts", "platform admin mantém todos"],
];
let killed = 0;
try {
  for (const [name, relative, from, to, suite, titlePattern] of cases) {
    const target = path.join(root, relative);
    assert.equal(readFileSync(target, "utf8").split(from).length, 2, `${name}: alvo deve ser único`);
    const config = path.join(scratch, `${name}.config.mjs`);
    const report = path.join(scratch, `${name}.json`);
    writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
export default { ...base, plugins: [...(base.plugins ?? []), {
  name: ${JSON.stringify(name)}, enforce: "pre",
  transform(code, id) {
    if (id.split("?")[0] !== ${JSON.stringify(target)}) return;
    if (code.split(${JSON.stringify(from)}).length !== 2) throw new Error("alvo da mutação não é único no módulo carregado");
    return { code: code.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}), map: null };
  }
}] };`);
    const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", `tests/unit/${suite}`, "--config", config, "--maxWorkers=1", "--allowOnly=false", "--testNamePattern", titlePattern, "--reporter=json", "--outputFile", report], { cwd: root, encoding: "utf8", timeout: 45000 });
    assert.equal(run.status, 1, `${name}: mutante sem veredito nominal\n${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(readFileSync(report, "utf8"));
    const failed = result.testResults.flatMap((file) => file.assertionResults).filter((test) => test.status === "failed");
    assert.equal(failed.length, 1, `${name}: esperava uma asserção nominal reprovada`);
    assert.match(failed[0].title, new RegExp(titlePattern), `${name}: falha em outro caso`);
    const message = failed[0].failureMessages.join("\n");
    // Vitest e jest-dom usam três formatos observados. Import/configuração não
    // conta: exige AssertionError ou o frame do matcher de expect/rejects.
    const assertionFailure = /AssertionError/.test(message)
      || (/^Error: expect\(/.test(message) && message.includes("__VITEST_EXTEND_ASSERTION__"))
      || (/^Error: promise resolved .* instead of rejecting/.test(message) && message.includes("__VITEST_REJECTS__"));
    assert.ok(assertionFailure, `${name}: erro de infraestrutura não mata mutante\n${message}`);
    killed++;
  }
  process.stdout.write(`mutants_killed=${killed}/${cases.length} (commercial-settings-ui; asserções observadas)\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
JS
