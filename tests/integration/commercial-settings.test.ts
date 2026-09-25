import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TenantCtx } from "@/src/tenant-context";

import {
  CommercialSettingsError,
  getCommercialProfile,
  patchCommercialProfile,
} from "../../src/tenant-config/commercial-service";

const portRaw = process.env.TEST_DB_PORT;
if (!portRaw) throw new Error("TEST_DB_PORT obrigatória para integração T08");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(portRaw)}/postgres`,
  max: 4,
});

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260909214233_9010_perfil_comercial_canonico.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const ORG_A = "f0281000-0000-4000-8000-00000000000a";
const ORG_B = "f0281000-0000-4000-8000-00000000000b";
const MANAGER_A = "f0281000-1000-4000-8000-00000000000a";
const VIEWER_A = "f0281000-1000-4000-8000-00000000000b";
const AGENT_A = "f0281000-1000-4000-8000-00000000000c";
const MANAGER_B = "f0281000-1000-4000-8000-00000000000d";
const PLATFORM = "f0281000-1000-4000-8000-00000000000e";
const ADMIN_A = "f0281000-1000-4000-8000-00000000000f";
const AUTH_SESSION = "f0281000-2000-4000-8000-000000000001";
const SUPPORT_SESSION = "f0281000-3000-4000-8000-000000000001";
const CONTACT_A = "f0281000-4000-4000-8000-000000000001";
const ORDER_A = "f0281000-5000-4000-8000-000000000001";
const ITEM_A = "f0281000-6000-4000-8000-000000000001";

const ctx = (organization_id: string, user_id: string): TenantCtx => ({
  organization_id,
  user_id,
  source: "session",
});
const managerA = ctx(ORG_A, MANAGER_A);

async function setAlias(key: string, value: unknown): Promise<void> {
  await pool.query(
    `insert into public.tenant_settings
       (organization_id,key,value,schema_version,source,updated_by)
     values($1,$2,$3::jsonb,1,'tenant_admin',$4)
     on conflict(organization_id,key) do update set
       value=excluded.value,source=excluded.source,updated_by=excluded.updated_by,
       updated_at=now()`,
    [ORG_A, key, JSON.stringify(value), MANAGER_A],
  );
}

async function snapshotA(): Promise<{
  phone: unknown;
}> {
  const result = await pool.query<{ phone: unknown }>(
    `select value phone from tenant_settings
       where organization_id=$1 and key='business.phone'`,
    [ORG_A],
  );
  return result.rows[0]!;
}

async function orderSnapshot(): Promise<unknown> {
  const result = await pool.query<{ snapshot: unknown }>(
    `select jsonb_build_object(
       'order',to_jsonb(o),
       'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.position,i.id)
          from crm_order_items i where i.organization_id=o.organization_id
            and i.order_id=o.id),'[]'::jsonb)) snapshot
     from crm_orders o where o.organization_id=$1 and o.id=$2`,
    [ORG_A, ORDER_A],
  );
  return result.rows[0]?.snapshot;
}

beforeAll(async () => {
  for (const [id, email] of [
    [MANAGER_A, "manager-a@f02-t08.test"],
    [VIEWER_A, "viewer-a@f02-t08.test"],
    [AGENT_A, "agent-a@f02-t08.test"],
    [MANAGER_B, "manager-b@f02-t08.test"],
    [PLATFORM, "platform@f02-t08.test"],
    [ADMIN_A, "admin-a@f02-t08.test"],
  ]) {
    await pool.query(
      "insert into auth.users(id,email) values($1,$2) on conflict(id) do nothing",
      [id, email],
    );
  }
  await pool.query(
    `insert into organizations
       (id,slug,display_name,legal_name,timezone,currency,status,settings)
     values
       ($1,'f02-t08-a','Comercial A','Comercial A Ltda','America/Sao_Paulo','BRL','active',
        '{"branding":{"app_name":"Marca A","accent_hex":"#112233"}}'),
       ($2,'f02-t08-b','Comercial B','Comercial B Ltda','America/Manaus','BRL','active',
        '{"branding":{"app_name":"Marca B","accent_hex":"#445566"}}')
     on conflict(id) do nothing`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `insert into user_organizations(user_id,organization_id,role,accepted_at)
     values($1,$5,'manager',now()),($2,$5,'viewer',now()),
           ($3,$5,'agent',now()),($4,$6,'manager',now()),($7,$5,'admin',now())
     on conflict(user_id,organization_id) do update set
       role=excluded.role,accepted_at=excluded.accepted_at,revoked_at=null`,
    [MANAGER_A, VIEWER_A, AGENT_A, MANAGER_B, ORG_A, ORG_B, ADMIN_A],
  );
  await pool.query(
    `insert into platform_admins(user_id,granted_by,reason)
     values($1,$1,'T08 integration') on conflict(user_id) do update set revoked_at=null`,
    [PLATFORM],
  );
  await pool.query(
    `insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')
     on conflict(id) do nothing`,
    [AUTH_SESSION, PLATFORM],
  );
  await pool.query(
    `insert into platform_support_sessions
       (id,organization_id,actor_user_id,auth_session_id,access_mode,expires_at)
     values($1,$2,$3,$4,'full',now()+interval '30 minutes')
     on conflict(id) do update set access_mode='full',expires_at=excluded.expires_at,
       ended_at=null`,
    [SUPPORT_SESSION, ORG_A, PLATFORM, AUTH_SESSION],
  );
  await pool.query(
    `insert into contacts(id,organization_id,display_name)
     values($1,$2,'Cliente fictício T08') on conflict(id) do nothing`,
    [CONTACT_A, ORG_A],
  );
  await pool.query(
    `insert into crm_orders
       (id,organization_id,contact_id,source,status,revision,currency,total_cents,
        created_by_actor_type,created_by_actor_id,confirmed_at,
        confirmed_by_actor_type,confirmed_by_actor_id)
     values($1,$2,$3,'ui','confirmed',2,'BRL',2500,'user',$4,now(),'user',$4)
     on conflict(id) do nothing`,
    [ORDER_A, ORG_A, CONTACT_A, MANAGER_A],
  );
  await pool.query(
    `insert into crm_order_items
       (id,organization_id,order_id,position,requested_text,product_name_snapshot,
        sale_unit_snapshot,quantity,unit_price_cents,currency_snapshot,line_total_cents)
     values($1,$2,$3,1,'2 unidades','Produto snapshot','un',2,1250,'BRL',2500)
     on conflict(id) do nothing`,
    [ITEM_A, ORG_A, ORDER_A],
  );

  // Upgrade: uma linha legada existe antes de 9010 e precisa sobreviver até
  // o editor canônico correspondente ser salvo.
  await setAlias("branding.name", "Marca antiga A");
  await pool.query(MIGRATION);
  await pool.query(MIGRATION);
});

beforeEach(async () => {
  await pool.query(
    `delete from private.tenant_setting_alias_archive
       where organization_id=any($1::uuid[])`,
    [[ORG_A, ORG_B]],
  );
  await pool.query(
    `delete from tenant_settings where organization_id=any($1::uuid[])
       and (key like 'business.%' or key like 'branding.%')`,
    [[ORG_A, ORG_B]],
  );
  await pool.query(
    `update organizations set status='active',timezone='America/Sao_Paulo',
       settings='{"branding":{"app_name":"Marca A","accent_hex":"#112233"}}'::jsonb
       where id=$1`,
    [ORG_A],
  );
  await pool.query(
    `update organizations set status='active',timezone='America/Manaus',
       settings='{"branding":{"app_name":"Marca B","accent_hex":"#445566"}}'::jsonb
       where id=$1`,
    [ORG_B],
  );
  await pool.query(
    "update platform_admins set revoked_at=null where user_id=$1",
    [PLATFORM],
  );
  await pool.query(
    `update platform_support_sessions set access_mode='full',ended_at=null,
       expires_at=now()+interval '30 minutes' where id=$1`,
    [SUPPORT_SESSION],
  );
  await setAlias("branding.name", "Marca antiga A");
  await setAlias("branding.primary_color", "#ff0000");
  await setAlias("branding.logo_url", "https://legacy.invalid/logo.png");
  await setAlias("business.timezone", "America/Recife");
  await pool.query(
    `insert into tenant_settings
       (organization_id,key,value,schema_version,source,updated_by)
     values($1,'business.phone','"  +55 11 3000-0000  "',1,'seed',$2),
           ($1,'business.delivery_days','[5,1]',1,'seed',$2),
           ($4,'business.phone','"B secreto"',1,'seed',$3)
     on conflict(organization_id,key) do update set value=excluded.value,
       source=excluded.source,updated_by=excluded.updated_by,updated_at=now()`,
    [ORG_A, MANAGER_A, MANAGER_B, ORG_B],
  );
});

afterAll(async () => pool.end());

describe("perfil comercial e aliases canônicos", () => {
  it("reaplica 9010 preservando aliases e lê valores estritos sem tenant B", async () => {
    const profile = await getCommercialProfile(managerA, {}, { pool });
    expect(profile.settings["business.phone"]).toMatchObject({
      present: true,
      value: "+55 11 3000-0000",
      source: "seed",
    });
    expect(profile.settings["business.delivery_days"].value).toEqual([1, 5]);
    expect(profile.organization.legacy_timezone).toMatchObject({
      status: "conflicts",
      value: "America/Recife",
    });
    expect(profile.branding.legacy_name).toMatchObject({
      status: "conflicts",
      value: "Marca antiga A",
    });
    expect(JSON.stringify(profile)).not.toContain("B secreto");
  });

  it("viewer lê; agent/viewer não escrevem; manager A não atravessa tenant B", async () => {
    await expect(
      getCommercialProfile(ctx(ORG_A, VIEWER_A), {}, { pool }),
    ).resolves.toMatchObject({ capabilities: { can_write_commercial: false } });

    for (const denied of [
      ctx(ORG_A, VIEWER_A),
      ctx(ORG_A, AGENT_A),
      ctx(ORG_B, MANAGER_A),
    ]) {
      await expect(
        patchCommercialProfile(
          denied,
          {},
          { settings: { "business.phone": "não gravar" } },
          { pool },
        ),
      ).rejects.toBeInstanceOf(CommercialSettingsError);
    }
    expect(await snapshotA()).toEqual({ phone: "  +55 11 3000-0000  " });
  });

  it("manager grava somente dirty fields e auditoria sem valores no mesmo commit", async () => {
    const orderBefore = await orderSnapshot();
    const result = await patchCommercialProfile(
      managerA,
      {},
      { settings: { "business.phone": "  novo telefone  " } },
      { pool, requestId: "t08-manager" },
    );
    expect(result.settings["business.phone"]).toMatchObject({
      present: true,
      value: "novo telefone",
      source: "tenant_admin",
    });
    expect(result.settings["business.delivery_days"].value).toEqual([1, 5]);
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      `select metadata from api_audit_log where organization_id=$1
        and request_id='t08-manager'`,
      [ORG_A],
    );
    expect(audit.rows).toEqual([
      {
        metadata: {
          fields_changed: ["business.phone"],
          source: "commercial_settings",
        },
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("novo telefone");
    expect(await orderSnapshot()).toEqual(orderBefore);
  });

  it("suporte exige plataforma ativa: full grava, readonly e revogado negam", async () => {
    const platformCtx = ctx(ORG_A, PLATFORM);
    const access = { support_session_id: SUPPORT_SESSION };
    await expect(
      getCommercialProfile(platformCtx, {}, { pool }),
    ).rejects.toMatchObject({ code: "forbidden_tenant" });
    await expect(
      patchCommercialProfile(
        platformCtx,
        access,
        { settings: { "business.address": "Endereço acompanhado" } },
        { pool },
      ),
    ).resolves.toMatchObject({ capabilities: { can_write_commercial: true } });

    await pool.query(
      "update platform_support_sessions set access_mode='support_readonly' where id=$1",
      [SUPPORT_SESSION],
    );
    await expect(
      getCommercialProfile(platformCtx, access, { pool }),
    ).resolves.toMatchObject({ capabilities: { can_write_commercial: false } });
    await expect(
      patchCommercialProfile(
        platformCtx,
        access,
        { settings: { "business.address": "recusar" } },
        { pool },
      ),
    ).rejects.toMatchObject({ code: "forbidden_role" });

    await pool.query(
      "update platform_admins set revoked_at=now() where user_id=$1",
      [PLATFORM],
    );
    await expect(
      getCommercialProfile(platformCtx, access, { pool }),
    ).rejects.toMatchObject({ code: "forbidden_tenant" });
  });

  it("falha na auditoria reverte a escrita comercial inteira", async () => {
    await pool.query(`
      create or replace function public.f02_t08_fail_commercial_audit()
      returns trigger language plpgsql as $$begin
        if new.metadata->>'source'='commercial_settings' then
          raise exception 'f02_t08_audit_fault';
        end if;
        return new;
      end$$;
      create trigger f02_t08_fail_commercial_audit before insert on api_audit_log
      for each row execute function public.f02_t08_fail_commercial_audit();
    `);
    try {
      await expect(
        patchCommercialProfile(
          managerA,
          {},
          { settings: { "business.phone": "deve reverter" } },
          { pool, requestId: "t08-fault" },
        ),
      ).rejects.toThrow("f02_t08_audit_fault");
      expect(await snapshotA()).toEqual({ phone: "  +55 11 3000-0000  " });
      const audit = await pool.query(
        "select 1 from api_audit_log where request_id='t08-fault'",
      );
      expect(audit.rowCount).toBe(0);
    } finally {
      await pool.query(`
        drop trigger if exists f02_t08_fail_commercial_audit on api_audit_log;
        drop function if exists public.f02_t08_fail_commercial_audit();
      `);
    }
  });

  it("os editores canônicos arquivam os quatro aliases uma vez e expõem só diagnóstico", async () => {
    const logoPath = `${ORG_A}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
    const profileInput = {
      display_name: "Comercial A",
      legal_name: "Comercial A Ltda",
      cnpj: null,
      timezone: "America/Manaus",
      locale: "pt-BR",
      currency: "BRL",
      media_retention_days: 365,
      dpo_email: null,
      privacy_policy_url: null,
      lost_reasons_extra: [],
    };
    // O guard anterior da action não substitui a autorização da RPC no banco.
    for (const condition of ["unaccepted", "inactive"] as const) {
      try {
        if (condition === "unaccepted") {
          await pool.query("update user_organizations set accepted_at=null where organization_id=$1 and user_id=$2", [ORG_A, ADMIN_A]);
        } else {
          await pool.query("update organizations set status='suspended' where id=$1", [ORG_A]);
        }
        await expect(pool.query("select fn_update_organization_profile($1,$2,$3::jsonb)", [ORG_A, ADMIN_A, JSON.stringify(profileInput)])).rejects.toMatchObject({ code: "42501" });
        expect((await pool.query("select timezone from organizations where id=$1", [ORG_A])).rows[0]?.timezone).toBe("America/Sao_Paulo");
        expect((await pool.query("select count(*)::int n from private.tenant_setting_alias_archive where organization_id=$1", [ORG_A])).rows[0]?.n).toBe(0);
        expect((await pool.query("select value from tenant_settings where organization_id=$1 and key='business.timezone'", [ORG_A])).rows[0]?.value).toBe("America/Recife");
      } finally {
        await pool.query("update user_organizations set accepted_at=now() where organization_id=$1 and user_id=$2", [ORG_A, ADMIN_A]);
        await pool.query("update organizations set status='active' where id=$1", [ORG_A]);
      }
    }
    await pool.query(
      `select fn_definir_marca_da_organizacao($1,$2,
        '{"app_name":"Marca nova A","accent_hex":"#abcdef"}'::jsonb)`,
      [ORG_A, ADMIN_A],
    );
    await pool.query(`select fn_definir_logo_da_organizacao($1,$2,$3)`, [
      ORG_A,
      ADMIN_A,
      logoPath,
    ]);
    await pool.query(`select fn_update_organization_profile($1,$2,$3::jsonb)`, [
      ORG_A,
      ADMIN_A,
      JSON.stringify(profileInput),
    ]);
    await pool.query(
      `select fn_definir_marca_da_organizacao($1,$2,
        '{"app_name":"Marca nova A","accent_hex":"#abcdef"}'::jsonb)`,
      [ORG_A, ADMIN_A],
    );
    await pool.query(`select fn_definir_logo_da_organizacao($1,$2,$3)`, [
      ORG_A,
      ADMIN_A,
      logoPath,
    ]);
    await pool.query(`select fn_update_organization_profile($1,$2,$3::jsonb)`, [
      ORG_A,
      ADMIN_A,
      JSON.stringify(profileInput),
    ]);
    const archive = await pool.query<{ count: number; keys: string[] }>(
      `select count(*)::int count,array_agg(alias_key order by alias_key) keys
         from private.tenant_setting_alias_archive where organization_id=$1`,
      [ORG_A],
    );
    expect(archive.rows[0]).toEqual({
      count: 4,
      keys: [
        "branding.logo_url",
        "branding.name",
        "branding.primary_color",
        "business.timezone",
      ],
    });
    const profile = await getCommercialProfile(managerA, {}, { pool });
    expect(profile.branding).toMatchObject({
      app_name: "Marca nova A",
      accent_hex: "#abcdef",
      logo_path: logoPath,
      legacy_name: {
        status: "superseded",
        destination: "organizations.settings.branding.app_name",
      },
      legacy_primary_color: {
        status: "superseded",
        destination: "organizations.settings.branding.accent_hex",
      },
    });
    expect(profile.organization).toMatchObject({
      timezone: "America/Manaus",
      legacy_timezone: {
        status: "superseded",
        destination: "organizations.timezone",
      },
    });
    expect(profile.legacy_logo_url).toMatchObject({
      status: "superseded",
      destination: "organizations.settings.branding.logo_path",
    });
    expect(profile.branding.legacy_name).not.toHaveProperty("value");
    expect(profile.legacy_logo_url).not.toHaveProperty("value");
    await expect(
      pool.query(
        `select fn_definir_marca_da_organizacao($1,$2,
          '{"app_name":"ataque","accent_hex":"#000000"}'::jsonb)`,
        [ORG_B, ADMIN_A],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("falha ao arquivar reverte o canônico e conserva o alias ativo", async () => {
    await pool.query(`
      create or replace function private.f02_t08_fail_archive()
      returns trigger language plpgsql as $$begin
        raise exception 'f02_t08_archive_fault';
      end$$;
      create trigger f02_t08_fail_archive before insert
        on private.tenant_setting_alias_archive
        for each row execute function private.f02_t08_fail_archive();
    `);
    try {
      await expect(
        pool.query(
          `select fn_definir_marca_da_organizacao($1,$2,
            '{"app_name":"não fica","accent_hex":"#abcdef"}'::jsonb)`,
          [ORG_A, ADMIN_A],
        ),
      ).rejects.toThrow("f02_t08_archive_fault");
      const state = await pool.query<{ app_name: string; alias: unknown }>(
        `select settings#>>'{branding,app_name}' app_name,
          (select value from tenant_settings where organization_id=$1
            and key='branding.name') alias
         from organizations where id=$1`,
        [ORG_A],
      );
      expect(state.rows[0]).toEqual({
        app_name: "Marca A",
        alias: "Marca antiga A",
      });
    } finally {
      await pool.query(`
        drop trigger if exists f02_t08_fail_archive
          on private.tenant_setting_alias_archive;
        drop function if exists private.f02_t08_fail_archive();
      `);
    }
  });
});
