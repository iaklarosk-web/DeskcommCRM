import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDailyOrderReport } from "@/src/crm/orders/daily";
import type { TenantCtx } from "@/src/tenant-context";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(rawPort)}/postgres`,
  max: 4,
});

const ORG_A = "f02d1000-0000-4000-8000-000000000001";
const ORG_B = "f02d1000-0000-4000-8000-000000000002";
const VIEWER_A = "f02d1000-1000-4000-8000-000000000001";
const VIEWER_B = "f02d1000-1000-4000-8000-000000000002";
const PLATFORM = "f02d1000-1000-4000-8000-000000000003";
const AUTH_SESSION = "f02d1000-2000-4000-8000-000000000001";
const SUPPORT_SESSION = "f02d1000-3000-4000-8000-000000000001";
const CONTACT_A = "f02d1000-4000-4000-8000-000000000001";
const CONTACT_B = "f02d1000-4000-4000-8000-000000000002";
const PRODUCT_A = "f02d1000-5000-4000-8000-000000000001";
const PRODUCT_B = "f02d1000-5000-4000-8000-000000000002";
const HIGH = "f02d1000-6000-4000-8000-000000000001";
const EDGE_LOCAL_9 = "f02d1000-6000-4000-8000-000000000002";
const LOCAL_10 = "f02d1000-6000-4000-8000-000000000003";
const DRAFT = "f02d1000-6000-4000-8000-000000000004";
const CANCELLED = "f02d1000-6000-4000-8000-000000000005";
const PENDING = "f02d1000-6000-4000-8000-000000000006";
const KG = "f02d1000-6000-4000-8000-000000000007";
const USD = "f02d1000-6000-4000-8000-000000000008";
const UNLINKED = "f02d1000-6000-4000-8000-000000000009";
const ORDER_B = "f02d1000-6000-4000-8000-00000000000b";

const context = (organization_id: string, user_id: string): TenantCtx => ({
  organization_id,
  user_id,
  role: "viewer",
  source: "session",
});

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users(id,email) values
       ($1,'daily-viewer-a@test.invalid'),($2,'daily-viewer-b@test.invalid'),
       ($3,'daily-platform@test.invalid')`,
      [VIEWER_A, VIEWER_B, PLATFORM],
    );
    await client.query(
      `insert into public.organizations(id,slug,display_name,legal_name,timezone) values
       ($1,'daily-report-a','Daily A','Daily A Ltda','America/Sao_Paulo'),
       ($2,'daily-report-b','Daily B','Daily B Ltda','America/Manaus')`,
      [ORG_A, ORG_B],
    );
    await client.query(
      `insert into public.user_organizations
       (organization_id,user_id,role,accepted_at) values
       ($1,$2,'viewer',now()),($3,$4,'viewer',now())`,
      [ORG_A, VIEWER_A, ORG_B, VIEWER_B],
    );
    await client.query(
      `insert into public.contacts(id,organization_id,display_name) values
       ($1,$2,'Contato diário A'),($3,$4,'Contato secreto B')`,
      [CONTACT_A, ORG_A, CONTACT_B, ORG_B],
    );
    await client.query(
      `insert into public.catalog_products
       (id,organization_id,codigo,nome,preco_cents,sale_unit) values
       ($1,$2,'DAILY-A','Produto diário',100,'un'),
       ($3,$4,'DAILY-B','Produto secreto B',999,'un')`,
      [PRODUCT_A, ORG_A, PRODUCT_B, ORG_B],
    );
    await client.query(
      `insert into public.platform_admins(user_id,granted_by,reason)
       values($1,$1,'F02 daily integration')`,
      [PLATFORM],
    );
    await client.query(`insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')`, [
      AUTH_SESSION,
      PLATFORM,
    ]);
    await client.query(
      `insert into public.platform_support_sessions
       (id,organization_id,actor_user_id,auth_session_id,access_mode,expires_at)
       values($1,$2,$3,$4,'support_readonly',now()+interval '30 minutes')`,
      [SUPPORT_SESSION, ORG_A, PLATFORM, AUTH_SESSION],
    );
    await client.query(
      `insert into public.crm_orders
       (id,organization_id,contact_id,source,delivery_date,status,revision,currency,total_cents,
        created_by_actor_type,created_by_actor_id,confirmed_at,confirmed_by_actor_type,created_at)
       values
       ($1,$11,$12,'ui','2026-09-10','confirmed',2,'BRL',50100,'user',$13,now(),'user','2026-09-10 12:00:00+00'),
       ($2,$11,$12,'ui','2026-09-10','confirmed',2,'BRL',100,'user',$13,now(),'user','2026-09-10 02:30:00+00'),
       ($3,$11,$12,'ui','2026-09-10','delivered',3,'BRL',100,'user',$13,now(),'user','2026-09-10 03:30:00+00'),
       ($4,$11,$12,'ui','2026-09-10','draft',1,null,null,'user',$13,null,null,'2026-09-10 12:10:00+00'),
       ($5,$11,$12,'ui','2026-09-10','cancelled',2,null,null,'user',$13,null,null,'2026-09-10 12:20:00+00'),
       ($6,$11,$12,'ui','2026-09-10','confirmed',2,null,null,'user',$13,now(),'user','2026-09-10 12:30:00+00'),
       ($7,$11,$12,'ui','2026-09-10','confirmed',2,'BRL',200,'user',$13,now(),'user','2026-09-10 12:40:00+00'),
       ($8,$11,$12,'ui','2026-09-10','confirmed',2,'USD',100,'user',$13,now(),'user','2026-09-10 12:50:00+00'),
       ($9,$11,$12,'ui','2026-09-10','in_production',3,'BRL',100,'user',$13,now(),'user','2026-09-10 13:00:00+00'),
       ($10,$14,$15,'ui','2026-09-10','confirmed',2,'BRL',999,'user',$16,now(),'user','2026-09-10 12:00:00+00')`,
      [
        HIGH,
        EDGE_LOCAL_9,
        LOCAL_10,
        DRAFT,
        CANCELLED,
        PENDING,
        KG,
        USD,
        UNLINKED,
        ORDER_B,
        ORG_A,
        CONTACT_A,
        VIEWER_A,
        ORG_B,
        CONTACT_B,
        VIEWER_B,
      ],
    );
    await client.query(
      `insert into public.crm_order_items
       (id,organization_id,order_id,position,requested_text,product_id,product_name_snapshot,
        sale_unit_snapshot,quantity,unit_price_cents,currency_snapshot,line_total_cents)
       select ('f02d2000-0000-4000-8000-'||lpad(gs::text,12,'0'))::uuid,
         $1,$2,gs,'Uma unidade',$3,'Produto diário','un',1.000,100,'BRL',100
       from generate_series(1,501) gs`,
      [ORG_A, HIGH, PRODUCT_A],
    );
    await client.query(
      `insert into public.crm_order_items
       (id,organization_id,order_id,position,requested_text,product_id,product_name_snapshot,
        sale_unit_snapshot,quantity,unit_price_cents,currency_snapshot,line_total_cents) values
       ('f02d3000-0000-4000-8000-000000000001',$1,$2,1,'Uma unidade',$3,'Produto diário','un',1,100,'BRL',100),
       ('f02d3000-0000-4000-8000-000000000002',$1,$4,1,'Uma unidade',$3,'Produto diário','un',1,100,'BRL',100),
       ('f02d3000-0000-4000-8000-000000000003',$1,$5,1,'Um quilo',$3,'Produto diário','kg',1,200,'BRL',200),
       ('f02d3000-0000-4000-8000-000000000004',$1,$6,1,'Uma unidade',$3,'Produto diário','un',1,100,'USD',100),
       ('f02d3000-0000-4000-8000-000000000005',$1,$7,1,'Serviço avulso',null,null,'un',1,100,'BRL',100),
       ('f02d3000-0000-4000-8000-000000000006',$8,$9,1,'Item B',$10,'Produto secreto B','un',1,999,'BRL',999)`,
      [ORG_A, EDGE_LOCAL_9, PRODUCT_A, LOCAL_10, KG, USD, UNLINKED, ORG_B, ORDER_B, PRODUCT_B],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  try {
    await pool.query("delete from public.platform_support_sessions where id=$1", [SUPPORT_SESSION]);
    await pool.query("delete from auth.sessions where id=$1", [AUTH_SESSION]);
    await pool.query("delete from public.platform_admins where user_id=$1", [PLATFORM]);
    await pool.query("delete from public.organizations where id in($1,$2)", [ORG_A, ORG_B]);
    await pool.query("delete from auth.users where id in($1,$2,$3)", [
      VIEWER_A,
      VIEWER_B,
      PLATFORM,
    ]);
  } finally {
    await pool.end();
  }
});

describe("relatório diário real", () => {
  it("não trunca 501 itens, separa grupos/status/moedas e não carrega tenant B", async () => {
    const report = await getDailyOrderReport(
      context(ORG_A, VIEWER_A),
      {},
      { date: "2026-09-10", basis: "delivery_date" },
      { pool },
    );
    expect(report.orders.find((order) => order.order_id === HIGH)?.items).toHaveLength(501);
    expect(report.criteria.organization).toEqual({ id: ORG_A, name: "Daily A" });
    expect(report.denominators).toEqual({
      matching_orders: 9,
      eligible_orders: 7,
      included_orders: 6,
      pending_orders: 1,
      excluded_status_orders: { draft: 1, cancelled: 1 },
      included_items: 506,
      groups: 4,
    });
    expect(report.currency_totals).toEqual([
      { currency: "BRL", total_cents: "50600" },
      { currency: "USD", total_cents: "100" },
    ]);
    expect(JSON.stringify(report)).not.toContain("secreto B");
    expect(report.orders.find((order) => order.order_id === PENDING)).toMatchObject({
      included_in_totals: false,
    });
  });

  it("created_at usa o dia civil no timezone IANA e delivery_date é literal", async () => {
    const localNine = await getDailyOrderReport(
      context(ORG_A, VIEWER_A),
      {},
      { date: "2026-09-09", basis: "created_at" },
      { pool },
    );
    expect(localNine.criteria.timezone).toBe("America/Sao_Paulo");
    expect(localNine.orders.map((order) => order.order_id)).toEqual([EDGE_LOCAL_9]);

    const localTen = await getDailyOrderReport(
      context(ORG_A, VIEWER_A),
      {},
      { date: "2026-09-10", basis: "created_at" },
      { pool },
    );
    expect(localTen.orders.some((order) => order.order_id === EDGE_LOCAL_9)).toBe(false);
    expect(localTen.orders.some((order) => order.order_id === LOCAL_10)).toBe(true);
  });

  it("nega ID de outra organização e platform admin direto; suporte lê só acompanhado", async () => {
    await expect(
      getDailyOrderReport(
        context(ORG_B, VIEWER_A),
        {},
        { date: "2026-09-10", basis: "delivery_date" },
        { pool },
      ),
    ).rejects.toMatchObject({ code: "forbidden_tenant" });
    await expect(
      getDailyOrderReport(
        context(ORG_A, PLATFORM),
        {},
        { date: "2026-09-10", basis: "delivery_date" },
        { pool },
      ),
    ).rejects.toMatchObject({ code: "forbidden_tenant" });

    const supported = await getDailyOrderReport(
      context(ORG_A, PLATFORM),
      { support_session_id: SUPPORT_SESSION },
      { date: "2026-09-10", basis: "delivery_date" },
      { pool },
    );
    expect(supported.denominators.matching_orders).toBe(9);
    expect(JSON.stringify(supported)).not.toContain("secreto B");

    const ownB = await getDailyOrderReport(
      context(ORG_B, VIEWER_B),
      {},
      { date: "2026-09-10", basis: "delivery_date" },
      { pool },
    );
    expect(ownB.criteria.organization).toEqual({ id: ORG_B, name: "Daily B" });
    expect(ownB.orders.map((order) => order.order_id)).toEqual([ORDER_B]);
  });
});
