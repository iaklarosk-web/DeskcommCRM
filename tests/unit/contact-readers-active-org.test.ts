import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createClient: vi.fn(),
  nomesDosAtendentes: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/users/nome-do-atendente", () => ({
  nomesDosAtendentes: mocks.nomesDosAtendentes,
}));

import { GET as summaryGET } from "../../app/api/v1/contacts/[id]/crm-summary/route";
import { GET as timelineGET } from "../../app/api/v1/contacts/[id]/timeline/route";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const CONTACT_B = "33333333-3333-4333-8333-333333333333";
const USER = {
  id: "44444444-4444-4444-8444-444444444444",
  idioma: "pt-BR",
  organizations: [
    { organization_id: ORG_A, organization_name: "A", role: "viewer" },
    { organization_id: ORG_B, organization_name: "B", role: "viewer" },
  ],
};

type QueryCall = { method: string; args: unknown[] };
type QueryRecord = {
  table: string;
  filters: Map<string, unknown>;
  calls: QueryCall[];
};

function database(errorTable?: string) {
  const records: QueryRecord[] = [];

  function from(table: string) {
    const record: QueryRecord = { table, filters: new Map(), calls: [] };
    records.push(record);

    const query = {
      select(...args: unknown[]) {
        record.calls.push({ method: "select", args });
        return query;
      },
      eq(column: string, value: unknown) {
        record.filters.set(column, value);
        record.calls.push({ method: "eq", args: [column, value] });
        return query;
      },
      in(...args: unknown[]) {
        record.calls.push({ method: "in", args });
        return query;
      },
      is(...args: unknown[]) {
        record.calls.push({ method: "is", args });
        return query;
      },
      not(...args: unknown[]) {
        record.calls.push({ method: "not", args });
        return query;
      },
      order(...args: unknown[]) {
        record.calls.push({ method: "order", args });
        return query;
      },
      limit(...args: unknown[]) {
        record.calls.push({ method: "limit", args });
        return query;
      },
      or(...args: unknown[]) {
        record.calls.push({ method: "or", args });
        return query;
      },
      maybeSingle() {
        return Promise.resolve(result(true));
      },
      then(
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(result(false)).then(resolve, reject);
      },
    };

    function result(single: boolean) {
      if (table === errorTable) {
        return { data: null, error: { message: "falha deliberada do reader" } };
      }
      if (table === "contacts" && single) {
        const belongsToActiveOrg =
          record.filters.get("id") === CONTACT_B &&
          record.filters.get("organization_id") === ORG_B;
        return {
          data: belongsToActiveOrg ? { id: CONTACT_B } : null,
          error: null,
        };
      }
      return { data: [], error: null };
    }

    return query;
  }

  return { client: { from }, records };
}

let activeOrg = ORG_A;

beforeEach(() => {
  vi.resetAllMocks();
  activeOrg = ORG_A;
  mocks.requireRole.mockImplementation(async () => ({
    ok: true,
    user: USER,
    org: {
      orgId: activeOrg,
      name: activeOrg === ORG_A ? "A" : "B",
      role: "viewer",
    },
  }));
  mocks.nomesDosAtendentes.mockResolvedValue(new Map());
});

const readers = [
  {
    name: "timeline",
    get: timelineGET,
    url: (suffix = "") =>
      `http://local/api/v1/contacts/${CONTACT_B}/timeline${suffix}`,
    resource: "crm_lead_activities",
    tables: ["contacts", "crm_leads", "crm_lead_activities"],
  },
  {
    name: "crm-summary",
    get: summaryGET,
    url: () => `http://local/api/v1/contacts/${CONTACT_B}/crm-summary`,
    resource: "contacts",
    tables: ["contacts", "crm_leads", "crm_lead_activities"],
  },
] as const;

describe("readers do contato usam somente a organização ativa", () => {
  it("mantém o denominador restrito às duas rotas corrigidas", () => {
    expect(readers.map(({ name }) => name)).toEqual([
      "timeline",
      "crm-summary",
    ]);
  });

  for (const reader of readers) {
    it(`${reader.name}: membro de A/B recebe 404 para contato B com A ativa e 200 após ativar B`, async () => {
      let db = database();
      mocks.createClient.mockResolvedValue(db.client);
      const hidden = await reader.get(new NextRequest(reader.url()), {
        params: Promise.resolve({ id: CONTACT_B }),
      });
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toMatchObject({
        error: { code: "not_found" },
      });
      expect(mocks.requireRole).toHaveBeenCalledWith(
        "viewer",
        expect.objectContaining({ resource: reader.resource }),
      );
      const contactInA = db.records.find(({ table }) => table === "contacts");
      expect(contactInA?.filters.get("organization_id")).toBe(ORG_A);
      expect(db.records).toHaveLength(1);

      activeOrg = ORG_B;
      db = database();
      mocks.createClient.mockResolvedValue(db.client);
      const visible = await reader.get(new NextRequest(reader.url()), {
        params: Promise.resolve({ id: CONTACT_B }),
      });
      expect(visible.status).toBe(200);
      const body = await visible.json();
      expect(body.error).toBeUndefined();

      for (const table of reader.tables) {
        const queries = db.records.filter((record) => record.table === table);
        expect(
          queries.length,
          `${reader.name} precisa consultar ${table}`,
        ).toBeGreaterThan(0);
        for (const query of queries) {
          expect(
            query.filters.get("organization_id"),
            `${reader.name}:${table}`,
          ).toBe(ORG_B);
        }
      }
    });

    it(`${reader.name}: erro de leitura não vira resposta 200 vazia`, async () => {
      activeOrg = ORG_B;
      const db = database("crm_leads");
      mocks.createClient.mockResolvedValue(db.client);
      const response = await reader.get(new NextRequest(reader.url()), {
        params: Promise.resolve({ id: CONTACT_B }),
      });
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        error: {
          code: "internal_error",
          message: "falha deliberada do reader",
        },
      });
      expect(body.data).toBeUndefined();
    });

    it(`${reader.name}: rejeita id inválido após o gate e antes de consultar`, async () => {
      const db = database();
      mocks.createClient.mockResolvedValue(db.client);
      const response = await reader.get(new NextRequest(reader.url()), {
        params: Promise.resolve({ id: "nao-e-uuid" }),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: { code: "validation_failed" },
      });
      expect(mocks.requireRole).toHaveBeenCalledWith(
        "viewer",
        expect.objectContaining({ resource: reader.resource }),
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(db.records).toHaveLength(0);
    });
  }

  it("timeline preserva filtros, cursor opaco e janela limit + 1", async () => {
    activeOrg = ORG_B;
    const db = database();
    mocks.createClient.mockResolvedValue(db.client);
    const cursor = Buffer.from(
      JSON.stringify({
        performed_at: "2026-09-09T12:00:00.000Z",
        id: CONTACT_B,
      }),
    ).toString("base64url");
    const response = await timelineGET(
      new NextRequest(
        `http://local/api/v1/contacts/${CONTACT_B}/timeline?limit=2&type=order_created&type=message_inbound&cursor=${cursor}`,
      ),
      { params: Promise.resolve({ id: CONTACT_B }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [],
      meta: { cursor: null, has_more: false },
    });
    const activity = db.records.find(
      ({ table }) => table === "crm_lead_activities",
    );
    expect(activity?.calls).toEqual(
      expect.arrayContaining([
        { method: "limit", args: [3] },
        { method: "in", args: ["type", ["order_created", "message_inbound"]] },
        {
          method: "or",
          args: [
            `performed_at.lt.2026-09-09T12:00:00.000Z,and(performed_at.eq.2026-09-09T12:00:00.000Z,id.lt.${CONTACT_B})`,
          ],
        },
      ]),
    );
  });

  it("timeline preserva a rejeição de cursor inválido", async () => {
    const db = database();
    mocks.createClient.mockResolvedValue(db.client);
    const response = await timelineGET(
      new NextRequest(
        `http://local/api/v1/contacts/${CONTACT_B}/timeline?cursor=invalido`,
      ),
      { params: Promise.resolve({ id: CONTACT_B }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_cursor" },
    });
    expect(db.records).toHaveLength(0);
  });
});
