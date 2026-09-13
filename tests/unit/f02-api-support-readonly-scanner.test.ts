/**
 * F02/T04 — conexão entre as 17 escritas comerciais e a cerca compartilhada de
 * suporte somente leitura. O comportamento 403 do helper permanece coberto em
 * `suporte-guardas.test.ts`; aqui a AST prova que cada handler o chama.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_ROOT = process.env.F02_T04_SOURCE_ROOT ?? ROOT;
type Method = "POST" | "PATCH" | "DELETE";
type WriteOperation = { id: string; file: string; method: Method };
const WRITES: WriteOperation[] = [
  { id: "S02", file: "app/api/v1/settings/commercial/route.ts", method: "PATCH" },
  { id: "K02", file: "app/api/v1/crm-orders/[id]/checks/route.ts", method: "POST" },
  { id: "C02", file: "app/api/v1/contacts/route.ts", method: "POST" },
  { id: "C04", file: "app/api/v1/contacts/[id]/route.ts", method: "PATCH" },
  { id: "C05", file: "app/api/v1/contacts/[id]/route.ts", method: "DELETE" },
  { id: "E02", file: "app/api/v1/companies/route.ts", method: "POST" },
  { id: "E04", file: "app/api/v1/companies/[id]/route.ts", method: "PATCH" },
  { id: "E05", file: "app/api/v1/companies/[id]/route.ts", method: "DELETE" },
  { id: "P02", file: "app/api/v1/products/route.ts", method: "POST" },
  { id: "P03", file: "app/api/v1/products/[id]/route.ts", method: "PATCH" },
  { id: "P04", file: "app/api/v1/products/[id]/route.ts", method: "DELETE" },
  {
    id: "O03",
    file: "app/api/v1/crm-orders/commands/route.ts",
    method: "POST",
  },
  { id: "N02", file: "app/api/v1/crm-notes/route.ts", method: "POST" },
  { id: "T02", file: "app/api/v1/tasks/commands/route.ts", method: "POST" },
  { id: "L02", file: "app/api/v1/tasks/route.ts", method: "POST" },
  { id: "L03", file: "app/api/v1/tasks/[id]/route.ts", method: "PATCH" },
  { id: "L04", file: "app/api/v1/tasks/[id]/route.ts", method: "DELETE" },
];

function filePath(file: string) {
  const prepared = path.join(ROOT, file);
  return existsSync(prepared) ? prepared : path.join(SOURCE_ROOT, file);
}

function source(operation: WriteOperation, override?: string) {
  const text = override ?? readFileSync(filePath(operation.file), "utf8");
  return ts.createSourceFile(operation.file, text, ts.ScriptTarget.Latest, true);
}

function exportedHandler(operation: WriteOperation, override?: string) {
  const parsed = source(operation, override);
  const found = parsed.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === operation.method &&
      !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
  expect(found, `${operation.file}:${operation.method}`).toHaveLength(1);
  return { parsed, handler: found[0]! };
}

function supportCalls(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (current: ts.Node) => {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "requireSupportWrite"
    ) {
      found.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function hasSupportGuard(operation: WriteOperation, override?: string) {
  const { handler } = exportedHandler(operation, override);
  return supportCalls(handler).length > 0;
}

function removeSupportGuard(operation: WriteOperation): string {
  const original = readFileSync(filePath(operation.file), "utf8");
  const { parsed, handler } = exportedHandler(operation, original);
  const calls = supportCalls(handler);
  expect(calls, `${operation.id} precisa de uma única cerca conectada`).toHaveLength(1);
  const callee = calls[0]!.expression;
  return `${original.slice(0, callee.getStart(parsed))}guardRemoved${original.slice(callee.getEnd())}`;
}

describe("suporte readonly — scanner comercial 17/17", () => {
  it("o catálogo contém exatamente as 17 escritas F02", () => {
    expect(WRITES).toHaveLength(17);
    expect(new Set(WRITES.map(({ id }) => id)).size).toBe(17);
  });

  it("cada escrita chama requireSupportWrite dentro do próprio handler", () => {
    const uncovered = WRITES.filter((operation) => !hasSupportGuard(operation)).map(
      ({ id, file, method }) => `${id} ${file}:${method}`,
    );
    expect(uncovered, "support_guard=17/17").toEqual([]);
  });

  it("o scanner reprova a remoção da guarda em cada uma das 17 escritas", () => {
    const falseGreens = WRITES.filter((operation) =>
      hasSupportGuard(operation, removeSupportGuard(operation)),
    ).map(({ id }) => id);
    expect(falseGreens, "mutantes de conexão mortos=17/17").toEqual([]);
  });
});
