/**
 * F06-T03 — LGPD mínima: exportar e apagar os dados de UM cliente (§5.18, §7.7).
 *
 * "Os dados do cliente" não é uma lista escrita à mão: é tudo o que o banco
 * liga ao contato por chave estrangeira, seguido em largura a partir de
 * `contacts` — mensagens pela conversa, itens pelo pedido, eventos pelo caso.
 * O grafo é lido de `pg_constraint` NA HORA (G-26): tabela nova que aponte para
 * qualquer tabela já alcançada entra sozinha, sem ninguém lembrar de editar
 * este arquivo. `tables=T` é o número de tabelas onde o cliente de fato tinha
 * linhas; `rows=N` é a soma delas.
 *
 * Apagar segue a MESMA travessia, ao contrário: filhos antes dos pais, dentro
 * de uma transação do tenant, sempre com `organization_id` explícito onde a
 * coluna existe (D06). Uma FK de fora do grafo que impeça a exclusão derruba a
 * transação inteira — nada fica pela metade. A auditoria (`audit_events`) não
 * tem FK para o contato e por isso SOBREVIVE: é ela que prova que a exclusão
 * aconteceu, e é o que `audit_rows=2` conta.
 *
 * Só chave estrangeira cuja coluna-pai é `id` é seguida. É o desenho deste
 * schema (`contacts_org_id_unique` e as FKs compostas da F02 mapeiam para
 * `(organization_id, id)`), e o que vale é a coluna que aponta para o `id`.
 */
import type { TenantDb } from "@/src/tenant-context";

export interface ArestaDeFk {
  readonly child: string;
  readonly childColumn: string;
  readonly parent: string;
}

interface TabelaAlcancada {
  readonly table: string;
  readonly hasId: boolean;
  readonly hasOrganizationId: boolean;
  /** Linhas do cliente nesta tabela (deduplicadas por `id` quando existe). */
  readonly rows: Array<Record<string, unknown>>;
  /** ids das linhas — o que os filhos usam para se achar. */
  readonly ids: Set<string>;
}

export interface GrafoDoCliente {
  /** Na ordem em que foram alcançadas: `contacts` primeiro. */
  readonly ordem: TabelaAlcancada[];
  readonly arestas: ArestaDeFk[];
}

export interface ExportacaoDoCliente {
  readonly contact_id: string;
  readonly tables: number;
  readonly rows: number;
  readonly data: Record<string, Array<Record<string, unknown>>>;
}

export interface ExclusaoDoCliente {
  readonly contact_id: string;
  readonly tables: number;
  readonly rows_deleted: number;
  readonly rows_remaining: number;
  /** Por tabela: linhas encontradas antes e apagadas pelo comando (cascata do banco não conta aqui). */
  readonly per_table: Record<string, { found: number; deleted: number }>;
}

const PROFUNDIDADE_MAXIMA = 8;
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(nome: string): string {
  if (!IDENT.test(nome)) throw new Error(`identificador fora do contrato: ${nome}`);
  return `"${nome}"`;
}

/** Arestas (filho.coluna → pai.id) do schema `public`, lidas do catálogo. */
export async function arestasDeFk(db: TenantDb): Promise<ArestaDeFk[]> {
  const r = await db.query<{ child: string; child_column: string; parent: string }>(
    `select c.conrelid::regclass::text as child,
            a.attname as child_column,
            c.confrelid::regclass::text as parent
       from pg_constraint c
       join lateral unnest(c.conkey, c.confkey) as k(col, refcol) on true
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.col
       join pg_attribute p on p.attrelid = c.confrelid and p.attnum = k.refcol
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and p.attname = 'id'
      order by 1, 2, 3`,
  );
  return r.rows.map((l) => ({
    child: l.child.replace(/^public\./, "").replace(/"/g, ""),
    childColumn: l.child_column,
    parent: l.parent.replace(/^public\./, "").replace(/"/g, ""),
  }));
}

async function colunasDe(db: TenantDb, tabelas: Iterable<string>): Promise<Map<string, Set<string>>> {
  const lista = [...new Set(tabelas)];
  const r = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])`,
    [lista],
  );
  const mapa = new Map<string, Set<string>>();
  for (const l of r.rows) {
    if (!mapa.has(l.table_name)) mapa.set(l.table_name, new Set());
    mapa.get(l.table_name)!.add(l.column_name);
  }
  return mapa;
}

/**
 * Travessia em largura a partir do contato, lendo as linhas de cada tabela
 * alcançada. Devolve só as tabelas onde havia linha.
 */
export async function grafoDoCliente(
  db: TenantDb,
  organizationId: string,
  contactId: string,
): Promise<GrafoDoCliente> {
  const arestas = await arestasDeFk(db);
  const colunas = await colunasDe(db, ["contacts", ...arestas.map((a) => a.child)]);
  const alcancadas = new Map<string, TabelaAlcancada>();
  const ordem: TabelaAlcancada[] = [];

  const registrar = (table: string, rows: Array<Record<string, unknown>>): string[] => {
    const cols = colunas.get(table) ?? new Set<string>();
    let entrada = alcancadas.get(table);
    if (!entrada) {
      entrada = { table, hasId: cols.has("id"), hasOrganizationId: cols.has("organization_id"), rows: [], ids: new Set() };
      alcancadas.set(table, entrada);
      ordem.push(entrada);
    }
    const novos: string[] = [];
    for (const row of rows) {
      const id = entrada.hasId ? String(row["id"]) : null;
      if (id !== null) {
        if (entrada.ids.has(id)) continue;
        entrada.ids.add(id);
        novos.push(id);
      }
      entrada.rows.push(row);
    }
    return novos;
  };

  const contato = await db.query<Record<string, unknown>>(
    `select * from public.contacts where id = $1 and organization_id = $2`,
    [contactId, organizationId],
  );
  registrar("contacts", contato.rows);

  // fila: (tabela-pai, ids novos dela, profundidade)
  const fila: Array<{ parent: string; ids: string[]; nivel: number }> = [
    { parent: "contacts", ids: [contactId], nivel: 0 },
  ];
  while (fila.length > 0) {
    const { parent, ids, nivel } = fila.shift()!;
    if (nivel >= PROFUNDIDADE_MAXIMA || ids.length === 0) continue;
    for (const aresta of arestas.filter((a) => a.parent === parent && a.child !== a.parent)) {
      const cols = colunas.get(aresta.child) ?? new Set<string>();
      const filtroOrg = cols.has("organization_id") ? ` and ${ident("organization_id")} = $2` : "";
      const linhas = await db.query<Record<string, unknown>>(
        `select * from ${ident(aresta.child)} where ${ident(aresta.childColumn)} = any($1::uuid[])${filtroOrg}`,
        cols.has("organization_id") ? [ids, organizationId] : [ids],
      );
      if (linhas.rows.length === 0) continue;
      const novos = registrar(aresta.child, linhas.rows);
      if (novos.length > 0) fila.push({ parent: aresta.child, ids: novos, nivel: nivel + 1 });
    }
  }
  return { ordem: ordem.filter((t) => t.rows.length > 0), arestas };
}

/** Só leitura: o dossiê inteiro do cliente, tabela por tabela. */
export async function exportarCliente(
  db: TenantDb,
  organizationId: string,
  contactId: string,
): Promise<ExportacaoDoCliente> {
  const grafo = await grafoDoCliente(db, organizationId, contactId);
  const data: Record<string, Array<Record<string, unknown>>> = {};
  let rows = 0;
  for (const t of grafo.ordem) {
    data[t.table] = t.rows;
    rows += t.rows.length;
  }
  return { contact_id: contactId, tables: grafo.ordem.length, rows, data };
}

/**
 * Ordem topológica de exclusão: uma tabela só sai quando nenhuma OUTRA tabela
 * alcançada ainda a referencia (Kahn sobre o subgrafo induzido; auto-FK não
 * conta). A ordem inversa da descoberta não basta — `crm_notes` é filha de
 * `contacts` E de `crm_orders`, e a descoberta as alcança na mesma rodada.
 * Ciclo entre tabelas alcançadas (não há neste schema) cai no resto em ordem
 * inversa, e a FK que sobrar derruba a transação — nunca fica pela metade.
 */
export function ordemDeExclusao(grafo: GrafoDoCliente): TabelaAlcancada[] {
  const restantes = new Map(grafo.ordem.map((t) => [t.table, t]));
  const saida: TabelaAlcancada[] = [];
  while (restantes.size > 0) {
    const livres = [...restantes.values()].filter(
      (t) => !grafo.arestas.some((a) => a.parent === t.table && a.child !== t.table && restantes.has(a.child)),
    );
    if (livres.length === 0) {
      saida.push(...[...restantes.values()].reverse());
      break;
    }
    for (const t of livres) {
      saida.push(t);
      restantes.delete(t.table);
    }
  }
  return saida;
}

/**
 * Apaga na ordem topológica (filhos primeiro) e reconta ao fim:
 * `rows_remaining` é lido do banco depois da exclusão, não deduzido.
 */
export async function apagarCliente(
  db: TenantDb,
  organizationId: string,
  contactId: string,
): Promise<ExclusaoDoCliente> {
  const grafo = await grafoDoCliente(db, organizationId, contactId);
  let apagadas = 0;
  const perTable: Record<string, { found: number; deleted: number }> = {};
  for (const t of ordemDeExclusao(grafo)) {
    perTable[t.table] = { found: t.rows.length, deleted: 0 };
    const filtroOrg = t.hasOrganizationId ? ` and ${ident("organization_id")} = $2` : "";
    const params = t.hasOrganizationId ? [[...t.ids], organizationId] : [[...t.ids]];
    if (t.hasId) {
      const r = await db.query(`delete from ${ident(t.table)} where id = any($1::uuid[])${filtroOrg}`, params);
      apagadas += r.rowCount ?? 0;
      perTable[t.table]!.deleted += r.rowCount ?? 0;
      continue;
    }
    // Sem `id`: apaga pelas colunas que a alcançaram, a partir dos ids dos pais.
    for (const aresta of grafo.arestas.filter((a) => a.child === t.table)) {
      const pai = grafo.ordem.find((p) => p.table === aresta.parent);
      if (!pai || pai.ids.size === 0) continue;
      const p2 = t.hasOrganizationId ? [[...pai.ids], organizationId] : [[...pai.ids]];
      const r = await db.query(
        `delete from ${ident(t.table)} where ${ident(aresta.childColumn)} = any($1::uuid[])${filtroOrg}`,
        p2,
      );
      apagadas += r.rowCount ?? 0;
      perTable[t.table]!.deleted += r.rowCount ?? 0;
    }
  }
  const depois = await grafoDoCliente(db, organizationId, contactId);
  const restantes = depois.ordem.reduce((soma, t) => soma + t.rows.length, 0);
  return { contact_id: contactId, tables: grafo.ordem.length, rows_deleted: apagadas, rows_remaining: restantes, per_table: perTable };
}
