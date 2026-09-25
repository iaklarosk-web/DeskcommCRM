#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os"; import path from "node:path";
const root=process.cwd(), file="app/api/v1/crm-orders/commands/route.ts", from="if (authz.user.support)", to="if (false)", title="nega viewer e suporte antes do serviço", scratch=mkdtempSync(path.join(os.tmpdir(),"orders-api-mutant-"));
try {
 assert.equal(readFileSync(path.join(root,file),"utf8").split(from).length,2);
 const config=path.join(scratch,"vite-mutant.config.mjs"), output=path.join(scratch,"result.json");
 writeFileSync(config,`import base from ${JSON.stringify(path.join(root,"vitest.config.ts"))}; export default { ...base, plugins: [...(base.plugins ?? []), { name:"orders-api-mutant", enforce:"pre", transform(code,id) { if(id.split("?")[0] !== ${JSON.stringify(path.join(root,file))}) return; return {code:code.replace(${JSON.stringify(from)},${JSON.stringify(to)}),map:null}; } }] };`);
 const run=spawnSync(process.execPath,[path.join(root,"node_modules/vitest/vitest.mjs"),"run","tests/unit/crm-orders-api.test.ts","--config",config,"--maxWorkers=1","--allowOnly=false","--reporter=json","--outputFile",output],{cwd:root,encoding:"utf8",timeout:45000});
 assert.equal(run.status,1,run.stderr); const result=JSON.parse(readFileSync(output,"utf8")); const target=result.testResults.flatMap(x=>x.assertionResults).find(x=>x.title===title); assert.equal(target?.status,"failed"); assert.ok(target.failureMessages.some(message => message.includes("201") && message.includes("403")), "falha de infraestrutura não conta: esperado serviço indevidamente autorizado"); process.stdout.write("mutants_killed=1/1 (orders api support)\n");
} finally { rmSync(scratch,{recursive:true,force:true}); }
NODE
