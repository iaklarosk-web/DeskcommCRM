/**
 * F24-T05 (Suporte KN, 25/09/2026) — leitura cruzada para o dono: a rotina de
 * aviso do Núcleo precisa listar as conversas em espera humana das CINCO
 * organizações de suporte (uma por produto). Token de API é por organização;
 * cinco tokens seriam cinco leituras e cinco segredos. Em vez disso, UMA rota
 * do cockpit — `GET /api/admin/handoffs` — com o mesmo `ADMIN_SUMMARY_TOKEN`
 * de `GET /api/admin/summary`, só leitura, todas as organizações da
 * instalação, filtrável por slug.
 *
 * Mesma disciplina do cockpit: token vazio na instalação = 503 (nunca 200 sem
 * token, G-27); token errado = 401; comparação em tempo constante.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  token: "",
  consultas: [] as { sql: string; params: unknown[] }[],
  linhas: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/env", () => ({
  env: {
    get ADMIN_SUMMARY_TOKEN() {
      return estado.token;
    },
    BILLING_GATEWAY: "mock",
    STRIPE_MODE: "test",
  },
}));
vi.mock("@/lib/api/request-id", () => ({ getRequestId: () => "req-1" }));
vi.mock("@/src/obs/log", () => ({ registrarRequisicao: () => {}, registrarRequisicaoDe: () => {} }));
vi.mock("@/src/tenant-context/db", () => ({
  getServicePool: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      estado.consultas.push({ sql, params });
      return { rows: estado.linhas };
    },
  }),
}));

import { GET } from "@/app/api/admin/handoffs/route";

function pedir(query = "", token: string | null = "segredo-do-dono"): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000/api/admin/handoffs${query}`, { headers });
}

const LINHA = {
  conversation_id: "c1",
  organization_id: "o1",
  slug: "suporte-crm-os",
  display_name: "Suporte CRM OS",
  channel: "webchat",
  saas_state: "waiting_human",
  contact_name: "Ana Lima",
  handoff_id: "h1",
  reason: "tenant_rule",
  summary: "Quer saber o preço do plano.",
  suggested_next_step: "Responder com a tabela.",
  waiting_since: new Date("2026-09-25T17:30:00.000Z"),
  last_inbound_at: new Date("2026-09-25T17:31:00.000Z"),
};

beforeEach(() => {
  estado.token = "segredo-do-dono";
  estado.consultas.length = 0;
  estado.linhas = [LINHA];
});

describe("F24-T05 — GET /api/admin/handoffs: a autoridade é o token do cockpit", () => {
  it("instalação sem token: 503, nunca 200", async () => {
    estado.token = "";
    const res = await GET(pedir());
    expect(res.status).toBe(503);
    expect(estado.consultas).toHaveLength(0);
  });

  it("token errado ou ausente: 401, sem tocar no banco", async () => {
    expect((await GET(pedir("", "outro"))).status).toBe(401);
    expect((await GET(pedir("", null))).status).toBe(401);
    expect(estado.consultas).toHaveLength(0);
  });
});

describe("F24-T05 — o que a rota devolve", () => {
  it("lista os casos em espera de todas as organizações, com o caminho do inbox e do /admin", async () => {
    const res = await GET(pedir());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.cases).toHaveLength(1);
    const caso = data.cases[0];
    expect(caso).toMatchObject({
      organization: { id: "o1", slug: "suporte-crm-os", name: "Suporte CRM OS" },
      conversation_id: "c1",
      channel: "webchat",
      state: "waiting_human",
      contact_name: "Ana Lima",
      reason: "tenant_rule",
      summary: "Quer saber o preço do plano.",
      suggested_next_step: "Responder com a tabela.",
      waiting_since: "2026-09-25T17:30:00.000Z",
      inbox_path: "/app/inbox?id=c1",
      admin_path: "/admin/inbox/c1",
    });
    expect(typeof data.generated_at).toBe("string");
    expect(data.count).toBe(1);
  });

  it("é SÓ leitura: a consulta é um select por conversas em espera ou com repasse aberto", async () => {
    await GET(pedir());
    expect(estado.consultas).toHaveLength(1);
    const sql = estado.consultas[0]!.sql.toLowerCase();
    expect(sql.trimStart().startsWith("select")).toBe(true);
    expect(sql).not.toMatch(/\b(update|insert|delete)\b/);
    expect(sql).toContain("waiting_human");
    expect(sql).toContain("claimed_at is null");
  });

  it("filtra por slug (repetido ou separado por vírgula) e limita o tamanho", async () => {
    await GET(pedir("?slug=suporte-crm-os&slug=suporte-pdv-os,suporte-oferta-os&limit=10"));
    const { params } = estado.consultas[0]!;
    expect(params[0]).toEqual(["suporte-crm-os", "suporte-pdv-os", "suporte-oferta-os"]);
    expect(params[1]).toBe(10);
  });

  it("sem filtro: slugs nulos (todas as organizações) e limite padrão", async () => {
    await GET(pedir());
    const { params } = estado.consultas[0]!;
    expect(params[0]).toBeNull();
    expect(params[1]).toBe(100);
  });

  it("slug malformado ou limite fora da faixa: 422", async () => {
    expect((await GET(pedir("?slug=Suporte%20CRM"))).status).toBe(422);
    expect((await GET(pedir("?limit=0"))).status).toBe(422);
    expect((await GET(pedir("?limit=1000"))).status).toBe(422);
    expect(estado.consultas).toHaveLength(0);
  });
});

describe("F24-T05 — o cockpit antigo continua com a mesma guarda", () => {
  it("GET /api/admin/summary: 503 sem token, 401 com token errado", async () => {
    const { GET: summaryGET } = await import("@/app/api/admin/summary/route");
    estado.token = "";
    expect((await summaryGET(new NextRequest("http://localhost:3000/api/admin/summary"))).status).toBe(503);
    estado.token = "segredo-do-dono";
    expect((await summaryGET(new NextRequest("http://localhost:3000/api/admin/summary", { headers: { authorization: "Bearer x" } }))).status).toBe(401);
  });
});
