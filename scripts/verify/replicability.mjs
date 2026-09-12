/**
 * `replicability` (§8.3, ADR-029 §1): o navegador roda duas vezes na mesma
 * árvore — `E2E_TENANT=deka` e depois `E2E_TENANT=demo2` — e este módulo mede
 * `src_diff_lines` entre as duas.
 *
 * A fórmula é a de §8.3, `git diff --numstat -- src/ | awk '{s+=$1+$2}'`,
 * aplicada entre DUAS árvores de `src/`: a de antes da primeira execução e a
 * de depois da segunda. Cada árvore sai de `git write-tree` sobre um índice
 * TEMPORÁRIO (`GIT_INDEX_FILE`), então nem o índice real nem a árvore de
 * trabalho são tocados — o gate continua medindo a mesma árvore que o
 * snapshot SHA-256 dos inputs mede.
 *
 * Uso:
 *   node scripts/verify/replicability.mjs tree <raiz>            → imprime o sha da árvore de src/
 *   node scripts/verify/replicability.mjs report <raiz> <saida.json> <tenants,csv> <tree-antes> <tree-depois>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TREE = /^[0-9a-f]{40}$/;

function git(root, args, env = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

/** Árvore de `src/` da ÁRVORE DE TRABALHO (inclui não rastreados, exclui ignorados). */
export function srcTree(root) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-src-tree-"));
  const index = path.join(scratch, "index");
  try {
    git(root, ["read-tree", "--empty"], { GIT_INDEX_FILE: index });
    git(root, ["add", "-A", "--", "src"], { GIT_INDEX_FILE: index });
    const tree = git(root, ["write-tree"], { GIT_INDEX_FILE: index });
    if (!TREE.test(tree)) throw new Error("write-tree não devolveu sha");
    return tree;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** §8.3: soma de linhas adicionadas e removidas em src/ entre as duas árvores. */
export function srcDiffLines(root, before, after) {
  if (!TREE.test(before) || !TREE.test(after)) throw new Error("árvore inválida");
  if (before === after) return 0;
  const numstat = git(root, ["diff", "--numstat", before, after, "--"]);
  let soma = 0;
  for (const linha of numstat.split("\n").filter(Boolean)) {
    const [add, del] = linha.split("\t");
    // `-` é binário: conta como mudança de uma linha cada, nunca como zero.
    soma += (add === "-" ? 1 : Number(add)) + (del === "-" ? 1 : Number(del));
  }
  return soma;
}

export function replicabilityReport(root, tenants, before, after) {
  const lista = tenants.split(",").map((t) => t.trim()).filter(Boolean);
  if (lista.length < 2) throw new Error("replicabilidade exige ao menos dois tenants");
  if (new Set(lista).size !== lista.length) throw new Error("tenants repetidos");
  const diff = srcDiffLines(root, before, after);
  return {
    ok: diff === 0,
    tenants: lista.map((slug) => ({ slug, run: `e2e-${slug}` })),
    src_tree_before: before,
    src_tree_after: after,
    src_diff_lines: diff,
    org_a: "seed-replica",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, output, tenants, before, after] = process.argv.slice(2);
  try {
    if (mode === "tree" && root) {
      process.stdout.write(`${srcTree(root)}\n`);
    } else if (mode === "report" && root && output && tenants && before && after) {
      const evidence = replicabilityReport(root, tenants, before, after);
      writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
      if (!evidence.ok) throw new Error(`src/ mudou entre as execuções: src_diff_lines=${evidence.src_diff_lines}`);
    } else throw new Error("modo inválido");
  } catch (error) {
    process.stderr.write(`[verify] replicability: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
