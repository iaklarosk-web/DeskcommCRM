/**
 * F02/T04 — composição de sessão ausente sem repetir 34 mocks de rota.
 *
 * O ramo comportamental 401 é exercitado no gate compartilhado. Uma varredura
 * por handler liga 32 operações F02 a esse gate. As duas exceções históricas,
 * que autenticam manualmente, são chamadas de verdade com `getUser() = null`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

const handlers = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  mfaEmDivida: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/app/api/v1/contacts/_handler", () => ({
  listContactsHandler: handlers.list,
  getContactHandler: handlers.get,
  createContactHandler: handlers.create,
  patchContactHandler: handlers.patch,
  deleteContactHandler: handlers.remove,
}));

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_ROOT = process.env.F02_T04_SOURCE_ROOT ?? ROOT;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Operation = {
  id: string;
  file: string;
  method: Method;
  auth: "gate" | "manual";
};
const OPERATIONS: Operation[] = [
  { id: "S01", file: "app/api/v1/settings/commercial/route.ts", method: "GET", auth: "gate" },
  { id: "S02", file: "app/api/v1/settings/commercial/route.ts", method: "PATCH", auth: "gate" },
  { id: "D01", file: "app/api/v1/crm-orders/daily/route.ts", method: "GET", auth: "gate" },
  { id: "K01", file: "app/api/v1/crm-orders/[id]/checks/route.ts", method: "GET", auth: "gate" },
  { id: "K02", file: "app/api/v1/crm-orders/[id]/checks/route.ts", method: "POST", auth: "gate" },

  {
    id: "C01",
    file: "app/api/v1/contacts/route.ts",
    method: "GET",
    auth: "manual",
  },
  {
    id: "C02",
    file: "app/api/v1/contacts/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "C03",
    file: "app/api/v1/contacts/[id]/route.ts",
    method: "GET",
    auth: "manual",
  },
  {
    id: "C04",
    file: "app/api/v1/contacts/[id]/route.ts",
    method: "PATCH",
    auth: "gate",
  },
  {
    id: "C05",
    file: "app/api/v1/contacts/[id]/route.ts",
    method: "DELETE",
    auth: "gate",
  },
  {
    id: "C06",
    file: "app/api/v1/contacts/[id]/timeline/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "C07",
    file: "app/api/v1/contacts/[id]/crm-summary/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "E01",
    file: "app/api/v1/companies/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "E02",
    file: "app/api/v1/companies/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "E03",
    file: "app/api/v1/companies/[id]/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "E04",
    file: "app/api/v1/companies/[id]/route.ts",
    method: "PATCH",
    auth: "gate",
  },
  {
    id: "E05",
    file: "app/api/v1/companies/[id]/route.ts",
    method: "DELETE",
    auth: "gate",
  },
  {
    id: "P01",
    file: "app/api/v1/products/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "P02",
    file: "app/api/v1/products/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "P03",
    file: "app/api/v1/products/[id]/route.ts",
    method: "PATCH",
    auth: "gate",
  },
  {
    id: "P04",
    file: "app/api/v1/products/[id]/route.ts",
    method: "DELETE",
    auth: "gate",
  },
  {
    id: "O01",
    file: "app/api/v1/crm-orders/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "O02",
    file: "app/api/v1/crm-orders/[id]/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "O03",
    file: "app/api/v1/crm-orders/commands/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "O04",
    file: "app/api/v1/crm-orders/[id]/events/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "N01",
    file: "app/api/v1/crm-notes/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "N02",
    file: "app/api/v1/crm-notes/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "T01",
    file: "app/api/v1/crm-orders/[id]/tasks/route.ts",
    method: "GET",
    auth: "gate",
  },
  {
    id: "T02",
    file: "app/api/v1/tasks/commands/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "T03",
    file: "app/api/v1/crm-task-events/route.ts",
    method: "GET",
    auth: "gate",
  },
  { id: "L01", file: "app/api/v1/tasks/route.ts", method: "GET", auth: "gate" },
  {
    id: "L02",
    file: "app/api/v1/tasks/route.ts",
    method: "POST",
    auth: "gate",
  },
  {
    id: "L03",
    file: "app/api/v1/tasks/[id]/route.ts",
    method: "PATCH",
    auth: "gate",
  },
  {
    id: "L04",
    file: "app/api/v1/tasks/[id]/route.ts",
    method: "DELETE",
    auth: "gate",
  },
];

function handler(file: string, method: Method, source?: string): ts.FunctionDeclaration {
  const prepared = path.join(ROOT, file);
  const text =
    source ?? readFileSync(existsSync(prepared) ? prepared : path.join(SOURCE_ROOT, file), "utf8");
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = parsed.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === method &&
      !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
  expect(found, `${file}:${method}`).toHaveLength(1);
  return found[0]!;
}

function calls(node: ts.Node, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (current: ts.Node) => {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === name
    ) {
      found.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function expectedMinimum(id: string): "viewer" | "agent" | "manager" {
  if (["P02", "P03", "P04", "S02"].includes(id)) return "manager";
  if (
    [
      "S01",
      "D01",
      "K01",
      "C01",
      "C03",
      "C06",
      "C07",
      "E01",
      "E03",
      "P01",
      "O01",
      "O02",
      "O04",
      "N01",
      "T01",
      "T03",
      "L01",
    ].includes(id)
  ) {
    return "viewer";
  }
  return "agent";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAuthUser).mockResolvedValue(null);
  vi.mocked(mfaEmDivida).mockResolvedValue(false);
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  } as never);
});

describe("sessão ausente — composição 34/34", () => {
  it("o gate compartilhado devolve 401 antes de resolver tenant ou banco", async () => {
    const result = await requireRole("viewer", { requestId: "req-sem-sessao" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("requireRole aceitou sessão ausente");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "unauthenticated" },
    });
    expect(resolveActiveOrg).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("o gate aplica a matriz viewer/agent/manager para cada mínimo usado", async () => {
    const roles = ["viewer", "agent", "manager"] as const;
    for (const effective of roles) {
      const user = {
        id: "11111111-1111-4111-8111-111111111111",
        idioma: "pt-BR",
        is_platform_admin: false,
        organizations: [
          {
            organization_id: "22222222-2222-4222-8222-222222222222",
            organization_name: "Org",
            role: effective,
          },
        ],
      } as AuthUser;
      vi.mocked(loadAuthUser).mockResolvedValue(user);
      vi.mocked(resolveActiveOrg).mockResolvedValue({
        orgId: "22222222-2222-4222-8222-222222222222",
        name: "Org",
        role: effective,
      });
      vi.mocked(createClient).mockResolvedValue({
        rpc: vi.fn(async () => ({ data: effective, error: null })),
      } as never);
      for (const minimum of roles) {
        const result = await requireRole(minimum as Role);
        expect(result.ok, `${effective} >= ${minimum}`).toBe(
          ROLE_RANK[effective] >= ROLE_RANK[minimum],
        );
      }
    }
  });

  it("liga 32 operações ao requireRole com o mínimo esperado e cataloga as 2 manuais", () => {
    const gated = OPERATIONS.filter((operation) => operation.auth === "gate");
    const manual = OPERATIONS.filter((operation) => operation.auth === "manual");
    expect(OPERATIONS).toHaveLength(34);
    expect(gated).toHaveLength(32);
    expect(manual.map(({ id }) => id)).toEqual(["C01", "C03"]);
    for (const operation of gated) {
      const connected = calls(handler(operation.file, operation.method), "requireRole");
      expect(connected, operation.id).toHaveLength(1);
      const minimum = connected[0]!.arguments[0];
      expect(minimum && ts.isStringLiteral(minimum) ? minimum.text : null, operation.id).toBe(
        expectedMinimum(operation.id),
      );
    }
    expect(manual.map(({ id }) => expectedMinimum(id))).toEqual(["viewer", "viewer"]);
  });

  it("C01 e C03 devolvem 401 reais sem chamar handler de domínio", async () => {
    const [{ GET: list }, { GET: get }] = await Promise.all([
      import("@/app/api/v1/contacts/route"),
      import("@/app/api/v1/contacts/[id]/route"),
    ]);

    const listResponse = await list(new NextRequest("http://local/api/v1/contacts"));
    const getResponse = await get(new NextRequest("http://local/api/v1/contacts/id"), {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });

    for (const response of [listResponse, getResponse]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "unauthenticated" },
      });
    }
    expect(handlers.list).not.toHaveBeenCalled();
    expect(handlers.get).not.toHaveBeenCalled();
  });
});
