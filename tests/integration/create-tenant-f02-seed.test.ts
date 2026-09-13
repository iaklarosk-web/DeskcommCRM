import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";
import { parse as parseYaml } from "yaml";
import { afterAll, describe, expect, it } from "vitest";

import {
  F02FixtureError,
  fixtureUuid,
  parseF02Fixtures,
  type F02FixtureDocument,
} from "../../src/tenant-config/f02-fixtures";
import { writeF02Fixtures } from "../../scripts/f02-fixture-writer";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 2,
});

const MARKER = "f02-fixture-sandbox-integration-v1";
const ORG_A = "a7070000-0000-4000-8000-000000000001";
const ORG_B = "b7070000-0000-4000-8000-000000000002";
const USER_A = "a7070000-1000-4000-8000-000000000001";
const USER_B = "b7070000-1000-4000-8000-000000000002";
const raw = parseYaml(
  fs.readFileSync(
    fileURLToPath(new URL("../../docs/tenants/demo2.f02-fixtures.yaml", import.meta.url)),
    "utf8",
  ),
) as Record<string, unknown>;

const SNAPSHOT_SQL = `select jsonb_build_object(
  'companies',(select jsonb_agg(c order by id) from crm_companies c where organization_id=$1),
  'contacts',(select jsonb_agg(c order by id) from contacts c where organization_id=$1),
  'products',(select jsonb_agg(p order by id) from catalog_products p where organization_id=$1),
  'orders',(select jsonb_agg(o order by id) from crm_orders o where organization_id=$1),
  'items',(select jsonb_agg(i order by id) from crm_order_items i where organization_id=$1),
  'receipts',(select jsonb_agg(r order by id) from crm_order_command_receipts r where organization_id=$1),
  'events',(select jsonb_agg(e order by id) from crm_order_events e where organization_id=$1),
  'audits',(select jsonb_agg(a order by id) from api_audit_log a where organization_id=$1 and resource_type='crm_orders')
) snapshot`;

function fixtureFor(slug: string, actorEmail: string): F02FixtureDocument {
  return parseF02Fixtures(
    { ...structuredClone(raw), tenant_slug: slug, actor_email: actorEmail },
    {
      tenantSlug: slug,
      seedUserEmails: [actorEmail],
    },
  );
}

async function inRollback(callback: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('crm.fictional_fixture_sandbox',$1,true)`, [MARKER]);
    await client.query(
      `insert into auth.users(id,email) values($1,'actor-a@fixtures.test'),($2,'actor-b@fixtures.test')`,
      [USER_A, USER_B],
    );
    await client.query(
      `insert into public.organizations(id,slug,legal_name,display_name) values
        ($1,'fixture-a','Fixture A','Fixture A'),($2,'fixture-b','Fixture B','Fixture B')`,
      [ORG_A, ORG_B],
    );
    await client.query(
      `insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
        ($1,$2,'admin',now()),($3,$4,'admin',now())`,
      [ORG_A, USER_A, ORG_B, USER_B],
    );
    await callback(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

afterAll(async () => {
  await pool.end();
});

describe("F02-T07 — seed comercial fictício", () => {
  it("CLI completo repete o YAML em dois tenants sem duplicar nem alterar snapshots", async () => {
    const run = promisify(execFile);
    const seedBase = parseYaml(fs.readFileSync("docs/tenants/demo2.seed.yaml", "utf8"));
    fs.mkdirSync(".verify-logs", { recursive: true });
    const scratch = fs.mkdtempSync(path.resolve(".verify-logs/f02-seed-cli-"));
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    for (const key of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "PNPM_HOME"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.SUPABASE_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
    // Este é o banco exclusivo criado pelo harness, nunca uma conexão do ambiente.
    await pool.query(`alter database postgres set "crm.fictional_fixture_sandbox" = '${MARKER}'`);
    try {
      for (const side of ["a", "b"] as const) {
        const slug = `f02-cli-${side}`;
        const email = `operator-${side}@cli-fixtures.test`;
        const seed = {
          ...seedBase,
          tenant: { slug, name: `CLI Fictício ${side}` },
          users: [{ email, name: `Operador fictício ${side}`, role: "tenant_admin" }],
          products: [],
          customers: [],
          channel_accounts: [],
          settings: {
            ...seedBase.settings,
            business: {
              ...seedBase.settings.business,
              timezone: side === "a" ? "America/Recife" : "America/Manaus",
            },
            branding: { name: `Marca fictícia ${side}`, primary_color: "#112233", logo_url: null },
          },
        };
        const fixtures = parseF02Fixtures(
          { ...structuredClone(raw), tenant_slug: slug, actor_email: email },
          { tenantSlug: slug, seedUserEmails: [email] },
        );
        const seedPath = path.join(scratch, `${side}.seed.yaml`);
        const fixturePath = path.join(scratch, `${side}.fixtures.yaml`);
        fs.writeFileSync(seedPath, JSON.stringify(seed));
        fs.writeFileSync(fixturePath, JSON.stringify(fixtures));
        const args = [
          "scripts/create-tenant.sh",
          seedPath,
          "--fictional-fixtures",
          fixturePath,
          "--sandbox-marker",
          MARKER,
        ];
        const first = await run("bash", args, { env, timeout: 20_000 });
        expect(first.stdout).toContain("fixtures_f02=29");
        const organization = await pool.query<{ id: string }>(
          "select id from organizations where slug=$1",
          [slug],
        );
        expect(organization.rows).toHaveLength(1);
        const orgId = organization.rows[0]!.id;
        const canonical = await pool.query(
          "select timezone,settings from organizations where id=$1",
          [orgId],
        );
        expect(canonical.rows[0]).toMatchObject({
          timezone: seed.settings.business.timezone,
          settings: { branding: { app_name: `Marca fictícia ${side}`, accent_hex: "#112233" } },
        });
        expect(
          (
            await pool.query(
              "select key from tenant_settings where organization_id=$1 and key=any($2::text[])",
              [
                orgId,
                [
                  "business.timezone",
                  "branding.name",
                  "branding.primary_color",
                  "branding.logo_url",
                ],
              ],
            )
          ).rows,
        ).toEqual([]);
        // Simula o proprietário personalizando a fonte canônica entre execuções.
        await pool.query(
          "update organizations set timezone='UTC',settings=jsonb_set(settings,'{branding,app_name}',to_jsonb($2::text)) where id=$1",
          [orgId, `Marca personalizada ${side}`],
        );
        const canonicalBeforeReplay = (
          await pool.query("select timezone,settings from organizations where id=$1", [orgId])
        ).rows;
        const before = (await pool.query(SNAPSHOT_SQL, [orgId])).rows[0]!.snapshot;
        expect(before.companies).toHaveLength(fixtures.companies.length);
        expect(before.contacts).toHaveLength(fixtures.contacts.length);
        expect(before.products).toHaveLength(fixtures.products.length);
        expect(before.orders).toHaveLength(fixtures.orders.length);
        const settingsBefore = await pool.query(
          "select * from tenant_settings where organization_id=$1 order by key",
          [orgId],
        );
        const second = await run("bash", args, { env, timeout: 20_000 });
        expect(second.stdout).toContain("fixtures_f02=0");
        expect(second.stdout).toMatch(/rows_created=0\b/);
        expect(
          (await pool.query("select timezone,settings from organizations where id=$1", [orgId]))
            .rows,
        ).toEqual(canonicalBeforeReplay);
        expect((await pool.query(SNAPSHOT_SQL, [orgId])).rows[0]!.snapshot).toEqual(before);
        expect(
          (
            await pool.query(
              "select * from tenant_settings where organization_id=$1 order by key",
              [orgId],
            )
          ).rows,
        ).toEqual(settingsBefore.rows);
        expect(
          (
            await pool.query(
              "select count(*)::int n from channel_accounts where organization_id=$1",
              [orgId],
            )
          ).rows[0]?.n,
        ).toBe(0);
      }
    } finally {
      await pool.query('alter database postgres reset "crm.fictional_fixture_sandbox"');
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }, 90_000);

  it("cria uma vez, cria zero na segunda e mantém journal/receipt/audit coerentes", async () => {
    await inRollback(async (client) => {
      const fixture = fixtureFor("fixture-a", "actor-a@fixtures.test");
      await expect(
        writeF02Fixtures(client, ORG_A, fixture, { sandboxMarker: MARKER }),
      ).resolves.toEqual({
        rowsCreated: 29,
      });
      const before = await client.query(SNAPSHOT_SQL, [ORG_A]);
      await expect(
        writeF02Fixtures(client, ORG_A, fixture, { sandboxMarker: MARKER }),
      ).resolves.toEqual({
        rowsCreated: 0,
      });
      const after = await client.query(SNAPSHOT_SQL, [ORG_A]);
      expect(after.rows[0]?.snapshot).toEqual(before.rows[0]?.snapshot);

      const journal = await client.query(
        `select count(distinct r.id)::int receipts,count(distinct e.id)::int events,
                count(distinct a.id)::int audits,
                bool_and(r.response_body->>'id'=r.order_id::text) responses_match
           from crm_order_command_receipts r
           join crm_order_events e on (e.organization_id,e.receipt_id)=(r.organization_id,r.id)
           join api_audit_log a on a.organization_id=r.organization_id
             and a.metadata->>'receipt_id'=r.id::text
          where r.organization_id=$1`,
        [ORG_A],
      );
      expect(journal.rows[0]).toMatchObject({
        receipts: 5,
        events: 5,
        audits: 5,
        responses_match: true,
      });
      expect(JSON.stringify(journal.rows)).not.toContain("Fictício");
    });
  });

  it("semeia dois tenants SaaS isolados e namespacing produz IDs diferentes", async () => {
    await inRollback(async (client) => {
      const fixtureA = fixtureFor("fixture-a", "actor-a@fixtures.test");
      const fixtureB = fixtureFor("fixture-b", "actor-b@fixtures.test");
      await writeF02Fixtures(client, ORG_A, fixtureA, { sandboxMarker: MARKER });
      await writeF02Fixtures(client, ORG_B, fixtureB, { sandboxMarker: MARKER });
      const counts = await client.query(
        `select organization_id,count(*)::int from crm_companies
          where organization_id=any($1::uuid[]) group by organization_id order by organization_id`,
        [[ORG_A, ORG_B]],
      );
      expect(counts.rows.map((row) => row.count)).toEqual([2, 2]);
      expect(fixtureUuid(ORG_A, "company", "empresa-alfa")).not.toBe(
        fixtureUuid(ORG_B, "company", "empresa-alfa"),
      );
      const cross = await client.query(
        `select count(*)::int from crm_orders a join crm_orders b on a.id=b.id
          where a.organization_id=$1 and b.organization_id=$2`,
        [ORG_A, ORG_B],
      );
      expect(cross.rows[0]?.count).toBe(0);
    });
  });

  it("recusa marcador ausente ou diferente antes de inserir domínio", async () => {
    await inRollback(async (client) => {
      const fixture = fixtureFor("fixture-a", "actor-a@fixtures.test");
      await expect(
        writeF02Fixtures(client, ORG_A, fixture, { sandboxMarker: "marker-errado-com-16-chars" }),
      ).rejects.toThrowError(new F02FixtureError("sandbox_marker_mismatch"));
      const count = await client.query(
        `select (select count(*) from crm_companies where organization_id=$1)+
                (select count(*) from contacts where organization_id=$1)+
                (select count(*) from crm_orders where organization_id=$1) count`,
        [ORG_A],
      );
      expect(Number(count.rows[0]?.count)).toBe(0);
    });
  });

  it("recusa tenant com dado comercial alheio sem misturar nem sobrescrever", async () => {
    await inRollback(async (client) => {
      await client.query(
        `insert into public.crm_companies(organization_id,legal_name)
         values($1,'Empresa preexistente fora da fixture')`,
        [ORG_A],
      );
      const fixture = fixtureFor("fixture-a", "actor-a@fixtures.test");
      await expect(
        writeF02Fixtures(client, ORG_A, fixture, { sandboxMarker: MARKER }),
      ).rejects.toThrowError(new F02FixtureError("tenant_has_non_fixture_commercial_data"));
      expect(
        Number(
          (
            await client.query(`select count(*) from crm_companies where organization_id=$1`, [
              ORG_A,
            ])
          ).rows[0]?.count,
        ),
      ).toBe(1);
    });
  });

  it("recusa colisão global deliberada mesmo antes do INSERT conflitar", async () => {
    await inRollback(async (client) => {
      const collision = fixtureUuid(ORG_A, "company", "empresa-alfa");
      await client.query(
        `insert into public.crm_companies(id,organization_id,legal_name) values($1,$2,'Colisão B')`,
        [collision, ORG_B],
      );
      const fixture = fixtureFor("fixture-a", "actor-a@fixtures.test");
      await expect(
        writeF02Fixtures(client, ORG_A, fixture, { sandboxMarker: MARKER }),
      ).rejects.toThrowError(new F02FixtureError("fixture_global_id_collision"));
    });
  });

  it("não cria mensagens, jobs, canais nem fila de redação", async () => {
    await inRollback(async (client) => {
      const fixture = fixtureFor("fixture-a", "actor-a@fixtures.test");
      const counts = async () =>
        (
          await client.query(
            `select
              (select count(*)::int from messages where organization_id=$1) messages,
              (select count(*)::int from job_queue where organization_id=$1) jobs,
              (select count(*)::int from channel_accounts where organization_id=$1) channels,
              (select count(*)::int from storage_redaction_queue where organization_id=$1) redactions`,
            [ORG_A],
          )
        ).rows[0];
      const before = await counts();
      await writeF02Fixtures(client, ORG_A, fixture, { sandboxMarker: MARKER });
      expect(await counts()).toEqual(before);
    });
  });
});
