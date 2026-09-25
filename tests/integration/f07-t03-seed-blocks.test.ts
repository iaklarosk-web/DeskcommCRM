/**
 * F07-T03 (ADR-029 §3, VARREDURA §B13) — o loader do seed grava os blocos
 * `products`, `customers` e `faq` nas tabelas de F02/F04 e continua
 * idempotente (segunda execução: rows_created=0).
 *
 * Prova pelo CLI inteiro (`scripts/create-tenant.sh`), não pela função: é o
 * caminho que §8.7 §6 documenta e que a T03 executa "ao pé da letra". A
 * contagem é `seed=N banco=N` por bloco, lida do banco depois.
 *
 * Mutante: tests/mutants/58-f07-loader-pula-blocos-do-seed.sh (o loader volta
 * a pular os blocos) deixa `products: seed=1 banco=1` vermelho.
 */
import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import pg from "pg";
import { parse as parseYaml } from "yaml";
import { afterAll, describe, expect, it } from "vitest";

import { fixtureUuid, parseF02Fixtures } from "@/src/tenant-config/f02-fixtures";
import { escreverBlocosDoSeed } from "@/scripts/seed-blocks";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 2,
});
afterAll(async () => {
  await pool.end();
});

const run = promisify(execFile);
const MARKER = "f07-seed-blocks-sandbox-integration-v1";

function ambienteDoCli(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "PNPM_HOME"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.SUPABASE_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  return env;
}

async function contagens(slug: string) {
  const r = await pool.query<Record<string, string>>(
    `select
       (select count(*) from public.catalog_products p where p.organization_id = o.id and p.origem = 'seed') as products,
       (select count(*) from public.contacts c where c.organization_id = o.id and c.source = 'seed') as customers,
       (select count(*) from public.crm_companies e where e.organization_id = o.id
          and e.id in (select c.company_id from public.contacts c where c.organization_id = o.id and c.source = 'seed')) as companies,
       (select count(*) from public.ai_knowledge_sources s where s.organization_id = o.id and s.agent_id is null and s.name = 'FAQ do seed' and s.is_active) as materiais,
       (select coalesce(sum(s.chunks_count),0) from public.ai_knowledge_sources s where s.organization_id = o.id and s.agent_id is null and s.name = 'FAQ do seed') as trechos,
       (select count(*) from public.ai_chunks k where k.organization_id = o.id) as chunks,
       (select count(*) from auth.users u join public.user_organizations uo on uo.user_id = u.id where uo.organization_id = o.id) as users,
       (o.onboarded_at is not null)::text as onboarded
     from public.organizations o where o.slug = $1`,
    [slug],
  );
  expect(r.rowCount, `organização ${slug} existe`).toBe(1);
  const linha = r.rows[0]!;
  return Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, k === "onboarded" ? v : Number(v)])) as Record<
    string,
    number | string
  >;
}

describe("F07-T03 — loader do seed grava products/customers/faq", () => {
  it("cria os três blocos do demo2 pelo CLI, e a segunda execução cria zero linhas", async () => {
    const seedBase = parseYaml(fs.readFileSync("docs/tenants/demo2.seed.yaml", "utf8"));
    fs.mkdirSync(".verify-logs", { recursive: true });
    const scratch = fs.mkdtempSync(path.resolve(".verify-logs/f07-seed-blocks-"));
    try {
      const slug = "f07-seed-blocos";
      const seed = {
        ...seedBase,
        tenant: { slug, name: "Seed com blocos" },
        users: [
          { email: "admin@f07-seed.test", name: "Admin", role: "tenant_admin" },
          // Sentinela: pendência não é usuário (ADR-029 §3) — não pode virar auth.users.
          { email: "TODO-F07", name: "TODO-F07", role: "attendant" },
        ],
        channel_accounts: [{ provider: "mock", account_ref: "f07-seed-blocos-mock", test_number: "+5500000000077" }],
      };
      const seedPath = path.join(scratch, "seed.yaml");
      fs.writeFileSync(seedPath, JSON.stringify(seed));
      // Com as fixtures fictícias da F02, como o up.sh do staging faz: o rerun
      // tem de reencontrar seed + fixture sem `tenant_has_non_fixture_commercial_data`.
      const fixtures = parseF02Fixtures(
        { ...(parseYaml(fs.readFileSync("docs/tenants/demo2.f02-fixtures.yaml", "utf8")) as Record<string, unknown>), tenant_slug: slug, actor_email: "admin@f07-seed.test" },
        { tenantSlug: slug, seedUserEmails: ["admin@f07-seed.test"] },
      );
      const fixturePath = path.join(scratch, "fixtures.yaml");
      fs.writeFileSync(fixturePath, JSON.stringify(fixtures));
      await pool.query(`alter database postgres set "crm.fictional_fixture_sandbox" = '${MARKER}'`);
      const args = ["scripts/create-tenant.sh", seedPath, "--fictional-fixtures", fixturePath, "--sandbox-marker", MARKER];
      const env = ambienteDoCli();

      const primeira = await run("bash", args, { env, timeout: 60_000 });
      expect(primeira.stdout).toMatch(/^products=1 customers=1 companies=1$/m);
      expect(primeira.stdout).toMatch(/^faq=7 acervo_materiais=1 acervo_trechos=[1-9]\d*$/m);
      expect(primeira.stdout).toMatch(/^users com sentinela TODO- pulados \(pendência não é usuário\): 1$/m);
      const criadas = Number(/rows_created=(\d+)/.exec(primeira.stdout)?.[1]);
      expect(criadas).toBeGreaterThanOrEqual(1 + 1 + 1 + 1 + 1 + 1 + 3);

      const banco = await contagens(slug);
      const esperado = { products: seed.products.length, customers: seed.customers.length, companies: 1, faq: seed.faq.length };
      expect(`products: seed=${esperado.products} banco=${banco.products}`).toBe(`products: seed=1 banco=1`);
      expect(`customers: seed=${esperado.customers} banco=${banco.customers}`).toBe(`customers: seed=1 banco=1`);
      expect(`companies: seed=${esperado.companies} banco=${banco.companies}`).toBe(`companies: seed=1 banco=1`);
      expect(banco.materiais).toBe(1);
      expect(Number(banco.trechos)).toBeGreaterThan(0);
      expect(banco.chunks).toBe(banco.trechos);
      expect(banco.users, "só o usuário real; a sentinela TODO- não virou auth.users").toBe(1);
      expect(banco.onboarded, "onboarded_at preenchido no INSERT").toBe("true");
      const sentinela = await pool.query(`select 1 from auth.users where email = 'TODO-F07'`);
      expect(sentinela.rowCount).toBe(0);

      // O cliente do seed: telefone, empresa vinculada e metadado da origem.
      const cliente = await pool.query<{ phone_number: string; legal_name: string; meta: unknown; recurring: boolean }>(
        `select c.phone_number, e.legal_name, c.source_metadata as meta, c.recurring
           from public.contacts c join public.organizations o on o.id = c.organization_id
           left join public.crm_companies e on e.id = c.company_id
          where o.slug = $1 and c.source = 'seed'`,
        [slug],
      );
      expect(cliente.rows[0]).toMatchObject({ phone_number: "+5500000000102", legal_name: "Sol Ltda", recurring: true });
      expect(cliente.rows[0]?.meta).toEqual({ seed: { recurring_weekday: 2 } });
      const produto = await pool.query<{ codigo: string; sale_unit: string; preco_cents: string }>(
        `select p.codigo, p.sale_unit, p.preco_cents from public.catalog_products p join public.organizations o on o.id = p.organization_id where o.slug = $1 and p.origem = 'seed'`,
        [slug],
      );
      expect(produto.rows[0]).toMatchObject({ codigo: "VIS-01", sale_unit: "un", preco_cents: "15000" });

      const segunda = await run("bash", args, { env, timeout: 60_000 });
      expect(segunda.stdout).toMatch(/rows_created=0$/m);
      expect(segunda.stdout).toMatch(/^products=0 customers=0 companies=0/m);
      expect(segunda.stdout).toMatch(/^faq=7 acervo_materiais=0 acervo_trechos=[1-9]\d*$/m);
      const depois = await contagens(slug);
      expect(depois).toEqual(banco);

      gravarLinhaDoVerify(
        "seed-blocks",
        `seed-blocks: products=${esperado.products}/${banco.products} customers=${esperado.customers}/${banco.customers} companies=${esperado.companies}/${banco.companies} faq=${esperado.faq} materiais=${banco.materiais} trechos=${banco.trechos} second_run_rows=0`,
      );
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Em processo, dentro de uma transação desfeita: é o caso que o mutante 58
  // sabota em memória (o CLI acima roda em subprocesso, fora do transform).
  it("escreverBlocosDoSeed grava products/customers com seed=N banco=N e é idempotente por id", async () => {
    const seedBase = parseYaml(fs.readFileSync("docs/tenants/demo2.seed.yaml", "utf8"));
    const client = await pool.connect();
    try {
      await client.query("begin");
      const org = (
        await client.query<{ id: string }>(
          `insert into public.organizations (slug, display_name, legal_name) values ('f07-blocos-mem', 'Blocos', 'Blocos') returning id`,
        )
      ).rows[0]!.id;
      // Um produto inteiro em sentinela, como o deka de hoje: pendência, não linha.
      const pendente = { sku: "TODO-F07", name: "TODO-F07", unit: "TODO-F07", price_cents: "TODO-F07", active: true };
      const primeira = await escreverBlocosDoSeed(
        client,
        org,
        { products: [...seedBase.products, pendente as never], customers: seedBase.customers },
        fixtureUuid,
      );
      const banco = await client.query<{ products: string; customers: string; companies: string }>(
        `select
           (select count(*) from public.catalog_products where organization_id = $1 and origem = 'seed') as products,
           (select count(*) from public.contacts where organization_id = $1 and source = 'seed') as customers,
           (select count(*) from public.crm_companies where organization_id = $1) as companies`,
        [org],
      );
      const lido = banco.rows[0]!;
      expect(`products: seed=${seedBase.products.length} banco=${lido.products}`).toBe("products: seed=1 banco=1");
      expect(`customers: seed=${seedBase.customers.length} banco=${lido.customers}`).toBe("customers: seed=1 banco=1");
      expect(`companies: seed=1 banco=${lido.companies}`).toBe("companies: seed=1 banco=1");
      expect(primeira).toMatchObject({ products: 1, customers: 1, companies: 1, pendentes: 1, rowsCreated: 3 });

      const segunda = await escreverBlocosDoSeed(
        client,
        org,
        { products: seedBase.products, customers: seedBase.customers },
        fixtureUuid,
      );
      expect(segunda).toMatchObject({ products: 0, customers: 0, companies: 0, rowsCreated: 0 });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});
