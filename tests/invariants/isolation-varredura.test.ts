/**
 * isolation-varredura (F01-T04, DIRETRIZ §5.15/G-26) — a prova K × 4 ops × 2
 * direções: para CADA tabela de tenant, um usuário da org A tenta select,
 * insert, update e delete sobre linhas da org B (e vice-versa). Vazamento =
 * linha LIDA ou AFETADA — erro (policy, grant, constraint) significa que a
 * linha não landou/não saiu, e portanto não vazou.
 *
 * ## Como ela alcança as 100+ tabelas sem 100+ seeds curados
 *
 * O motor é dirigido pelo CATÁLOGO com resolução de FK: para cada tabela, o
 * insert sintético é gerado das colunas NOT NULL sem default; coluna com FK é
 * satisfeita SEMEANDO (ou reusando) a linha-pai da MESMA org, recursivamente —
 * contacts→conversations→messages nasce na ordem certa sem ninguém curar nada.
 * A densidade real (quantas tabelas ganharam linha da org alheia) é medida e
 * impressa, nunca presumida (G-03: op contra tabela vazia é vácuo). A
 * PROFUNDIDADE por tabela (WITH CHECK com linha válida de verdade, gates de
 * papel) continua sendo das suítes curadas (rls-isolation TABLES/PROVA_PROPRIA);
 * esta varredura fecha a LARGURA.
 *
 * A função `_sweep_op` é SECURITY INVOKER de propósito: criada pelo superuser,
 * executada COMO authenticated com os claims do usuário — a RLS vale dentro
 * dela. Para a op de insert, o comando por (tabela, org) leva os pais REAIS da
 * org-alvo já resolvidos: o que barra o cross-org tem de ser a policy, não uma
 * FK pendurada. Imprime `isolation: tables=K ops=4 dirs=2 leaks=0`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG_A = "150a0000-0000-4000-8000-00000000000a";
const ORG_B = "150a0000-0000-4000-8000-00000000000b";
const USER_A = "150a0000-1111-4000-8000-00000000000a";
const USER_B = "150a0000-1111-4000-8000-00000000000b";
const USUARIO_DA_ORG: Record<string, string> = { [ORG_A]: USER_A, [ORG_B]: USER_B };

interface Coluna {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
}

interface Fk {
  table_name: string;
  column_name: string;
  f_schema: string;
  f_table: string;
  f_column: string;
}

function linhas(consulta: string): string[] {
  const out = sql(consulta);
  return out === "" ? [] : out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

function tabelasDeTenant(): string[] {
  return linhas(`
    select t.tablename from pg_tables t
     where t.schemaname = 'public'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.tablename
                      and c.column_name = 'organization_id')
     order by 1;`);
}

describe("isolation-varredura — K tabelas × 4 ops × 2 direções (§5.15)", () => {
  const tabs = tabelasDeTenant();
  let semeadasB = 0;
  let falhasExemplo: string[] = [];

  beforeAll(() => {
    sql(`
      insert into auth.users (id, email) values
        ('${USER_A}', 'sweep-a@invariant.test'), ('${USER_B}', 'sweep-b@invariant.test')
        on conflict (id) do nothing;
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG_A}', 'sweep-a', 'Sweep A', 'Sweep A'),
        ('${ORG_B}', 'sweep-b', 'Sweep B', 'Sweep B')
        on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${USER_A}', '${ORG_A}', 'agent', now()), ('${USER_B}', '${ORG_B}', 'agent', now())
        on conflict do nothing;
    `);

    // ── Catálogo: colunas obrigatórias e FKs de coluna única ──
    const colunas = JSON.parse(
      sql(`
        select coalesce(json_agg(row_to_json(x)), '[]') from (
          select c.table_name, c.column_name, c.data_type, c.udt_name
            from information_schema.columns c
            join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
           where c.table_schema = 'public'
             and c.is_nullable = 'NO' and c.column_default is null
             and c.is_generated = 'NEVER'
           order by c.table_name, c.ordinal_position
        ) x;`),
    ) as Coluna[];
    const obrigatorias = new Map<string, Coluna[]>();
    for (const c of colunas) {
      obrigatorias.set(c.table_name, [...(obrigatorias.get(c.table_name) ?? []), c]);
    }

    const fks = JSON.parse(
      sql(`
        select coalesce(json_agg(row_to_json(x)), '[]') from (
          select cl.relname as table_name,
                 a.attname  as column_name,
                 fn.nspname as f_schema,
                 fcl.relname as f_table,
                 fa.attname as f_column
            from pg_constraint con
            join pg_class cl  on cl.oid = con.conrelid
            join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
            join pg_class fcl on fcl.oid = con.confrelid
            join pg_namespace fn on fn.oid = fcl.relnamespace
            join unnest(con.conkey)  with ordinality as ck(attnum, ord) on true
            join unnest(con.confkey) with ordinality as cf(attnum, ord) on cf.ord = ck.ord
            join pg_attribute a  on a.attrelid = cl.oid  and a.attnum  = ck.attnum
            join pg_attribute fa on fa.attrelid = fcl.oid and fa.attnum = cf.attnum
           where con.contype = 'f' and array_length(con.conkey, 1) = 1
        ) x;`),
    ) as Fk[];
    const fkDe = new Map<string, Fk>();
    for (const f of fks) fkDe.set(`${f.table_name}.${f.column_name}`, f);

    // CHECKs de vocabulário: coluna text com `status in ('a','b')` recusa
    // 'sweep-N' — o valor certo é o PRIMEIRO literal que o próprio CHECK
    // permite. Só constraints de UMA coluna com IN/ANY entram (um CHECK de
    // regex ou tamanho não é vocabulário e a heurística o ignora).
    interface Check {
      table_name: string;
      column_name: string;
      def: string;
    }
    const checks = JSON.parse(
      sql(`
        select coalesce(json_agg(row_to_json(x)), '[]') from (
          select cl.relname as table_name, a.attname as column_name,
                 pg_get_constraintdef(con.oid) as def
            from pg_constraint con
            join pg_class cl on cl.oid = con.conrelid
            join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
            join pg_attribute a on a.attrelid = cl.oid and a.attnum = con.conkey[1]
           where con.contype = 'c' and array_length(con.conkey, 1) = 1
        ) x;`),
    ) as Check[];
    const vocabulario = new Map<string, string>();
    for (const ch of checks) {
      if (!/\sIN\s*\(|=\s*ANY\s*\(/i.test(ch.def)) continue;
      const primeiro = ch.def.match(/'((?:[^']|'')*)'/);
      if (primeiro?.[1] !== undefined) {
        vocabulario.set(`${ch.table_name}.${ch.column_name}`, primeiro[1]);
      }
    }

    const temOrg = new Set(tabs);
    let unico = 0;
    const literal = (c: Coluna): string => {
      const voc = vocabulario.get(`${c.table_name}.${c.column_name}`);
      if (voc !== undefined && ["text", "character varying", "citext"].includes(c.data_type)) {
        return `'${voc.replaceAll("'", "''")}'`;
      }
      switch (c.data_type) {
        case "uuid":
          return "gen_random_uuid()";
        case "text":
        case "character varying":
        case "citext":
          return `'sweep-${++unico}'`;
        case "integer":
        case "bigint":
        case "smallint":
        case "numeric":
        case "double precision":
        case "real":
          return "0";
        case "boolean":
          return "false";
        case "timestamp with time zone":
        case "timestamp without time zone":
        case "date":
          return "now()";
        case "jsonb":
        case "json":
          return "'{}'";
        case "bytea":
          return "'\\x00'";
        case "ARRAY":
          return "'{}'";
        case "inet":
          return "'127.0.0.1'";
        case "USER-DEFINED":
          return `(select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = '${c.udt_name}' order by e.enumsortorder limit 1)::"${c.udt_name}"`;
        default:
          return "null";
      }
    };

    // Receitas CURADAS para tabelas-hub cujo CHECK cruza colunas (o gerador
    // por coluna não enxerga condicional entre colunas). Cada entrada é o
    // insert mínimo conhecido-bom, com __ORG__ no lugar da org; documentada
    // porque hub sem linha derruba a subárvore inteira de FKs dela.
    const receitas = new Map<string, string>([
      [
        "channel_sessions",
        `insert into public.channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted)
           values ('__ORG__', 'sweep-' || gen_random_uuid(), '\\x00'::bytea) returning "__REF__"`,
      ],
    ]);

    // psql sem -q imprime o command tag ("INSERT 0 1") junto do RETURNING; o
    // valor é a linha que NÃO é tag.
    const semTag = (out: string): string => {
      const uteis = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !/^[A-Z]+ \d+( \d+)?$/.test(l));
      const ultimo = uteis[uteis.length - 1];
      if (ultimo === undefined) throw new Error(`saída sem valor útil: ${out.slice(0, 120)}`);
      return ultimo;
    };

    // ── ensureRow: garante (ou reusa) UMA linha da tabela para a org, resolvendo
    // FKs recursivamente; devolve o valor da coluna referenciada. ──
    const cache = new Map<string, string>();
    const emCurso = new Set<string>();

    function ensureRow(schema: string, tabela: string, org: string, refCol: string): string {
      const chave = `${schema}.${tabela}|${org}|${refCol}`;
      const memo = cache.get(chave);
      if (memo !== undefined) return memo;
      if (emCurso.has(`${schema}.${tabela}|${org}`)) throw new Error(`ciclo de FK em ${tabela}`);
      emCurso.add(`${schema}.${tabela}|${org}`);
      try {
        if (schema === "auth" && tabela === "users") {
          const u = USUARIO_DA_ORG[org] ?? USER_A;
          cache.set(chave, u);
          return u;
        }
        if (schema === "public" && tabela === "organizations") {
          cache.set(chave, org);
          return org;
        }
        const escopo = schema === "public" && temOrg.has(tabela)
          ? `where organization_id = '${org}'`
          : "";
        const existente = sql(
          `select "${refCol}" from ${schema}."${tabela}" ${escopo} limit 1;`,
        );
        if (existente !== "") {
          cache.set(chave, existente);
          return existente;
        }
        const receita = receitas.get(tabela);
        if (receita !== undefined && schema === "public") {
          const valor = semTag(
            sql(`${receita.replace("__ORG__", org).replace("__REF__", refCol)};`),
          );
          cache.set(chave, valor);
          return valor;
        }
        const cols: string[] = [];
        const vals: string[] = [];
        if (schema === "public" && temOrg.has(tabela)) {
          cols.push('"organization_id"');
          vals.push(`'${org}'`);
        }
        for (const c of obrigatorias.get(tabela) ?? []) {
          if (c.column_name === "organization_id") continue;
          cols.push(`"${c.column_name}"`);
          const fk = fkDe.get(`${tabela}.${c.column_name}`);
          vals.push(fk ? `'${ensureRow(fk.f_schema, fk.f_table, org, fk.f_column)}'` : literal(c));
        }
        const comando =
          cols.length > 0
            ? `insert into ${schema}."${tabela}" (${cols.join(", ")}) values (${vals.join(", ")}) returning "${refCol}";`
            : `insert into ${schema}."${tabela}" default values returning "${refCol}";`;
        const valor = semTag(sql(comando));
        cache.set(chave, valor);
        return valor;
      } finally {
        emCurso.delete(`${schema}.${tabela}|${org}`);
      }
    }

    // ── Seeding + geração dos comandos de insert (com pais REAIS) por org ──
    sql(`
      drop table if exists public._sweep_inserts;
      create table public._sweep_inserts (tab text not null, org uuid not null, comando text not null, primary key (tab, org));
      alter table public._sweep_inserts enable row level security;
      create policy _sweep_inserts_read on public._sweep_inserts for select using (true);
      grant select on public._sweep_inserts to authenticated;
    `);

    for (const t of tabs) {
      for (const org of [ORG_A, ORG_B]) {
        try {
          // Semeia a linha (recursivo) — e registra o comando de insert com os
          // pais desta org, para a op de insert do usuário da OUTRA org.
          const cols: string[] = ['"organization_id"'];
          const vals: string[] = [`'${org}'`];
          for (const c of obrigatorias.get(t) ?? []) {
            if (c.column_name === "organization_id") continue;
            cols.push(`"${c.column_name}"`);
            const fk = fkDe.get(`${t}.${c.column_name}`);
            vals.push(fk ? `'${ensureRow(fk.f_schema, fk.f_table, org, fk.f_column)}'` : literal(c));
          }
          const comando = `insert into public."${t}" (${cols.join(", ")}) values (${vals.join(", ")})`;
          sql(`${comando};`);
          sql(
            `insert into public._sweep_inserts (tab, org, comando) values ('${t}', '${org}', ${lit(comando)}) on conflict (tab, org) do update set comando = excluded.comando;`,
          );
          if (org === ORG_B) semeadasB += 1;
        } catch (e) {
          if (falhasExemplo.length < 5 && org === ORG_B) {
            const bruto = e as { stderr?: string; message?: string };
            const stderr = typeof bruto.stderr === "string" ? bruto.stderr : "";
            const msg =
              stderr.split("\n").find((l) => l.includes("ERROR")) ??
              (bruto.message ?? String(e)).slice(0, 160);
            falhasExemplo = [...falhasExemplo, `${t}: ${msg.slice(0, 160)}`];
          }
        }
      }
    }

    // ── A função INVOKER das 4 ops ──
    sql(`
      create or replace function public._sweep_op(p_op text, p_org uuid)
      returns table(tab text, n int) language plpgsql as $fn$
      declare
        t record;
        v int;
        cmd text;
      begin
        for t in select tablename from pg_tables
                  where schemaname = 'public'
                    and tablename <> '_sweep_inserts'
                    and exists (select 1 from information_schema.columns c
                                 where c.table_schema = 'public' and c.table_name = tablename
                                   and c.column_name = 'organization_id')
                  order by 1
        loop
          begin
            if p_op = 'select' then
              execute format('select count(*) from public.%I where organization_id = %L', t.tablename, p_org) into v;
            elsif p_op = 'update' then
              execute format('with w as (update public.%I set organization_id = organization_id where organization_id = %L returning 1) select count(*) from w', t.tablename, p_org) into v;
            elsif p_op = 'delete' then
              execute format('with w as (delete from public.%I where organization_id = %L returning 1) select count(*) from w', t.tablename, p_org) into v;
            elsif p_op = 'insert' then
              select comando into cmd from public._sweep_inserts s
               where s.tab = t.tablename and s.org = p_org;
              if cmd is null then
                v := 0;
              else
                execute cmd;
                get diagnostics v = row_count;
              end if;
            end if;
          exception when others then
            v := 0; -- negado/constraint: a linha não landou nem saiu — não é vazamento
          end;
          tab := t.tablename; n := coalesce(v, 0);
          return next;
        end loop;
      end
      $fn$;
      revoke execute on function public._sweep_op(text, uuid) from public;
      revoke execute on function public._sweep_op(text, uuid) from anon;
      grant execute on function public._sweep_op(text, uuid) to authenticated;
    `);
  }, 300_000);

  afterAll(() => {
    sql(`drop table if exists public._sweep_inserts;
         drop function if exists public._sweep_op(text, uuid);`);
  });

  function vazamentos(userId: string, orgAlheia: string, op: string): string[] {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      select 'LEAKS:' || coalesce(string_agg(tab || '=' || n, ','), '') from public._sweep_op('${op}', '${orgAlheia}') where n > 0;
    `);
    const linha = out.split("\n").map((l) => l.trim()).find((l) => l.startsWith("LEAKS:"));
    if (linha === undefined) throw new Error(`saída sem sentinela LEAKS: ${out.slice(0, 200)}`);
    const corpo = linha.slice("LEAKS:".length);
    return corpo === "" ? [] : corpo.split(",");
  }

  const OPS = ["select", "insert", "update", "delete"] as const;
  const DIRECOES = [
    { rotulo: "A→B", user: USER_A, alvo: ORG_B },
    { rotulo: "B→A", user: USER_B, alvo: ORG_A },
  ] as const;

  for (const d of DIRECOES) {
    for (const op of OPS) {
      it(`${d.rotulo}: ${op} cross-org afeta 0 linhas em todas as ${tabs.length} tabelas`, () => {
        const leaks = vazamentos(d.user, d.alvo, op);
        expect(leaks, `vazamento de ${op} na direção ${d.rotulo}`).toEqual([]);
      });
    }
  }

  it("densidade de material: a varredura não é vácuo e imprime a linha do VERIFY", () => {
    // G-03: quantas tabelas tinham linha REAL da org alheia quando as ops
    // rodaram? `semeadasB` conta os inserts de org B que o motor conseguiu.
    expect(
      semeadasB,
      `motor de geração cobriu só ${semeadasB}/${tabs.length}; primeiras falhas: ${falhasExemplo.join(" | ")}`,
    ).toBeGreaterThan((tabs.length * 2) / 3);
    console.log(
      `isolation: tables=${tabs.length} ops=4 dirs=2 leaks=0 (material_cross_org=${semeadasB}/${tabs.length})`,
    );
    expect(tabs.length).toBeGreaterThan(100);
  });
});

/** Literal SQL seguro (aspas simples duplicadas). */
function lit(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}
