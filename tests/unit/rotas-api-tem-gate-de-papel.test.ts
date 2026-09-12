/**
 * F01-T07 — invariante 1 da §5.4: toda rota /api/v1 tem gate de PAPEL
 * (guard direto/delegado ou recusa 403 por roleAtLeast), ou é
 * pública declarada (PUBLIC_PATHS — auth mora dentro da rota), ou pertence
 * somente à sessão autenticada com prova própria, ou está na dívida abaixo.
 *
 * O middleware (proxy.ts) já autentica a SESSÃO de tudo que não é público —
 * esta varredura mede a granularidade de papel, não porta aberta. Mesma
 * mecânica da rls-completude: a lista de dívida é a FOTOGRAFIA de 2026-09-07
 * (as rotas herdadas que fazem auth por sessão + RLS sem gate de papel,
 * achado 3 da auditoria A / ADR-003) — rota NOVA nunca entra aqui: ganha
 * requireRole ou entra em PUBLIC_PATHS com justificativa. Reduzir esta lista
 * (dando gate a uma rota e removendo a linha) é o caminho; engordá-la reprova.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PUBLIC_PATHS } from "@/lib/auth/public-paths";

const RAIZ = path.resolve(__dirname, "../..");

/** Fotografia 2026-09-07: 24 rotas; onboarding/session ganhou gate na v1.17.0. */
const DIVIDA_CONHECIDA = new Set([
  "app/api/v1/ai/providers/[provider]/models/route.ts",
  "app/api/v1/auth/realtime-token/route.ts",
  "app/api/v1/channel-sessions/[id]/qr/route.ts",
  "app/api/v1/channels/partner/templates/media/route.ts",
  "app/api/v1/channels/partner/templates/route.ts",
  "app/api/v1/contacts/[id]/avatar/route.ts",
  "app/api/v1/contacts/duplicates/route.ts",
  "app/api/v1/conversations/[id]/messages/route.ts",
  "app/api/v1/conversations/[id]/retention/route.ts",
  "app/api/v1/conversations/counts/route.ts",
  "app/api/v1/conversations/route.ts",
  "app/api/v1/leads/[id]/timeline/route.ts",
  "app/api/v1/leads/proposals/route.ts",
  "app/api/v1/mcp/tools/route.ts",
  "app/api/v1/messages/[id]/media/route.ts",
  "app/api/v1/onboarding/whatsapp/qr/route.ts",
  "app/api/v1/pipelines/[id]/board/route.ts",
  "app/api/v1/system/update/route.ts",
  "app/api/v1/system/version/route.ts",
]);

// Não é pública nem dívida de RBAC: informa somente a própria sessão, sem
// selecionar/operar tenant. A prova comportamental abaixo cobra 401 antes da
// consulta e o retorno limitado à assinatura, mesmo se a RPC trouxer mais dados.
const ROTAS_DA_PROPRIA_SESSAO = new Set([
  "app/api/v1/auth/support/route.ts",
  // Sair precisa continuar possível depois de revogar o papel de plataforma.
  // O ator e session_id enviados à RPC vêm exclusivamente do Auth validado.
  "app/api/v1/admin/impersonate/end/route.ts",
]);

type LeitorDeFonte = (arquivo: string) => string;
const lerFonte: LeitorDeFonte = (arquivo) => readFileSync(path.join(RAIZ, arquivo), "utf8");

function sintaxe(arquivo: string, codigo: string): ts.SourceFile {
  return ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true);
}

function contemNo(no: ts.Node, confere: (filho: ts.Node) => boolean): boolean {
  return confere(no) || (ts.forEachChild(no, (filho) => contemNo(filho, confere) || undefined) ?? false);
}

function temChamadaDeGate(no: ts.Node): boolean {
  if (ts.isCallExpression(no) && ts.isIdentifier(no.expression)
    && ["requireRole", "requirePlatformAdmin"].includes(no.expression.text)) return true;
  // /marca/logo aplica o mesmo predicado de papel com resposta JSON própria.
  // A comparação solta não basta: ela precisa NEGAR papel no if e retornar 403.
  if (ts.isIfStatement(no)
    && contemNo(no.expression, (filho) => ts.isPrefixUnaryExpression(filho)
      && filho.operator === ts.SyntaxKind.ExclamationToken
      && ts.isCallExpression(filho.operand) && ts.isIdentifier(filho.operand.expression)
      && filho.operand.expression.text === "roleAtLeast")
    && contemNo(no.thenStatement, (filho) => ts.isReturnStatement(filho)
      && contemNo(filho, (parte) => ts.isNumericLiteral(parte) && parte.text === "403"))) return true;
  return ts.forEachChild(no, (filho) => temChamadaDeGate(filho) || undefined) ?? false;
}

function temGateDePapel(arquivo: string, ler: LeitorDeFonte = lerFonte): boolean {
  const fonte = sintaxe(arquivo, ler(arquivo));
  // A AST ignora comentários e imports sem chamada: ambos satisfaziam o regex.
  if (temChamadaDeGate(fonte)) return true;

  const handlers = fonte.statements.filter((no): no is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(no) && !!no.name
    && /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(no.name.text)
    && !!no.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
  );
  return handlers.length > 0 && handlers.every((handler) => {
    // Só a delegação terminal conta. Importar um helper protegido e responder
    // por outro caminho não prova que a autorização participa da requisição.
    const ultimo = handler.body?.statements.at(-1);
    if (!ultimo || !ts.isReturnStatement(ultimo) || !ultimo.expression) return false;
    const chamada = ts.isAwaitExpression(ultimo.expression) ? ultimo.expression.expression : ultimo.expression;
    if (!ts.isCallExpression(chamada) || !ts.isIdentifier(chamada.expression)) return false;
    const nomeLocal = chamada.expression.text;
    for (const no of fonte.statements) {
      if (!ts.isImportDeclaration(no) || !ts.isStringLiteral(no.moduleSpecifier)
        || !no.moduleSpecifier.text.startsWith(".")) continue;
      const imports = no.importClause?.namedBindings;
      if (!imports || !ts.isNamedImports(imports)) continue;
      const importado = imports.elements.find((e) => e.name.text === nomeLocal);
      if (!importado) continue;
      const nomeExportado = importado.propertyName?.text ?? importado.name.text;
      const destino = path.posix.normalize(path.posix.join(path.posix.dirname(arquivo), `${no.moduleSpecifier.text}.ts`));
      const modulo = sintaxe(destino, ler(destino));
      const funcao = modulo.statements.find((item): item is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(item) && item.name?.text === nomeExportado
        && !!item.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
      );
      // O gate precisa estar NA FUNÇÃO chamada, não em outra exportação do módulo.
      return !!funcao?.body && temChamadaDeGate(funcao.body);
    }
    return false;
  });
}

function rotasApiV1(): string[] {
  return execFileSync("git", ["ls-files", "app/api/v1/**/route.ts"], {
    cwd: RAIZ,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function urlDaRota(arquivo: string): string {
  return (
    "/" +
    arquivo
      .replace(/^app\//, "")
      .replace(/\/route\.ts$/, "")
      // segmento dinâmico vira um literal qualquer — o PUBLIC_PATHS ancora por
      // prefixo/forma, não pelo valor do parâmetro
      .replace(/\[[^\]]+\]/g, "x")
  );
}

describe("rotas /api/v1 — gate de papel (§5.4 invariante 1)", () => {
  const rotas = rotasApiV1();

  it("a varredura enxerga o App Router de verdade", () => {
    expect(rotas.length).toBeGreaterThan(200);
  });

  it("toda rota tem gate, é pública declarada, ou está na dívida datada", () => {
    const foraDoLugar: string[] = [];
    for (const rota of rotas) {
      const temGate = temGateDePapel(rota);
      const ePublica = PUBLIC_PATHS.some((re) => re.test(urlDaRota(rota)));
      const eDivida = DIVIDA_CONHECIDA.has(rota);
      const eDaSessao = ROTAS_DA_PROPRIA_SESSAO.has(rota);
      if (!temGate && !ePublica && !eDivida && !eDaSessao) foraDoLugar.push(rota);
    }
    expect(
      foraDoLugar,
      "rota /api/v1 sem gate de papel direto/delegado, fora de PUBLIC_PATHS, do escopo da própria sessão e da dívida datada — a dívida NÃO cresce",
    ).toEqual([]);
  });

  it("a dívida só encolhe: rota que ganhou gate sai da lista", () => {
    const jaResolvidas = [...DIVIDA_CONHECIDA].filter((rota) => {
      try {
        return temGateDePapel(rota);
      } catch {
        return true; // rota sumiu do repo: sai da lista também
      }
    });
    expect(
      jaResolvidas,
      "rota da dívida já tem gate (ou não existe mais) — remova a linha da DIVIDA_CONHECIDA para a régua voltar a apertar",
    ).toEqual([]);
  });

  it("as exceções da própria sessão continuam privadas e com prova explícita", () => {
    expect([...ROTAS_DA_PROPRIA_SESSAO]).toEqual([
      "app/api/v1/auth/support/route.ts", "app/api/v1/admin/impersonate/end/route.ts",
    ]);
    for (const rota of ROTAS_DA_PROPRIA_SESSAO) {
      expect(rotas).toContain(rota);
      expect(PUBLIC_PATHS.some((re) => re.test(urlDaRota(rota)))).toBe(false);
      expect(DIVIDA_CONHECIDA.has(rota)).toBe(false);
    }
  });
});

describe("a prova de delegação rejeita as guardas desconectadas (mutantes)", () => {
  const rota = "app/api/v1/agenda/agendamentos/[id]/google/meet/deliver/route.ts";
  const helper = "app/api/v1/agenda/agendamentos/[id]/google/meet/_action.ts";

  it("reconhece as três delegações reais, inclusive o import com alias", () => {
    for (const arquivo of [rota, rota.replace("/deliver/", "/retry/"),
      "app/api/v1/agenda/agendamentos/[id]/google/retry/route.ts"]) {
      expect(temGateDePapel(arquivo), arquivo).toBe(true);
    }
  });

  it("import preservado sem chamada do handler protegido não conta", () => {
    const original = lerFonte(rota);
    const mutante = original.replace('return meetingAction(req, context, "deliver");', 'return Response.json({ ok: true });');
    expect(mutante).not.toBe(original);
    expect(temGateDePapel(rota, (arquivo) => arquivo === rota ? mutante : lerFonte(arquivo))).toBe(false);
  });

  it("gate removido do handler não é compensado por comentário nem por outra exportação", () => {
    const original = lerFonte(helper);
    const mutante = original.replace('await requireRole("agent",', 'await semGate("agent",')
      + '\n// requireRole("agent") não é uma chamada.\nexport function outra() { return requireRole("admin"); }\n';
    expect(mutante).not.toBe(original);
    expect(temGateDePapel(rota, (arquivo) => arquivo === helper ? mutante : lerFonte(arquivo))).toBe(false);
  });

  it("a comparação de papel precisa de recusa 403, não basta mencionar roleAtLeast", () => {
    const arquivo = "app/api/v1/marca/logo/route.ts";
    const original = lerFonte(arquivo);
    expect(temGateDePapel(arquivo)).toBe(true);
    const mutante = original.replaceAll('status: 403', 'status: 200');
    expect(mutante).not.toBe(original);
    expect(temGateDePapel(arquivo, () => mutante)).toBe(false);
  });
});

const authDaSessao = vi.hoisted(() => ({
  getUser: vi.fn(), getClaims: vi.fn(), support: vi.fn(), rpc: vi.fn(),
  deleteCookie: vi.fn(), setCookie: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: authDaSessao.getUser, getClaims: authDaSessao.getClaims } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ readSupportContext: authDaSessao.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: authDaSessao.rpc }) }));
vi.mock("@/lib/supabase/cookie-secure", () => ({ cookieSecure: () => true }));
vi.mock("@/lib/impersonate/cookie", () => ({ IMPERSONATE_COOKIE_NAME: "test-impersonate" }));
vi.mock("@/lib/audit", () => ({ audit: authDaSessao.audit }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: authDaSessao.deleteCookie, set: authDaSessao.setCookie }) }));

it("exceções da própria sessão não ganham outros métodos sem prova", async () => {
  expect(Object.keys(await import("@/app/api/v1/auth/support/route"))).toEqual(["GET"]);
  expect(Object.keys(await import("@/app/api/v1/admin/impersonate/end/route"))).toEqual(["POST"]);
});

describe("/auth/support informa somente a própria sessão", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sem usuário validado retorna 401 e não consulta suporte", async () => {
    authDaSessao.getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("@/app/api/v1/auth/support/route");
    const resposta = await GET();
    expect(resposta.status).toBe(401);
    expect(authDaSessao.support).not.toHaveBeenCalled();
  });

  it.each([null, { id: "sessao", access_mode: "full", status: "active", organization_id: "privado", name: "privado" }])(
    "retorna exclusivamente assinatura, sem membership de tenant",
    async (support) => {
      authDaSessao.getUser.mockResolvedValue({ data: { user: { id: "usuario" } } });
      authDaSessao.support.mockResolvedValue(support);
      const { GET } = await import("@/app/api/v1/auth/support/route");
      const resposta = await GET();
      expect(resposta.status).toBe(200);
      expect(authDaSessao.getUser).toHaveBeenCalledTimes(1);
      expect(authDaSessao.support).toHaveBeenCalledTimes(1);
      expect(await resposta.json()).toEqual({ data: { signature: support ? "sessao:full:active" : "normal" } });
    },
  );
});

describe("/admin/impersonate/end só encerra a sessão do próprio ator", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sem usuário validado retorna 401 antes de chamar service role", async () => {
    authDaSessao.getUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await import("@/app/api/v1/admin/impersonate/end/route");
    expect((await POST()).status).toBe(401);
    expect(authDaSessao.getClaims).not.toHaveBeenCalled();
    expect(authDaSessao.rpc).not.toHaveBeenCalled();
  });

  it("session_id inválido não alcança a RPC de encerramento", async () => {
    authDaSessao.getUser.mockResolvedValue({ data: { user: { id: "ator" } } });
    authDaSessao.getClaims.mockResolvedValue({ data: { claims: { session_id: "forjado" } } });
    const { POST } = await import("@/app/api/v1/admin/impersonate/end/route");
    expect((await POST()).status).toBe(401);
    expect(authDaSessao.rpc).not.toHaveBeenCalled();
  });

  it("sair usa exclusivamente ator e sessão autenticados, sem exigir privilégio vigente", async () => {
    const sessionId = "f2200000-0000-4000-8000-000000000002";
    authDaSessao.getUser.mockResolvedValue({ data: { user: { id: "ator", is_platform_admin: false } } });
    authDaSessao.getClaims.mockResolvedValue({ data: { claims: { session_id: sessionId } } });
    authDaSessao.rpc.mockResolvedValue({ data: { id: "suporte", organization_id: "org", previous_organization_id: null }, error: null });
    const { POST } = await import("@/app/api/v1/admin/impersonate/end/route");
    expect((await POST()).status).toBe(200);
    expect(authDaSessao.rpc).toHaveBeenCalledExactlyOnceWith("fn_end_support", { p_actor: "ator", p_session: sessionId });
    expect(authDaSessao.deleteCookie).toHaveBeenCalledTimes(1);
  });
});
