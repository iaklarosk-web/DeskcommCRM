#!/usr/bin/env bash
# F06-T01, G-38: a linha `api.request` do guarda de papel (§5.17, §7.7).
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# `requireRole` é o único ponto por onde toda rota autenticada passa e onde o
# `organization_id` acaba de ser resolvido — é ali que a linha JSON com
# `request_id` e `organization_id` sai. A mutação apaga a emissão do caminho
# FELIZ (`allowed`), que é o de 99% das requisições: nenhuma exceção sobe,
# nenhuma rota muda de resposta, e o produto passa a operar mudo — sem
# correlação entre erro e tenant, que é o que F06-T01 existe para impedir.
#
# Tem de deixar "1 request → 1 linha JSON" vermelho em
# tests/unit/f06-t01-logs-por-rota.test.ts.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = "lib/auth/require-role.ts";
const from = '  logar("allowed", org.orgId, user.id, 200);\n  return { ok: true, user, org: { ...org, role: effectiveRole as Role } };';
const to = '  return { ok: true, user, org: { ...org, role: effectiveRole as Role } }; /* MUTANTE: guarda mudo */';
const title = "1 request → 1 linha JSON com organization_id e request_id (o guarda emite)";
// `-t` é regex: os parênteses do título não podem entrar no filtro.
const filtro = "1 request → 1 linha JSON com organization_id e request_id";
const scratch = mkdtempSync(path.join(os.tmpdir(), "f06-guarda-sem-log-mutant-"));

try {
  const source = readFileSync(path.join(root, file), "utf8");
  assert.equal(source.split(from).length - 1, 1, "alvo do mutante mudou");

  const config = path.join(scratch, "vite-mutant.config.mjs");
  const output = path.join(scratch, "result.json");
  writeFileSync(
    config,
    `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
     import path from "node:path";
     const target=${JSON.stringify(path.join(root, file))};
     const from=${JSON.stringify(from)};
     const to=${JSON.stringify(to)};
     export default {...base,plugins:[...(base.plugins??[]),{
       name:"f06-guarda-sem-log-mutant",enforce:"pre",
       transform(code,id){
         if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
         const hits=code.split(from).length-1;
         if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return {code:code.replace(from,to),map:null};
       }
     }]};`,
  );

  const run = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/unit/f06-t01-logs-por-rota.test.ts",
      "-t",
      filtro,
      "--config",
      config,
      "--maxWorkers=1",
      "--allowOnly=false",
      "--reporter=json",
      "--outputFile",
      output,
    ],
    { cwd: root, encoding: "utf8", timeout: 120_000 },
  );

  assert.equal(run.status, 1, "mutante não foi reprovado");
  const report = JSON.parse(readFileSync(output, "utf8"));
  const alvo = report.testResults
    .flatMap((entry) => entry.assertionResults)
    .find((test) => test.title === title);
  assert.equal(alvo?.status, "failed", "a prova não detectou o guarda mudo");
  assert.match(
    alvo.failureMessages.join("\n"),
    /expected \[\] to have a length of 1|toHaveLength/,
    "a falha não foi a ausência da linha de log",
  );
  process.stdout.write("mutants_killed=1/1 (f06-guarda-sem-linha-de-log; asserção observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
