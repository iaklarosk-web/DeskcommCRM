/**
 * F06-T02 — rate limit no webhook e no login; schema de entrada em 100% das
 * rotas (§5.14, §5.18, §7.7).
 *
 * Três provas, uma linha:
 *   `rate-limit: requests=101 status_429=K auth_requests=101 auth_blocked=B
 *    routes=R routes_with_schema=R routes_reading_input=I validated=I`
 *
 * 1. 101 requisições ao webhook SaaS do MESMO IP com teto 100 → ao menos uma
 *    429 (o adapter é dublê que recusa por credencial, então nenhuma toca o
 *    banco: a prova é do TETO, não do pipeline).
 * 2. 101 tentativas de login do mesmo IP com teto 100 → a 101ª é barrada
 *    (`authRateLimited` herdado, `AUTH_LIMITS.login`).
 * 3. Toda rota que LÊ entrada (corpo, formulário, query) a valida por schema
 *    (`zod` no arquivo ou nos módulos privados que ela importa) ou por um
 *    validador nomeado na allowlist abaixo — cada um com arquivo:linha. Rota
 *    que não lê entrada não tem o que validar e conta como coberta por vacuidade,
 *    declarada no denominador. O inventário é lido da árvore (G-26).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authRateLimited } from "@/lib/auth/rate-limit";
import { gravarLinhaDoVerify } from "../lib/verify-metrics";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));

const RAIZ = process.cwd();

/**
 * Validadores fora do arquivo da rota. Cada entrada nomeia ONDE o schema vive:
 * a régua aceita a chamada porque o alvo parseia com zod ou equivalente.
 */
const VALIDADORES_DELEGADOS: ReadonlyArray<{ chamada: RegExp; onde: string }> = [
  { chamada: /\brecebeEntrada\(/, onde: "src/channels/inbound-parse.ts (parseInbound por adapter, zod)" },
  { chamada: /\bhandleInboundWebhook\(/, onde: "lib/channels/inbound.ts:120 (lerEnvelopeZernio: contrato do fio, campos nomeados)" },
  { chamada: /\bdecodificarCsv\(|\blerPlanilhaDeLeads\(/, onde: "lib/contacts/csv.ts + lib/leads/planilha.ts (CSV com limites e colunas fechadas)" },
  { chamada: /\bverificarEstado\(|\bverifyState\(/, onde: "lib/agenda/google/estado.ts + lib/nuvemshop/state.ts (state assinado, HMAC)" },
  { chamada: /\bvalidateBearerToken\(/, onde: "lib/mcp/auth.ts (Bearer validado; corpo JSON-RPC parseado pelo transporte MCP)" },
  { chamada: /\bpatchCommercialProfile\(/, onde: "src/tenant-config/commercial-service.ts:363 (commercialPatchSchema.parse)" },
  { chamada: /\bparseSkillPackage\(/, onde: "lib/ai/skills/package.ts (manifesto do pacote por schema)" },
  { chamada: /\bvalidateOutboundMedia\(/, onde: "lib/messaging/media/upload-validation.ts (tipo e tamanho fechados)" },
  { chamada: /\bresolve\(\s*new Request/, onde: "app/api/v1/agenda/agendamentos/[id]/resolver/route.ts (zod na rota delegada)" },
];

/**
 * O que conta como LER entrada da requisição: corpo, formulário, texto cru ou
 * query string vindos de `req`/`request`. Respostas de `fetch` de saída
 * (`upstream.arrayBuffer()`, `res.json()`) não são entrada de rota.
 */
const LE_ENTRADA = [
  /\b(?:req|request)\.(?:json|formData|text|arrayBuffer)\(\)/,
  /searchParams\.(?:get|getAll|has|entries)\(/,
  /fromEntries\([^)]*searchParams/,
];
/**
 * O que conta como VALIDAR: zod no arquivo (ou nos módulos privados), ou um
 * flag de query comparado por igualdade literal (`get("x") === "1"`: qualquer
 * outro valor é falso — validação total de um booleano).
 */
const VALIDA = [/\bz\./, /\bsafeParse\(/, /\.parse\(/, /Schema\b/, /\bschema\b/];
const FLAG_LITERAL = /searchParams\.get\("[a-z_]+"\)\s*===\s*"[^"]+"/;

function arquivos(dir: string, filtro: (nome: string) => boolean, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, filtro, achados);
    else if (filtro(nome)) achados.push(caminho);
  }
  return achados;
}

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

describe("F06-T02 — rate limit e schema de entrada", () => {
  let medidas = { requests: 0, status_429: 0, auth_requests: 0, auth_blocked: 0, routes: 0, reading: 0, validated: 0 };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("webhook SaaS: 101 requisições do mesmo IP com teto 100 → status_429 ≥ 1, e nenhuma toca o banco", async () => {
    // Arrange
    const { criarHandlerDeWebhookSaas } = await import("@/app/api/v1/webhooks/saas/[provider]/route");
    const adapterMudo = {
      provider: "mock",
      isConfigured: () => false,
      verifySignature: () => false,
      resolveAccountKey: () => null,
      parseInbound: () => ({ rejected: true, reason: "unsupported_event" }),
      send: async () => {
        throw new Error("não usado");
      },
    };
    const POST = criarHandlerDeWebhookSaas({
      adapters: { mock: adapterMudo as never },
      modo: "mock",
      rateLimit: { limit: 100, windowSec: 60 },
      pool: {
        query: async () => {
          throw new Error("o teto deve barrar antes do banco");
        },
      } as never,
    });
    const contexto = { params: Promise.resolve({ provider: "mock" }) };
    const statuses: number[] = [];

    // Act
    for (let i = 0; i < 101; i += 1) {
      const req = new Request("http://localhost/api/v1/webhooks/saas/mock", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.9", "content-type": "application/json" },
        body: "{}",
      });
      const resposta = await POST(req as never, contexto);
      statuses.push(resposta.status);
    }

    // Assert
    const negadas = statuses.filter((s) => s === 429).length;
    expect(statuses).toHaveLength(101);
    expect(negadas, "nenhuma 429 em 101 requisições").toBeGreaterThanOrEqual(1);
    expect(statuses.slice(0, 100).every((s) => s === 503), "as 100 primeiras passam pelo teto e caem na credencial ausente").toBe(true);
    expect(statuses[100]).toBe(429);
    medidas = { ...medidas, requests: 101, status_429: negadas };
  });

  it("login: 101 tentativas do mesmo IP com teto 100 → a 101ª é barrada", async () => {
    // Arrange
    const limites = { ip: 100, windowSec: 300 };
    const resultados: boolean[] = [];

    // Act
    for (let i = 0; i < 101; i += 1) {
      resultados.push(await authRateLimited(`login-f06-${process.pid}`, null, limites));
    }

    // Assert
    const barradas = resultados.filter(Boolean).length;
    expect(resultados.slice(0, 100).every((b) => b === false)).toBe(true);
    expect(resultados[100]).toBe(true);
    medidas = { ...medidas, auth_requests: 101, auth_blocked: barradas };
  });

  it("schema: toda rota que lê entrada a valida; as demais são contadas como sem entrada", () => {
    // Arrange
    const rotas = arquivos(path.join(RAIZ, "app/api"), (nome) => nome === "route.ts");
    expect(rotas.length).toBeGreaterThan(200);

    // Act
    const semSchema: string[] = [];
    let lendo = 0;
    for (const rota of rotas) {
      const texto = textoDaRota(rota);
      if (!LE_ENTRADA.some((p) => p.test(texto))) continue;
      lendo += 1;
      // Rota cuja ÚNICA leitura é flag literal: validada por igualdade.
      const leituras = LE_ENTRADA.flatMap((p) => [...texto.matchAll(new RegExp(p.source, "g"))]).length;
      const flags = [...texto.matchAll(new RegExp(FLAG_LITERAL.source, "g"))].length;
      const soFlags = flags > 0 && flags === leituras;
      const valida = soFlags || VALIDA.some((p) => p.test(texto)) || VALIDADORES_DELEGADOS.some((v) => v.chamada.test(texto));
      if (!valida) semSchema.push(path.relative(RAIZ, rota));
    }

    // Assert
    medidas = { ...medidas, routes: rotas.length, reading: lendo, validated: lendo - semSchema.length };
    expect(semSchema, "rotas que leem entrada sem schema").toEqual([]);
    expect(lendo, "a varredura não achou rota que lê entrada").toBeGreaterThan(100);

    gravarLinhaDoVerify(
      "rate-limit",
      `rate-limit: requests=${medidas.requests} status_429=${medidas.status_429} auth_requests=${medidas.auth_requests} auth_blocked=${medidas.auth_blocked} routes=${medidas.routes} routes_with_schema=${medidas.routes - semSchema.length} routes_reading_input=${medidas.reading} validated=${medidas.validated}`,
    );
  });
});
