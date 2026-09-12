/**
 * F06-T01 — logs JSON com `organization_id` e `request_id` em toda rota e
 * worker (§5.17, §7.7).
 *
 * A prova de §7.7 é `grep -rL "logger" <rotas> <workers> | wc -l = 0`. Aqui a
 * régua mede a mesma coisa com um emissor a mais: toda rota que passa por
 * `requireRole` recebe a linha do GUARDA (`src/obs/log.ts`), então "a rota
 * loga" é "a rota chama o guarda, ou emite a linha ela mesma, ou usa o
 * `logger` direto". Rota que delega a um `_handler` irmão é medida pelo
 * handler. O denominador é lido da árvore na hora (G-26).
 *
 * As três provas de §7.7 saem como números:
 *   1 request → log com organization_id 1/1 (o guarda, com sessão dublada);
 *   erro forçado → sentry_mock_captured=1 (o dublê do SDK conta a chamada);
 *   allowlist de PII → campos capturados / campos existentes (§5.17, G-14).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { CAMPOS_QUE_SAEM, capturarErro, contextoPermitido } from "@/src/obs/erros";
import { registrarJob, registrarRequisicao } from "@/src/obs/log";
import { gravarLinhaDoVerify } from "../lib/verify-metrics";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  mfaEmDivida: vi.fn(async () => false),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-pathname": "/api/v1/contacts", "x-request-method": "GET" })),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const RAIZ = process.cwd();
const ORG = "11111111-1111-4111-8111-111111111111";
const USUARIO = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

/** Marcadores que provam que a rota produz a linha `api.request`/`job.run`. */
const EMISSORES = [/\brequireRole\(/, /\brequirePlatformAdmin\(/, /\bresolveActiveOrg\(/, /\bregistrarRequisicao(De)?\(/, /\blogger\.(info|warn|error)\(/];

function arquivos(dir: string, filtro: (nome: string) => boolean, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, filtro, achados);
    else if (filtro(nome)) achados.push(caminho);
  }
  return achados;
}

/**
 * O texto da rota mais o dos módulos privados (`_handler`, `_shared`,
 * `_action`…) que ela importa por caminho relativo — é neles que as rotas
 * herdadas resolvem sessão e organização.
 */
function textoDaRota(rota: string): string {
  const proprio = readFileSync(rota, "utf8");
  const dir = path.dirname(rota);
  const privados = [...proprio.matchAll(/from\s+"((?:\.\.?\/)+_[^"]+)"/g)]
    .map((m) => path.resolve(dir, m[1]!))
    .map((base) => [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((c) => {
      try {
        return statSync(c).isFile();
      } catch {
        return false;
      }
    }))
    .filter((c): c is string => c !== undefined)
    .map((c) => readFileSync(c, "utf8"));
  return [proprio, ...privados].join("\n");
}

function linhasJson(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((chamada: unknown[]) => String(chamada[0]))
    .filter((texto: string) => texto.startsWith("{"))
    .map((texto: string) => JSON.parse(texto) as Record<string, unknown>);
}

const usuario: AuthUser = {
  id: USUARIO,
  email: "atendente@exemplo.test",
  idioma: "pt-BR",
  is_platform_admin: false,
  organizations: [{ organization_id: ORG, organization_name: "Org A", role: "admin" }],
} as unknown as AuthUser;

describe("F06-T01 — toda rota e todo worker emitem log JSON com organization_id e request_id", () => {
  let saida: ReturnType<typeof vi.spyOn>;
  let medidas: { routes: number; routes_logged: number; workers: number; workers_logged: number };

  beforeEach(() => {
    saida = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(loadAuthUser).mockResolvedValue(usuario);
    vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG, name: "Org A", role: "admin" });
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn(async () => ({ data: "admin", error: null })),
    } as never);
  });
  afterEach(() => {
    saida.mockRestore();
    vi.clearAllMocks();
  });

  it("rotas: toda app/api/**/route.ts passa por um emissor conhecido, com denominador lido da árvore", () => {
    // Arrange
    const rotas = arquivos(path.join(RAIZ, "app/api"), (nome) => nome === "route.ts");
    expect(rotas.length, "a varredura não achou rota nenhuma").toBeGreaterThan(200);

    // Act
    const semLog = rotas.filter((rota) => !EMISSORES.some((padrao) => padrao.test(textoDaRota(rota))));

    // Assert
    medidas = { ...(medidas ?? { workers: 0, workers_logged: 0 }), routes: rotas.length, routes_logged: rotas.length - semLog.length };
    expect(semLog.map((r) => path.relative(RAIZ, r)), "rotas sem emissor de log").toEqual([]);
  });

  it("workers: todo entrypoint em workers/ e todo módulo de src/jobs emite a linha ou usa o logger", () => {
    // Arrange
    // Denominador: os PROCESSOS de worker — todo arquivo de `workers/` que é
    // entrypoint (trata sinal ou `process.argv`; é o que o compose sobe) mais
    // os módulos de ciclo em `src/jobs`. Os `workers/*.handler.ts` e os módulos
    // herdados sem laço próprio são handlers chamados por dentro do
    // agent-worker, cujo logger os cobre.
    const entrypoints = arquivos(path.join(RAIZ, "workers"), (nome) => /\.ts$/.test(nome)).filter((arquivo) =>
      /process\.(argv|on\("SIG|exit\()/.test(readFileSync(arquivo, "utf8")),
    );
    const jobs = arquivos(path.join(RAIZ, "src/jobs"), (nome) => /-worker\.ts$/.test(nome));
    const todos = [...entrypoints, ...jobs];
    expect(todos.length, "entrypoints de worker").toBeGreaterThanOrEqual(4);
    const emissoresDeWorker = [/\bregistrarJob\(/, /\blogger\.(info|warn|error)\(/, /\bcreateLogger\(/, /\blog\.(info|warn|error)\(/];

    // Act
    const semLog = todos.filter((arquivo) => !emissoresDeWorker.some((padrao) => padrao.test(readFileSync(arquivo, "utf8"))));

    // Assert
    medidas = { ...(medidas ?? { routes: 0, routes_logged: 0 }), workers: todos.length, workers_logged: todos.length - semLog.length };
    expect(semLog.map((r) => path.relative(RAIZ, r)), "workers sem emissor de log").toEqual([]);
  });

  it("1 request → 1 linha JSON com organization_id e request_id (o guarda emite)", async () => {
    // Act
    const resultado = await requireRole("viewer", { requestId: REQUEST_ID, resource: "contacts" });

    // Assert
    expect(resultado.ok).toBe(true);
    const linhas = linhasJson(saida).filter((l) => l["msg"] === "api.request");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      level: "info",
      request_id: REQUEST_ID,
      organization_id: ORG,
      actor_id: USUARIO,
      outcome: "allowed",
      path: "/api/v1/contacts",
      method: "GET",
      status: 200,
    });
  });

  it("negação também loga, com o desfecho em enum e organization_id nulo só com scope", async () => {
    // Arrange
    vi.mocked(loadAuthUser).mockResolvedValue(null);

    // Act
    const resultado = await requireRole("viewer", { requestId: REQUEST_ID });

    // Assert
    expect(resultado.ok).toBe(false);
    const linhas = linhasJson(saida).filter((l) => l["msg"] === "api.request");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ request_id: REQUEST_ID, organization_id: null, outcome: "unauthenticated", scope: "unresolved", status: 401 });
    expect(() => registrarRequisicao({ request_id: REQUEST_ID, organization_id: null, outcome: "allowed" })).toThrow(/scope/);
  });

  it("worker: a linha job.run leva organization_id e o job_id como request_id", () => {
    // Act
    registrarJob({ request_id: "job-1", organization_id: ORG, job_type: "outbound_message", outcome: "ok", attempt: 1, counts: { messages_sent: 1 } });

    // Assert
    const linhas = linhasJson(saida).filter((l) => l["msg"] === "job.run");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ request_id: "job-1", organization_id: ORG, job_type: "outbound_message", outcome: "ok", counts: { messages_sent: 1 } });
  });

  it("erro forçado → sentry_mock_captured=1 e só a allowlist de PII sai (§5.17)", async () => {
    // Arrange
    const Sentry = await import("@sentry/nextjs");
    const contexto = {
      request_id: REQUEST_ID,
      organization_id: ORG,
      job_type: "outbound_message",
      error_code: "ECONNRESET",
      customer_phone: "+55 19 99999-0000",
      message_body: "texto do cliente",
      email: "cliente@exemplo.test",
    };

    // Act
    const filtrado = capturarErro(new Error("forçado"), contexto);

    // Assert
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    const extra = vi.mocked(Sentry.captureException).mock.calls[0]![1] as { extra: Record<string, unknown> };
    expect(Object.keys(extra.extra).sort()).toEqual([...CAMPOS_QUE_SAEM].sort());
    expect(filtrado).toMatchObject({ existing: 7, kept: 4 });
    expect(contextoPermitido({ organization_id: ORG, phone: "x" })).toMatchObject({ existing: 2, kept: 1 });

    gravarLinhaDoVerify(
      "logs",
      `logs: routes=${medidas.routes} routes_logged=${medidas.routes_logged} workers=${medidas.workers} workers_logged=${medidas.workers_logged} request_log_org_id=1/1 sentry_mock_captured=1 pii_fields=${filtrado.kept}/${filtrado.existing}`,
    );
  });
});
