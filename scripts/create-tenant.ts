/**
 * create-tenant (F01-T06, DIRETRIZ §5.21) — cria um tenant a partir de um
 * seed YAML, IDEMPOTENTE: rodar duas vezes cria na primeira e cria ZERO na
 * segunda (`rows_created_second_run=0` é o DoD). Nenhuma inserção acontece
 * antes de o seed inteiro passar no validateSeed (§5.2).
 *
 * Escopo da F01: organização, usuários (papéis D15 mapeados pelo ADR-003:
 * tenant_admin→admin, attendant→agent), tenant_settings e channel_accounts
 * mock. Os blocos products/customers/faq do seed são das fases F02/F04 — o
 * script AVISA que os pulou (nunca silêncio, G-04).
 *
 * Settings com sentinela TODO- (§5.21) não viram linha: pendência não é valor.
 * Seed nunca sobrescreve nada existente (on conflict do nothing) — quem muda
 * configuração viva é o tenant_admin pela tela (setSetting), não uma re-rodada
 * de seed.
 *
 * F02-T07 acrescenta fixtures fictícias somente por opt-in duplo. O documento
 * inteiro é validado antes do pool e o writer roda no mesmo BEGIN/COMMIT.
 */
import * as fs from "node:fs";

import pg from "pg";
import { parse as parseYaml } from "yaml";

import { entradaDoSchema, SCHEMA_VERSION } from "@/src/tenant-config/schema";
import { validateSeed } from "@/src/tenant-config/validate-seed";
import { LEGACY_SETTING_KEYS, prepareCanonicalSeed } from "@/src/tenant-config/canonical-seed";

import { parseF02Fixtures } from "../src/tenant-config/f02-fixtures";
import { parseF02FixtureArgs } from "./f02-fixture-args";
import { writeF02Fixtures } from "./f02-fixture-writer";

interface SeedUser {
  email: string;
  name?: string;
  role: string;
}
interface SeedChannel {
  provider: string;
  account_ref: string;
}
interface Seed {
  tenant: { slug: string; name: string };
  users?: SeedUser[];
  channel_accounts?: SeedChannel[];
  settings?: Record<string, unknown>;
  products?: unknown[];
  customers?: unknown[];
  faq?: unknown[];
}

const PAPEL_ADR003: Record<string, string> = {
  tenant_admin: "admin",
  attendant: "agent",
  // papéis herdados aceitos como estão (seed antigo/da casa)
  admin: "admin",
  manager: "manager",
  agent: "agent",
  viewer: "viewer",
};

function achatarSettings(
  prefixo: string,
  valor: unknown,
  saida: Array<{ key: string; value: unknown }>,
): void {
  if (entradaDoSchema(prefixo)) {
    saida.push({ key: prefixo, value: valor });
    return;
  }
  if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) {
    for (const [k, v] of Object.entries(valor)) {
      achatarSettings(prefixo === "" ? k : `${prefixo}.${k}`, v, saida);
    }
  }
}

function temTodoPendente(v: unknown): boolean {
  if (typeof v === "string") return v.startsWith("TODO-");
  if (Array.isArray(v)) return v.some(temTodoPendente);
  if (typeof v === "object" && v !== null) return Object.values(v).some(temTodoPendente);
  return false;
}

async function main(): Promise<void> {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error(
      "uso: scripts/create-tenant.sh <seed.yaml> [--fictional-fixtures <arquivo> --sandbox-marker <marcador>]",
    );
    process.exit(2);
  }
  const fixtureOptions = parseF02FixtureArgs(process.argv.slice(3));
  const dbUrl = process.env["SUPABASE_DB_URL"];
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL ausente no ambiente (direnv /srv/secrets/crm-saas.env)");
    process.exit(2);
  }

  const seed = parseYaml(fs.readFileSync(arquivo, "utf8")) as Seed;
  const resultado = validateSeed(seed);
  if (resultado.errors.length > 0) {
    console.error(`seed reprovado por validateSeed (${resultado.errors.length} erro(s)):`);
    for (const e of resultado.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`validateSeed: 0 erros, seed_todos=${resultado.seed_todos}`);
  // Limites técnicos e aliases são resolvidos antes do pool. TODO continua
  // pendência e uma URL legada de logo nunca provoca acesso remoto.
  const canonicalSeed = prepareCanonicalSeed(seed.settings);

  // O documento opcional também é validado antes de abrir o pool. Assim erro
  // de fixture produz zero escrita, inclusive da organização-base.
  const f02Fixtures = fixtureOptions
    ? parseF02Fixtures(parseYaml(fs.readFileSync(fixtureOptions.fixturePath, "utf8")), {
        tenantSlug: seed.tenant.slug,
        seedUserEmails: (seed.users ?? []).map((user) => user.email),
      })
    : undefined;

  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  const client = await pool.connect();
  let criadas = 0;
  const conta = async (sql: string, params: unknown[]): Promise<void> => {
    const r = await client.query(sql, params);
    criadas += r.rowCount ?? 0;
  };

  try {
    await client.query("begin");

    // 1. Organização (slug é o unique herdado). Aliases canônicos só entram no
    // INSERT: reencontrar slug nunca edita timezone/marca de tenant vivo.
    const columns = ["slug", "display_name", "legal_name"];
    const values = ["$1", "$2", "$2"];
    const params: unknown[] = [seed.tenant.slug, seed.tenant.name];
    if (canonicalSeed.organization.timezone) {
      columns.push("timezone");
      params.push(canonicalSeed.organization.timezone);
      values.push(`$${params.length}`);
    }
    if (canonicalSeed.organization.branding) {
      columns.push("settings");
      params.push(JSON.stringify({ branding: canonicalSeed.organization.branding }));
      values.push(`$${params.length}::jsonb`);
    }
    const inserted = await client.query<{ id: string }>(
      `insert into public.organizations (${columns.join(",")})
       values (${values.join(",")}) on conflict (slug) do nothing returning id`,
      params,
    );
    criadas += inserted.rowCount ?? 0;
    const org =
      inserted.rows[0]?.id ??
      (
        await client.query<{ id: string }>(`select id from public.organizations where slug = $1`, [
          seed.tenant.slug,
        ])
      ).rows[0]?.id;
    if (!org) throw new Error(`organização ${seed.tenant.slug} não encontrada após insert`);

    // 2. Usuários + membership (ADR-003).
    for (const u of seed.users ?? []) {
      const papel = PAPEL_ADR003[u.role];
      if (!papel) throw new Error(`papel desconhecido no seed: ${u.role} (D15/ADR-003)`);
      // Select-first: auth.users do GoTrue não tem unique simples em email
      // (o índice é (instance_id, lower(email)) e nem é UNIQUE aqui) — um
      // ON CONFLICT (email) quebraria com "no matching constraint".
      let userId = (
        await client.query<{ id: string }>(`select id from auth.users where email = $1`, [u.email])
      ).rows[0]?.id;
      if (!userId) {
        await conta(
          `insert into auth.users (id, email, raw_user_meta_data)
           values (gen_random_uuid(), $1, jsonb_build_object('full_name', $2::text))`,
          [u.email, u.name ?? u.email],
        );
        userId = (
          await client.query<{ id: string }>(`select id from auth.users where email = $1`, [
            u.email,
          ])
        ).rows[0]?.id;
      }
      if (!userId) throw new Error(`usuário ${u.email} não encontrado após insert`);
      await conta(
        `insert into public.user_organizations (user_id, organization_id, role, accepted_at)
         values ($1, $2, $3, now()) on conflict do nothing`,
        [userId, org, papel],
      );
    }

    if (f02Fixtures && fixtureOptions) {
      const written = await writeF02Fixtures(client, org, f02Fixtures, {
        sandboxMarker: fixtureOptions.sandboxMarker,
      });
      criadas += written.rowsCreated;
      console.info(`fixtures_f02=${written.rowsCreated} shape=fictitious-v1`);
    }

    // 3. Canais mock (channel_accounts, §5.1).
    for (const c of seed.channel_accounts ?? []) {
      await conta(
        `insert into public.channel_accounts (organization_id, provider, account_key)
         values ($1, $2, $3) on conflict (provider, account_key) do nothing`,
        [org, c.provider, c.account_ref],
      );
    }

    // 4. Settings (§5.2) — pendência TODO-DEKA não vira linha.
    const pares: Array<{ key: string; value: unknown }> = [];
    achatarSettings("", canonicalSeed.settings, pares);
    let pulados = 0;
    for (const { key, value } of pares) {
      if (temTodoPendente(value)) {
        pulados += 1;
        continue;
      }
      // Fonte canônica já foi gravada no INSERT da organização nova. Em rerun
      // de slug existente, não ressuscitar aliases nem tocar a fonte viva.
      if (LEGACY_SETTING_KEYS.has(key)) continue;
      await conta(
        `insert into public.tenant_settings (organization_id, key, value, schema_version, source)
         values ($1, $2, $3, $4, 'seed') on conflict (organization_id, key) do nothing`,
        [org, key, JSON.stringify(value), SCHEMA_VERSION],
      );
    }
    if (pulados > 0)
      console.log(`settings com sentinela TODO- puladas (pendência não é valor): ${pulados}`);

    for (const bloco of ["products", "customers", "faq"] as const) {
      const n = (seed[bloco] ?? []).length;
      if (n > 0)
        console.log(
          `bloco ${bloco} (${n} itens) PULADO: entra na fase que adapta a tabela (F02/F04)`,
        );
    }

    await client.query("commit");
    console.log(`tenant=${seed.tenant.slug} organization_id=${org} rows_created=${criadas}`);
  } catch (erro) {
    await client.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
