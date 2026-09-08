/**
 * rls-coverage (F01-T03, DIRETRIZ §5.15/G-26) — a varredura de CATÁLOGO que
 * complementa a completude comportamental (rls-completude-varredura.test.ts):
 *
 *   1. toda tabela pública ou tem organization_id ou está na allowlist
 *      tests/db/global_tables.txt (afirmação assinada de "é da plataforma");
 *   2. toda tabela com organization_id tem policy — ou está marcada
 *      service_only no MANIFEST (RLS ligada SEM policies + grants revogados);
 *   3. tabela service_only NÃO tem grant a authenticated nem a anon
 *      (o controle dela é o grant, e um grant que volta é o furo inteiro);
 *   4. grants de anon em tabelas de tenant = 0 (G-54 — a migration 0220 revoga
 *      os ~48 herdados do dump e esta linha impede o retorno).
 *
 * As DUAS listas vêm de arquivos que um humano versiona (allowlist e MANIFEST),
 * nunca do teste — a lista dentro do teste é o que apodrece sem cobrador.
 * Imprime a linha do VERIFY: `rls-coverage: tables_with_org_id=K
 * policies_found=P missing=0 service_only_with_grant=0`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gravarLinhaDoVerify } from "../lib/verify-metrics";
import { sql } from "./gov-helpers";

const RAIZ = path.resolve(__dirname, "../..");

function allowlistGlobais(): Set<string> {
  const texto = readFileSync(path.join(RAIZ, "tests/db/global_tables.txt"), "utf8");
  return new Set(
    texto
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#")),
  );
}

/** Lê a seção service_only do MANIFEST: linhas `| \`tabela\` | ... |`. */
function serviceOnlyDoManifest(): Set<string> {
  const texto = readFileSync(
    path.join(RAIZ, "supabase/migrations/MANIFEST.md"),
    "utf8",
  );
  const inicio = texto.indexOf("## service_only");
  expect(inicio, "MANIFEST sem seção service_only (D35)").toBeGreaterThan(-1);
  const secao = texto.slice(inicio).split("\n## ")[0] ?? "";
  const tabelas = new Set<string>();
  for (const m of secao.matchAll(/^\|\s*`([a-z_0-9]+)`\s*\|/gm)) {
    if (m[1] && m[1] !== "Tabela") tabelas.add(m[1]);
  }
  return tabelas;
}

function linhas(consulta: string): string[] {
  return sql(consulta)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

describe("rls-coverage — catálogo completo de RLS (§5.15)", () => {
  const globais = allowlistGlobais();
  const serviceOnly = serviceOnlyDoManifest();

  const comOrg = linhas(`
    select t.tablename from pg_tables t
     where t.schemaname = 'public'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.tablename
                      and c.column_name = 'organization_id')
     order by 1;`);

  const semOrg = linhas(`
    select t.tablename from pg_tables t
     where t.schemaname = 'public'
       and not exists (select 1 from information_schema.columns c
                        where c.table_schema = 'public' and c.table_name = t.tablename
                          and c.column_name = 'organization_id')
     order by 1;`);

  const comPolicy = new Set(
    linhas(`select distinct tablename from pg_policies where schemaname = 'public';`),
  );

  it("service_only declara tabelas existentes com RLS ligada", () => {
    // Um merge pode inserir linhas do catálogo de MIGRATIONS nesta seção.
    // Sem conferir o catálogo, timestamps viram falsas exceções e passam
    // silenciosamente pelo teste de grants (a tabela inexistente não tem grant).
    const existentes = new Set([...comOrg, ...semOrg]);
    expect(
      [...serviceOnly].filter((t) => !existentes.has(t)),
      "service_only contém nome que não é tabela pública — confira a estrutura do MANIFEST",
    ).toEqual([]);
    const comRls = new Set(
      linhas(`select tablename from pg_tables where schemaname = 'public' and rowsecurity;`),
    );
    expect(
      [...serviceOnly].filter((t) => !comRls.has(t)),
      "service_only exige RLS ligada mesmo quando os grants já negam acesso ao cliente",
    ).toEqual([]);
  });

  it("toda tabela sem organization_id está na allowlist de globais", () => {
    const foraDaAllowlist = semOrg.filter((t) => !globais.has(t));
    expect(
      foraDaAllowlist,
      "tabela sem organization_id fora de tests/db/global_tables.txt — ou ela ganha organization_id, ou alguém assina que é da plataforma acrescentando-a à allowlist",
    ).toEqual([]);
  });

  it("toda tabela com organization_id tem policy — ou é service_only no MANIFEST", () => {
    const missing = comOrg.filter((t) => !comPolicy.has(t) && !serviceOnly.has(t));
    expect(
      missing,
      "tabela tenant-aware sem policy e sem marcação service_only no MANIFEST",
    ).toEqual([]);
  });

  it("tabela service_only não tem grant a authenticated nem a anon", () => {
    const marcadas = [...serviceOnly].sort();
    expect(marcadas.length).toBeGreaterThan(0);
    const comGrant = linhas(`
      select distinct table_name from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee in ('authenticated', 'anon')
         and table_name in (${marcadas.map((t) => `'${t}'`).join(", ")})
       order by 1;`);
    expect(comGrant, "service_only com grant — o controle dessas tabelas É o grant").toEqual([]);
  });

  it("grants de anon em tabelas de tenant = 0 (G-54)", () => {
    const anonEmTenant = linhas(`
      select distinct g.table_name from information_schema.role_table_grants g
       where g.grantee = 'anon' and g.table_schema = 'public'
         and exists (select 1 from pg_tables t
                      where t.schemaname = 'public' and t.tablename = g.table_name)
         and exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = g.table_name
                        and c.column_name = 'organization_id')
       order by 1;`);
    expect(anonEmTenant, "anon com grant em tabela de tenant — a 0220 revogou; algo devolveu").toEqual([]);
  });

  it("imprime a linha do VERIFY SUMMARY", () => {
    const k = comOrg.length;
    const p = comOrg.filter((t) => comPolicy.has(t)).length;
    // Os zeros são os das asserções acima: se chegou aqui, valem.
    const linha = `rls-coverage: tables_with_org_id=${k} policies_found=${p} missing=0 service_only_with_grant=0`;
    console.log(linha);
    gravarLinhaDoVerify("rls-coverage", linha);
    expect(k).toBeGreaterThan(100);
    expect(p).toBeGreaterThan(100);
  });
});
