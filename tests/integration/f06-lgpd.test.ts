/**
 * F06-T03 — LGPD mínima: exportar e apagar os dados de um cliente por ação
 * `high` do `tenant_admin`, com auditoria (§5.18, §7.7).
 *
 * A linha do gate: `lgpd: tables=T rows=N rows_remaining=0 audit_rows=2`.
 *
 * O cliente é semeado com linhas em VÁRIAS tabelas ligadas por FK (contato,
 * conversa, mensagens, pedido, item, nota, tarefa) e o grafo é descoberto do
 * catálogo em tempo de teste — o denominador `T` sai do banco, não deste
 * arquivo (G-26). O vizinho (outro contato do MESMO tenant) e o outro tenant
 * continuam intactos depois da exclusão: apagar um cliente é apagar UM.
 *
 * `audit_rows=2`: a linha `executed` de cada ação, em `audit_events`, com
 * `resource_id` = o contato — que sobrevive à exclusão por não ter FK.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execute } from "@/src/actions";
import { arestasDeFk, grafoDoCliente } from "@/src/lgpd";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import { semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });

const ORG_A = "f0600001-0000-4000-8000-00000000000a";
const ORG_B = "f0600001-0000-4000-8000-00000000000b";
const ADMIN_A = "f0600001-1001-4000-8000-00000000000a";
const AGENTE_A = "f0600001-1002-4000-8000-00000000000a";
const ADMIN_B = "f0600001-1001-4000-8000-00000000000b";
const CLIENTE = "f0600001-2001-4000-8000-00000000000a";
const VIZINHO = "f0600001-2002-4000-8000-00000000000a";
const CLIENTE_B = "f0600001-2001-4000-8000-00000000000b";
const CONVERSA = "f0600001-4001-4000-8000-00000000000a";
const CONVERSA_VIZINHO = "f0600001-4002-4000-8000-00000000000a";
const CONVERSA_B = "f0600001-4001-4000-8000-00000000000b";
const PEDIDO = "f0600001-5001-4000-8000-00000000000a";
const ITEM = "f0600001-5101-4000-8000-00000000000a";
const PRODUTO = "f0600001-6001-4000-8000-00000000000a";

const ctxA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A, role: "admin" };
const ctxB: TenantCtx = { organization_id: ORG_B, source: "session", user_id: ADMIN_B, role: "admin" };

function tenant(org: string, slug: string, usuario: string, contatos: Array<{ id: string; nome: string }>, conversas: Array<{ id: string; contato: string }>, extra: Partial<ConfigDeTenant> = {}): ConfigDeTenant {
  return {
    org,
    slug,
    usuario,
    sessao: org.replace("-0000-", "-7000-"),
    conta: `conta-${slug}`,
    contatos: contatos.map((c, i) => ({ id: c.id, nome: c.nome, telefone: `+55119000${slug === "lgpd-a" ? "1" : "2"}00${i}` })),
    conversas: conversas.map((c) => ({ id: c.id, contato: c.contato, estado: "human_handling", statusLegado: "open" })),
    produtos: [{ id: `${PRODUTO.slice(0, -1)}${org.slice(-1)}`, codigo: `CAFE-${slug}`, nome: "Café", preco_cents: 2500 }],
    materiais: [],
    settings: {},
    ...extra,
  };
}

let medidas = { tables: 0, rows: 0, rows_remaining: -1, audit_rows: 0 };

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, tenant(ORG_A, "lgpd-a", AGENTE_A, [{ id: CLIENTE, nome: "Cliente Um" }, { id: VIZINHO, nome: "Vizinho" }], [{ id: CONVERSA, contato: CLIENTE }, { id: CONVERSA_VIZINHO, contato: VIZINHO }], {
      pedidos: [{ id: PEDIDO, item: ITEM, contato: CLIENTE }],
      mensagens: [
        { conversa: CONVERSA, contato: CLIENTE, direcao: "inbound", via: "external_device", corpo: "quero 2kg" },
        { conversa: CONVERSA, contato: CLIENTE, direcao: "outbound", via: "user", corpo: "anotado" },
        { conversa: CONVERSA_VIZINHO, contato: VIZINHO, direcao: "inbound", via: "external_device", corpo: "oi" },
      ],
    }));
    // O admin do tenant A: é ele que exporta e apaga. O agente semeado não pode.
    await client.query(`insert into auth.users (id, email) values ($1, $2)`, [ADMIN_A, "admin-a@integration.test"]);
    await client.query(
      `insert into public.user_organizations (organization_id, user_id, role, accepted_at, revoked_at) values ($1,$2,'admin',now(),null)`,
      [ORG_A, ADMIN_A],
    );
    await client.query(
      `insert into public.crm_notes (id, organization_id, contact_id, order_id, body, actor_user_id)
       values ($1,$2,$3,$4,'prefere entrega de manhã',$5)`,
      ["f0600001-5201-4000-8000-00000000000a", ORG_A, CLIENTE, PEDIDO, AGENTE_A],
    );
    await client.query(
      `insert into public.crm_tasks (organization_id, title, contact_id, status, priority, created_by)
       values ($1,'ligar para confirmar',$2,'pending','medium',$3)`,
      [ORG_A, CLIENTE, AGENTE_A],
    );
    await semearTenant(client, tenant(ORG_B, "lgpd-b", ADMIN_B, [{ id: CLIENTE_B, nome: "Cliente B" }], [{ id: CONVERSA_B, contato: CLIENTE_B }], {
      mensagens: [{ conversa: CONVERSA_B, contato: CLIENTE_B, direcao: "inbound", via: "external_device", corpo: "olá" }],
    }));
    await client.query(`update public.user_organizations set role = 'admin' where organization_id = $1 and user_id = $2`, [ORG_B, ADMIN_B]);
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  gravarLinhaDoVerify(
    "lgpd",
    `lgpd: tables=${medidas.tables} rows=${medidas.rows} rows_remaining=${medidas.rows_remaining} audit_rows=${medidas.audit_rows}`,
  );
  await pool.end();
});

async function contarLinhasDoCliente(org: string, contato: string): Promise<{ tables: number; rows: number }> {
  const client = await pool.connect();
  try {
    const grafo = await grafoDoCliente(client, org, contato);
    return { tables: grafo.ordem.length, rows: grafo.ordem.reduce((s, t) => s + t.rows.length, 0) };
  } finally {
    client.release();
  }
}

describe("F06-T03 — exportar e apagar os dados de um cliente pelo catálogo", () => {
  it("o grafo de FKs é lido do catálogo e alcança as tabelas semeadas (contato, conversa, mensagens, pedido, item, nota, tarefa)", async () => {
    // Act
    const client = await pool.connect();
    let arestas;
    try {
      arestas = await arestasDeFk(client);
    } finally {
      client.release();
    }
    const antes = await contarLinhasDoCliente(ORG_A, CLIENTE);
    const grafo = await (async () => {
      const c = await pool.connect();
      try {
        return await grafoDoCliente(c, ORG_A, CLIENTE);
      } finally {
        c.release();
      }
    })();

    // Assert
    expect(arestas.length, "nenhuma FK lida do catálogo").toBeGreaterThan(50);
    const tabelas = grafo.ordem.map((t) => t.table);
    for (const esperada of ["contacts", "conversations", "messages", "crm_orders", "crm_order_items", "crm_notes", "crm_tasks"]) {
      expect(tabelas, `a tabela ${esperada} não foi alcançada`).toContain(esperada);
    }
    expect(antes.tables).toBeGreaterThanOrEqual(7);
    expect(antes.rows).toBeGreaterThanOrEqual(8);
  });

  it("export: tables=T rows=N, só do cliente pedido, e a auditoria grava executed", async () => {
    // Arrange
    const antes = await contarLinhasDoCliente(ORG_A, CLIENTE);

    // Act
    const resultado = await execute(ctxA, { kind: "human", user_id: ADMIN_A }, "export_customer_data", { contact_id: CLIENTE }, { pool, requestId: "f06-lgpd-export" });

    // Assert
    expect(resultado.status).toBe("executed");
    const saida = resultado.output as { tables: number; rows: number; data: Record<string, Array<Record<string, unknown>>> };
    expect(saida.tables).toBe(antes.tables);
    expect(saida.rows).toBe(antes.rows);
    const idsDeContato = new Set(Object.values(saida.data).flat().map((r) => r["contact_id"]).filter((v) => typeof v === "string"));
    expect([...idsDeContato], "o dossiê trouxe linha de outro contato").toEqual([CLIENTE]);
    const alheio = JSON.stringify(saida.data);
    expect(alheio.includes(VIZINHO) || alheio.includes(CLIENTE_B) || alheio.includes(ORG_B), "id alheio no dossiê").toBe(false);
    medidas = { ...medidas, tables: saida.tables, rows: saida.rows };
  });

  it("papel insuficiente de agent e executor ai são recusados e contados — nada é lido nem apagado", async () => {
    // Act
    const agente = await execute(ctxA, { kind: "human", user_id: AGENTE_A }, "delete_customer_data", { contact_id: CLIENTE }, { pool });
    const ia = await execute(ctxA, { kind: "ai" }, "delete_customer_data", { contact_id: CLIENTE }, { pool });
    const depois = await contarLinhasDoCliente(ORG_A, CLIENTE);

    // Assert
    expect(agente.status).toBe("denied");
    expect(agente.reason).toBe("domain_rejected");
    expect(agente.detalhe).toBe("role_insufficient:agent");
    expect(ia.status).toBe("denied");
    expect(ia.reason).toBe("executor_not_allowed");
    expect(depois.rows).toBe(medidas.rows);
  });

  it("delete: rows_remaining=0/T, vizinho e outro tenant intactos, audit_rows=2", async () => {
    // Arrange
    const vizinhoAntes = await contarLinhasDoCliente(ORG_A, VIZINHO);
    const bAntes = await contarLinhasDoCliente(ORG_B, CLIENTE_B);
    expect(vizinhoAntes.rows).toBeGreaterThan(0);
    expect(bAntes.rows).toBeGreaterThan(0);

    // Act
    const resultado = await execute(ctxA, { kind: "human", user_id: ADMIN_A }, "delete_customer_data", { contact_id: CLIENTE }, { pool, requestId: "f06-lgpd-delete" });

    // Assert
    expect(resultado.status).toBe("executed");
    const saida = resultado.output as { tables: number; rows_deleted: number; rows_remaining: number; per_table: Record<string, { found: number; deleted: number }> };
    expect(saida.tables).toBe(medidas.tables);
    expect(saida.rows_remaining).toBe(0);
    console.info(`f06-lgpd-delete: ${JSON.stringify(saida.per_table)}`);
    expect(saida.rows_deleted, "linhas apagadas pelo comando (o que o banco cascateou antes não conta)").toBeGreaterThan(0);
    const depois = await contarLinhasDoCliente(ORG_A, CLIENTE);
    expect(depois.rows, "sobrou linha do cliente").toBe(0);
    expect(await contarLinhasDoCliente(ORG_A, VIZINHO)).toEqual(vizinhoAntes);
    expect(await contarLinhasDoCliente(ORG_B, CLIENTE_B)).toEqual(bAntes);

    const auditoria = await pool.query<{ action_name: string; result: string; actor_id: string; risk: string }>(
      `select action_name, result, actor_id, risk from public.audit_events
        where organization_id = $1 and resource_type = 'contacts' and resource_id = $2 and result = 'executed'
        order by created_at`,
      [ORG_A, CLIENTE],
    );
    expect(auditoria.rows.map((r) => r.action_name)).toEqual(["export_customer_data", "delete_customer_data"]);
    expect(auditoria.rows.every((r) => r.actor_id === ADMIN_A && r.risk === "high")).toBe(true);
    medidas = { ...medidas, rows_remaining: saida.rows_remaining, audit_rows: auditoria.rows.length };
  });

  it("outro tenant não alcança o contato: contact_not_found, sem tocar em nada", async () => {
    // Act
    const resultado = await execute(ctxB, { kind: "human", user_id: ADMIN_B }, "delete_customer_data", { contact_id: VIZINHO }, { pool });

    // Assert
    expect(resultado.status).toBe("denied");
    expect(resultado.detalhe).toBe("contact_not_found");
    expect((await contarLinhasDoCliente(ORG_A, VIZINHO)).rows).toBeGreaterThan(0);
  });
});
