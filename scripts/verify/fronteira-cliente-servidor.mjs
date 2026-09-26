#!/usr/bin/env node
/**
 * RÉGUA — servidor não CHAMA função de módulo "use client".
 *
 * 25/09/2026, na fase F24 de outro worktree: o layout de `/app` chamava uma
 * função exportada de um módulo `"use client"`. O `next start` recusa
 * ("Attempted to call X() from the server but X is on the client") e TODA
 * renderização da área caiu — só os testes de API pura passaram.
 *
 * O que torna essa classe perigosa: `next dev` e o jsdom NÃO acusam. A suíte
 * unitária fica verde sobre um produto que não renderiza em produção.
 *
 * ─── A distinção que a régua precisa fazer ──────────────────────────────────
 *
 * RENDERIZAR componente de cliente a partir do servidor é o padrão CORRETO do
 * App Router e não pode ser acusado. CHAMAR função exportada do mesmo módulo é
 * o defeito. Um filtro ingênuo confunde os dois: ao varrer isto pela primeira
 * vez eu acusei `signup/page.tsx` por importar `SignupForm`, que é legítimo.
 *
 * O que separa os casos é a ORIGEM do nome somada ao USO: o nome tem de ter
 * vindo daquele módulo cliente por `import`, E ser chamado com `(`. Só o nome
 * solto no arquivo não basta.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RAIZ explícita, e SEMPRE impressa.
 *
 * A primeira versão lia só o CWD e ignorava argumento. Outra frente passou o
 * caminho da árvore dela por argv, de dentro da minha, e a régua mediu a MINHA
 * duas vezes — devolvendo `ok: true` com um número confiante sobre a árvore
 * errada. Medição silenciosamente errada é pior que erro: ela convence.
 *
 * Agora a raiz vem de argv[2] ou do CWD, some do jeito nenhum do relatório, e
 * caminho inexistente PARA em vez de cair no CWD.
 */
const RAIZ = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
if (process.argv[2] && !existsSync(RAIZ)) {
  console.error(`[verify] fronteira cliente/servidor: raiz inexistente: ${RAIZ}`);
  process.exit(2);
}

const IGNORAR = new Set(["node_modules", ".next", ".git", ".verify-logs", ".prod", ".staging", "test-results"]);
const CODIGO = /\.(ts|tsx)$/;

function varrer(raiz) {
  if (!existsSync(raiz)) return [];
  const saida = [];
  (function anda(d) {
    for (const e of readdirSync(d)) {
      if (IGNORAR.has(e)) continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) anda(p);
      else if (CODIGO.test(e) && !/\.(test|spec)\./.test(e)) saida.push(p);
    }
  })(raiz);
  return saida;
}

const todos = ["app", "components", "lib", "src"].map((d) => path.join(RAIZ, d)).flatMap(varrer);
const ehCliente = (txt) => /^\s*["']use client["']/m.test(txt.split("\n").slice(0, 3).join("\n"));

/** Export que NÃO é componente: nome começando em minúscula. */
function exportsNaoComponente(txt) {
  const nomes = new Set();
  for (const m of txt.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([a-z][A-Za-z0-9_]*)/g)) nomes.add(m[1]);
  return nomes;
}

const clientes = new Map();
for (const f of todos) {
  const txt = readFileSync(f, "utf8");
  if (!ehCliente(txt)) continue;
  const n = exportsNaoComponente(txt);
  if (n.size > 0) clientes.set(f, n);
}

/** Resolve o especificador de import para um caminho do repo, se der. */
function resolver(deQuem, spec) {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.normalize(path.join(path.dirname(deQuem), spec));
  else return null;
  for (const s of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + s)) return base + s;
  }
  return null;
}

const problemas = [];
let servidoresVarridos = 0;

for (const f of todos) {
  const txt = readFileSync(f, "utf8");
  if (ehCliente(txt)) continue;      // arquivo de cliente pode chamar à vontade
  if (!/^app\//.test(path.relative(RAIZ, f))) continue;   // só o que o Next renderiza no servidor
  servidoresVarridos++;

  for (const m of txt.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const alvo = resolver(f, m[2]);
    if (!alvo || !clientes.has(alvo)) continue;
    const doCliente = clientes.get(alvo);
    for (const bruto of m[1].split(",")) {
      // `a as b` — o que importa é o nome LOCAL, que é como ele será chamado.
      const partes = bruto.trim().split(/\s+as\s+/);
      const original = partes[0]?.trim();
      const local = (partes[1] ?? partes[0])?.trim();
      if (!original || !local || !doCliente.has(original)) continue;
      // CHAMADA, não renderização: `nome(` fora da linha do próprio import.
      const chamada = new RegExp(`(?<![.\\w])${local}\\s*\\(`);
      const linhas = txt.split("\n").filter((l) => !/^\s*import\b/.test(l));
      if (chamada.test(linhas.join("\n"))) {
        problemas.push(
          `${path.relative(RAIZ, f)} CHAMA ${local}() importado de ${path.relative(RAIZ, alvo)}, que é "use client". O next start recusa e a rota inteira cai — mova a função para um módulo neutro.`,
        );
      }
    }
  }
}

const resultado = {
  ok: problemas.length === 0,
  raiz: RAIZ,
  modulos_cliente_com_funcao: clientes.size,
  arquivos_de_servidor_varridos: servidoresVarridos,
  problemas,
};
console.info(JSON.stringify(resultado, null, 2));
if (problemas.length > 0) {
  for (const p of problemas) console.error(`[verify] fronteira cliente/servidor: ${p}`);
  process.exit(1);
}
