/**
 * Organização A das fixtures de navegador PROVISIONADA DO SEED (ADR-029 §2).
 *
 * Com `E2E_TENANT=<slug>`, a organização **A** de cada spec do gate deixa de
 * ser um `insert` solto e passa a nascer por `scripts/create-tenant.sh` — o
 * caminho de "como criar um tenant novo" (§8.7 §6) — a partir de
 * `docs/tenants/<slug>.seed.yaml`. É isso que `replicability: e2e[deka]=ok
 * e2e[demo2]=ok` mede: a MESMA suíte, sem `if tenant ==`, sobre a configuração
 * de cada tenant vinda só de `docs/tenants/`.
 *
 * Três diferenças mecânicas, gravadas num YAML temporário FORA da árvore
 * (o gate tira SHA-256 dos inputs; `os.tmpdir()` não é input):
 *   - `tenant.slug` vira `<slug>-e2e-<sufixo>`: a organização é apagável ao
 *     fim, como hoje (a limpeza das specs apaga por id, com cascata);
 *   - `users` saem: a spec traz os próprios humanos (manager/viewer/admin) com
 *     senha, pela API de auth; o seed não tem senha e o deka tem só TODO-;
 *   - `channel_accounts[].account_ref` ganha o sufixo: o índice
 *     `(provider, account_key)` é global, e o seed do tenant persistente já o
 *     ocupa no staging.
 * Nome, fuso, marca, settings, products, customers e faq entram como estão.
 *
 * Sem `E2E_TENANT`, nada muda: a organização A é o insert fictício de sempre
 * (`fictitious_A_B`). A organização B é SEMPRE fictícia — é o outro lado da
 * prova de isolamento, não um tenant.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** O tenant pedido pelo gate, validado; `null` = organização fictícia. */
export function tenantDoSeed(): string | null {
  const slug = process.env.E2E_TENANT;
  if (slug === undefined || slug === "") return null;
  if (!SLUG.test(slug)) throw new Error(`E2E_TENANT inválido: ${slug}`);
  return slug;
}

export interface OrganizacaoDaFixture {
  slug: string;
  display_name: string;
  legal_name: string;
}

interface SeedYaml {
  tenant: { slug: string; name: string };
  users?: unknown[];
  channel_accounts?: Array<{ account_ref?: string } & Record<string, unknown>>;
  [bloco: string]: unknown;
}

function raizDoRepositorio(): string {
  // tests/e2e/utils → raiz. Sem `git rev-parse`: o worker do Playwright já
  // roda a partir da raiz verificada, e o caminho relativo é o que o gate mede.
  return path.resolve(__dirname, "../../..");
}

/**
 * Provisiona a organização A pelo loader, a partir do seed do tenant.
 * Devolve o id. Lança se o loader não imprimir `organization_id=`.
 */
export function provisionarOrganizacaoDoSeed(slug: string, sufixo: string): string {
  const raiz = raizDoRepositorio();
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("E2E_TENANT exige SUPABASE_DB_URL no ambiente do runner (.env.e2e)");
  const seed = parseYaml(readFileSync(path.join(raiz, `docs/tenants/${slug}.seed.yaml`), "utf8")) as SeedYaml;
  const replica: SeedYaml = {
    ...seed,
    tenant: { ...seed.tenant, slug: `${slug}-e2e-${sufixo}` },
    users: [],
    channel_accounts: (seed.channel_accounts ?? []).map((conta) => ({
      ...conta,
      account_ref: `${String(conta.account_ref ?? conta["provider"])}-e2e-${sufixo}`,
    })),
  };
  const pasta = mkdtempSync(path.join(os.tmpdir(), `e2e-tenant-${slug}-`));
  try {
    const arquivo = path.join(pasta, `${slug}.seed.yaml`);
    writeFileSync(arquivo, stringifyYaml(replica));
    const saida = execFileSync("bash", [path.join(raiz, "scripts/create-tenant.sh"), arquivo], {
      cwd: raiz,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, SUPABASE_DB_URL: dbUrl, NODE_ENV: process.env.NODE_ENV ?? "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const id = /organization_id=([0-9a-f-]{36})/.exec(saida)?.[1];
    if (!id) throw new Error(`create-tenant não devolveu organization_id para ${replica.tenant.slug}:\n${saida}`);
    return id;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/**
 * Cria a organização de um lado da fixture: A pelo seed quando `E2E_TENANT`
 * está posto, senão (e sempre para B) o insert fictício de sempre.
 */
export async function criarOrganizacaoDaFixture(
  db: SupabaseClient,
  lado: "A" | "B",
  sufixo: string,
  ficticia: OrganizacaoDaFixture,
): Promise<string> {
  const slug = tenantDoSeed();
  if (lado === "A" && slug) return provisionarOrganizacaoDoSeed(slug, sufixo);
  const { data, error } = await db
    .from("organizations")
    .insert({
      slug: ficticia.slug,
      display_name: ficticia.display_name,
      legal_name: ficticia.legal_name,
      status: "active",
      onboarded_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("organização de fixture não criada");
  return (data as { id: string }).id;
}
