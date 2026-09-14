/**
 * F13 (ADR-034 §2/§3, ADR-035 §2) — a prova do CRM comercial contra o banco
 * descartável, e a linha `crm:` do VERIFY SUMMARY.
 *
 * Duas organizações (A é a medida; B é o "outro tenant" que tem de aparecer
 * como 0 no relatório de A e recusar o vínculo cruzado). Em A: um tenant_admin,
 * um manager, três attendants; B tem um attendant. Tudo pelo pool `pg` —
 * as rotas PostgREST (criação de lead, tarefas) ficam com a spec de navegador.
 *
 * ═══ O que cada bloco mede ═══════════════════════════════════════════════════
 * T01 campos: definições gravadas (F), valores recusados por tipo/obrigatório/
 *     opção (R/R), valores preservados depois de apagar a definição (V/V).
 * T02 papéis: as três permissões novas negadas ao attendant (D/D), pela MESMA
 *     matriz que o gate das rotas usa.
 * T03 fila: Q oportunidades sem dono distribuídas por rodízio entre 3 pessoas
 *     (Q/Q, balanced=1), modo manual não toca a fila, segundo claim → 409.
 * T04 histórico: os tipos que o módulo grava (H ≥ 3), 1 vínculo com pedido da
 *     mesma organização, 1 vínculo cruzado recusado.
 * T05 relatório: cada indicador de `fn_crm_report` recalculado por SQL
 *     independente (K/K), inclusive B = 0.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { definicoesDa, gravarDefinicoes, InvalidSettingError, validarCamposDa } from "@/src/crm/campos";
import { distribuir, DistribuicaoManual, fila, JaAtribuida, PedidoDeOutraOrganizacao, reivindicar, vincularPedido } from "@/src/crm/oportunidades";
import { executeOrderCommand } from "@/src/crm/orders/service";
import { INDICADORES, relatorioComercial } from "@/src/crm/relatorio";
import { can, MATRIZ, PAPEIS_D15, papelD15DoHerdado, type Permissao } from "@/src/rbac/matrix";
import { setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });
const deps = { pool };

const ORG_A = "f1300003-0000-4000-8000-00000000000a";
const ORG_B = "f1300003-0000-4000-8000-00000000000b";
const ADMIN_A = "f1300003-1001-4000-8000-00000000000a";
const MANAGER_A = "f1300003-1002-4000-8000-00000000000a";
const ATT_A1 = "f1300003-1003-4000-8000-00000000000a";
const ATT_A2 = "f1300003-1004-4000-8000-00000000000a";
const ATT_A3 = "f1300003-1005-4000-8000-00000000000a";
const ATT_B = "f1300003-1003-4000-8000-00000000000b";
const CONTACT_A = "f1300003-2000-4000-8000-00000000000a";
const CONTACT_B = "f1300003-2000-4000-8000-00000000000b";
const COMPANY_A = "f1300003-3000-4000-8000-00000000000a";
const PRODUCT_A = "f1300003-4000-4000-8000-00000000000a";
const PRODUCT_B = "f1300003-4000-4000-8000-00000000000b";

const ctxAdmin: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
const ctxManager: TenantCtx = { organization_id: ORG_A, source: "session", user_id: MANAGER_A };
const ctxAtt1: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ATT_A1 };
const ctxAtt2: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ATT_A2 };
const ctxB: TenantCtx = { organization_id: ORG_B, source: "session", user_id: ATT_B };

const T0 = new Date("2026-09-14T12:00:00.000Z");
const PERIODO = { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-10-01T00:00:00.000Z") };

const medidas = {
  fields_defined: 0,
  values_rejected: 0,
  values_rejected_total: 0,
  values_preserved: 0,
  values_preserved_total: 0,
  queue_size: 0,
  distributed: 0,
  balanced: 0,
  second_claim_rejected: 0,
  history_types: 0,
  orders_linked: 0,
  cross_org_link_denied: 0,
  report_indicators: 0,
  report_indicators_total: 0,
  roles_denied: 0,
  roles_denied_total: 0,
};

let pipelineA = "";
let etapaA = "";
let pipelineB = "";
let etapaB = "";
const oportunidades: string[] = [];
let oportunidadeDoClaim = "";
let pedidoA = "";
let pedidoB = "";

async function conta(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function novaOportunidade(org: string, pipeline: string, etapa: string, titulo: string, valor: number | null, minutosAtras: number, dono: string | null = null): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, value_cents, owner_user_id, owner_kind, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [id, org, pipeline, etapa, org === ORG_A ? CONTACT_A : CONTACT_B, titulo, valor, dono, dono ? "user" : null, new Date(T0.getTime() - minutosAtras * 60_000).toISOString()],
  );
  return id;
}

beforeAll(async () => {
  await pool.query(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}','f13-admin-a@integration.test'),
      ('${MANAGER_A}','f13-manager-a@integration.test'),
      ('${ATT_A1}','f13-att-a1@integration.test'),
      ('${ATT_A2}','f13-att-a2@integration.test'),
      ('${ATT_A3}','f13-att-a3@integration.test'),
      ('${ATT_B}','f13-att-b@integration.test');
    insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values
      ('${ORG_A}','f13-crm-a','F13 CRM A','F13 A', now()),
      ('${ORG_B}','f13-crm-b','F13 CRM B','F13 B', now());
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_A}','${ADMIN_A}','admin',now()),
      ('${ORG_A}','${MANAGER_A}','manager',now()),
      ('${ORG_A}','${ATT_A1}','agent',now()),
      ('${ORG_A}','${ATT_A2}','agent',now()),
      ('${ORG_A}','${ATT_A3}','agent',now()),
      ('${ORG_B}','${ATT_B}','agent',now());
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTACT_A}','${ORG_A}','Contato A'), ('${CONTACT_B}','${ORG_B}','Contato B');
    insert into public.crm_companies (id, organization_id, legal_name) values ('${COMPANY_A}','${ORG_A}','Empresa A');
    insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents, sale_unit) values
      ('${PRODUCT_A}','${ORG_A}','F13-A','Produto A',1250,'un'), ('${PRODUCT_B}','${ORG_B}','F13-B','Produto B',2500,'un');
  `);
  // O funil padrão nasce pelo gatilho (fn_seed_default_pipeline_for_org); a etapa é a primeira.
  const funil = async (org: string) => {
    const p = await pool.query<{ id: string }>(`select id from crm_pipelines where organization_id=$1 and is_default order by position limit 1`, [org]);
    const s = await pool.query<{ id: string }>(`select id from crm_stages where organization_id=$1 and pipeline_id=$2 and not is_won and not is_lost order by position limit 1`, [org, p.rows[0]!.id]);
    return { pipeline: p.rows[0]!.id, etapa: s.rows[0]!.id };
  };
  ({ pipeline: pipelineA, etapa: etapaA } = await funil(ORG_A));
  ({ pipeline: pipelineB, etapa: etapaB } = await funil(ORG_B));
});

afterAll(async () => {
  await pool.end();
});

describe("F13-T01 — campos configuráveis por organização", () => {
  const DEFS = [
    { key: "segmento", label: "Segmento", type: "select", required: true, options: [{ value: "varejo", label: "Varejo" }, { value: "atacado", label: "Atacado" }] },
    { key: "limite_credito", label: "Limite de crédito", type: "number" },
    { key: "aniversario", label: "Aniversário", type: "date" },
    { key: "vip", label: "VIP", type: "boolean" },
  ];
  const VALORES = { segmento: "varejo", limite_credito: 5000, aniversario: "2026-09-14", vip: true };
  let empresa = "";

  it("grava as definições (companies + contacts) e conta fields_defined", async () => {
    await gravarDefinicoes(ctxManager, "companies", DEFS, "tenant_admin", deps);
    await gravarDefinicoes(ctxManager, "contacts", [{ key: "origem", label: "Origem", type: "text" }, { key: "nps", label: "NPS", type: "number" }], "tenant_admin", deps);
    const companies = await definicoesDa(ctxManager, "companies", deps);
    const contacts = await definicoesDa(ctxManager, "contacts", deps);
    medidas.fields_defined = companies.length + contacts.length;
    expect(medidas.fields_defined).toBe(6);
    // A definição é validada pela Setting: lista com chave repetida é recusada.
    await expect(gravarDefinicoes(ctxManager, "companies", [...DEFS, DEFS[1]], "tenant_admin", deps)).rejects.toBeInstanceOf(InvalidSettingError);
    // O outro tenant não enxerga nada disso.
    expect(await definicoesDa(ctxB, "companies", deps)).toEqual([]);
  });

  it("recusa valor por tipo, obrigatório e opção (values_rejected=3/3) e aceita o válido", async () => {
    const casos = [
      { limite_credito: "dez", segmento: "varejo" },
      { limite_credito: 10 },
      { segmento: "outro" },
    ];
    medidas.values_rejected_total = casos.length;
    for (const valores of casos) {
      const r = await validarCamposDa(ctxManager, "companies", valores, deps);
      if (!r.ok) medidas.values_rejected += 1;
    }
    expect(medidas.values_rejected).toBe(3);
    const ok = await validarCamposDa(ctxManager, "companies", VALORES, deps);
    expect(ok).toEqual({ ok: true, valores: VALORES });
    const r = await pool.query<{ id: string }>(`insert into crm_companies (organization_id, legal_name, custom_fields) values ($1,'Empresa com campos',$2) returning id`, [ORG_A, JSON.stringify(VALORES)]);
    empresa = r.rows[0]!.id;
  });

  it("apagar a definição não apaga o valor gravado (values_preserved=V/V) e o PATCH continua aceito", async () => {
    medidas.values_preserved_total = Object.keys(VALORES).length;
    await gravarDefinicoes(ctxManager, "companies", [DEFS[1]], "tenant_admin", deps);
    const linha = await pool.query<{ custom_fields: Record<string, unknown> }>(`select custom_fields from crm_companies where id=$1`, [empresa]);
    const gravado = linha.rows[0]!.custom_fields;
    medidas.values_preserved = Object.keys(VALORES).filter((k) => JSON.stringify(gravado[k]) === JSON.stringify(VALORES[k as keyof typeof VALORES])).length;
    expect(medidas.values_preserved).toBe(medidas.values_preserved_total);
    // Reenviar o objeto inteiro (o que o PATCH faz) passa: chave sem definição é preservada.
    const r = await validarCamposDa(ctxManager, "companies", gravado, deps);
    expect(r).toEqual({ ok: true, valores: gravado });
    await gravarDefinicoes(ctxManager, "companies", DEFS, "tenant_admin", deps);
  });
});

describe("F13-T02 — papéis: as permissões comerciais negadas ao attendant, pela matriz", () => {
  it("roles=4 e roles_denied=D/D nas três permissões das rotas novas", () => {
    expect(PAPEIS_D15).toHaveLength(4);
    const permissoes: Permissao[] = ["fields.manage", "opportunities.assign", "reports.read"];
    medidas.roles_denied_total = permissoes.length;
    const attendant = papelD15DoHerdado("agent", false);
    const manager = papelD15DoHerdado("manager", false);
    expect(manager).toBe("manager");
    for (const p of permissoes) {
      if (!can(attendant, p)) medidas.roles_denied += 1;
      expect(can(manager, p), `${p} × manager`).toBe(true);
      expect(MATRIZ[p].platform_admin, `${p} × platform_admin`).toBe(false);
    }
    expect(medidas.roles_denied).toBe(3);
  });
});

describe("F13-T03 — fila de oportunidades por rodízio", () => {
  it("modo manual (default) não distribui e não toca a fila", async () => {
    for (let i = 0; i < 5; i++) oportunidades.push(await novaOportunidade(ORG_A, pipelineA, etapaA, `Oportunidade ${i + 1}`, (i + 1) * 10_000, 60 - i));
    await novaOportunidade(ORG_B, pipelineB, etapaB, "Oportunidade de B", 999, 10);
    const antes = await fila(ctxManager, undefined, deps);
    expect(antes.map((o) => o.id)).toEqual(oportunidades);
    await expect(distribuir(ctxManager, undefined, deps)).rejects.toBeInstanceOf(DistribuicaoManual);
    expect((await fila(ctxManager, undefined, deps)).length).toBe(5);
    expect(await conta(`select count(*)::text as n from crm_lead_activities where organization_id=$1 and type='owner_assigned'`, [ORG_A])).toBe(0);
  });

  it("round_robin: Q/Q distribuídas entre os 3 attendants, balanced=1, Q linhas owner_assigned, B intacta", async () => {
    await setSetting(ctxAdmin, "crm.distribution", "round_robin", "tenant_admin", deps);
    const r = await distribuir(ctxManager, undefined, { ...deps, agora: () => T0 });
    medidas.queue_size = r.queue_size;
    medidas.distributed = r.assignments.length;
    medidas.balanced = r.balanced ? 1 : 0;
    expect(r.queue_size).toBe(5);
    expect(r.eligible).toBe(3);
    expect(r.assignments).toHaveLength(5);
    const porDono = await pool.query<{ owner_user_id: string; n: string }>(`select owner_user_id, count(*)::text as n from crm_leads where organization_id=$1 and status='open' and owner_user_id is not null group by owner_user_id order by 2 desc`, [ORG_A]);
    const contagens = porDono.rows.map((x) => Number(x.n));
    expect(contagens.sort((a, b) => b - a)).toEqual([2, 2, 1]);
    expect(Math.max(...contagens) - Math.min(...contagens)).toBeLessThanOrEqual(1);
    // O manager e o admin não entram no rodízio (crm.queue_roles = attendant).
    expect(porDono.rows.map((x) => x.owner_user_id).sort()).toEqual([ATT_A1, ATT_A2, ATT_A3].sort());
    expect((await fila(ctxManager, undefined, deps)).length).toBe(0);
    expect(await conta(`select count(*)::text as n from crm_lead_activities where organization_id=$1 and type='owner_assigned'`, [ORG_A])).toBe(5);
    expect(await conta(`select count(*)::text as n from crm_leads where organization_id=$1 and owner_user_id is null and status='open'`, [ORG_B])).toBe(1);
  });

  it("claim: quem puxa fica; o segundo recebe JaAtribuida (second_claim_rejected=1/1)", async () => {
    oportunidadeDoClaim = await novaOportunidade(ORG_A, pipelineA, etapaA, "Oportunidade do claim", 7_000, 1);
    const primeiro = await reivindicar(ctxAtt1, oportunidadeDoClaim, ATT_A1, deps);
    expect(primeiro).toEqual({ opportunity_id: oportunidadeDoClaim, user_id: ATT_A1 });
    await expect(reivindicar(ctxAtt2, oportunidadeDoClaim, ATT_A2, deps)).rejects.toBeInstanceOf(JaAtribuida);
    medidas.second_claim_rejected = 1;
    const dono = await pool.query<{ owner_user_id: string; owner_kind: string }>(`select owner_user_id, owner_kind from crm_leads where id=$1`, [oportunidadeDoClaim]);
    expect(dono.rows[0]).toEqual({ owner_user_id: ATT_A1, owner_kind: "user" });
    expect(await conta(`select count(*)::text as n from crm_lead_activities where lead_id=$1 and type='owner_claimed'`, [oportunidadeDoClaim])).toBe(1);
  });
});

describe("F13-T04 — histórico e vínculo com o pedido (ADR-012 intocado)", () => {
  it("vincula um pedido da MESMA organização (orders_linked=1/1), é idempotente e recusa o pedido de B (cross_org_link_denied=1/1)", async () => {
    const pedido = async (ctx: TenantCtx, user: string, contact: string, product: string, company: string | null) =>
      executeOrderCommand(ctx, { type: "human", user_id: user }, {
        command: "create_draft",
        idempotency_key: randomUUID(),
        contact_id: contact,
        company_id: company,
        company_name: company ? "Empresa A no pedido" : null,
        channel: "whatsapp",
        delivery_date: "2026-09-20",
        currency: "BRL",
        items: [{ id: randomUUID(), position: 1, requested_text: "uma unidade", product_id: product, product_name: "Produto", sale_unit: "un", quantity: "1.000", unit_price_cents: 1250, currency: "BRL" }],
      }, { pool });
    pedidoA = (await pedido(ctxAtt1, ATT_A1, CONTACT_A, PRODUCT_A, COMPANY_A)).order.id;
    pedidoB = (await pedido(ctxB, ATT_B, CONTACT_B, PRODUCT_B, null)).order.id;

    const alvo = oportunidades[0]!;
    const primeiro = await vincularPedido(ctxAtt1, alvo, pedidoA, deps);
    expect(primeiro.created).toBe(true);
    const repetido = await vincularPedido(ctxAtt1, alvo, pedidoA, deps);
    expect(repetido).toEqual({ link_id: primeiro.link_id, created: false });
    medidas.orders_linked = await conta(`select count(*)::text as n from crm_lead_links where organization_id=$1 and lead_id=$2 and target_kind='order' and target_id=$3`, [ORG_A, alvo, pedidoA]);
    expect(medidas.orders_linked).toBe(1);

    await expect(vincularPedido(ctxAtt1, alvo, pedidoB, deps)).rejects.toBeInstanceOf(PedidoDeOutraOrganizacao);
    medidas.cross_org_link_denied = 1;
    expect(await conta(`select count(*)::text as n from crm_lead_links where target_id=$1`, [pedidoB])).toBe(0);
    // O contrato do pedido não mudou: 1 evento de rascunho, revisão 1.
    expect(await conta(`select count(*)::text as n from crm_order_events where order_id=$1 and event_type='draft_created'`, [pedidoA])).toBe(1);
  });

  it("history_types=H: os tipos que o módulo gravou na linha do tempo de A (≥ 3)", async () => {
    const tipos = await pool.query<{ type: string }>(`select distinct type from crm_lead_activities where organization_id=$1 and source_module='crm' and type in ('owner_assigned','owner_claimed','order_linked') order by 1`, [ORG_A]);
    medidas.history_types = tipos.rows.length;
    expect(tipos.rows.map((t) => t.type)).toEqual(["order_linked", "owner_assigned", "owner_claimed"]);
    // A linha do tempo da oportunidade vinculada tem o dono e o pedido, nesta ordem.
    const linha = await pool.query<{ type: string }>(`select type from crm_lead_activities where lead_id=$1 order by performed_at, created_at`, [oportunidades[0]]);
    expect(linha.rows.map((l) => l.type)).toEqual(["owner_assigned", "order_linked"]);
  });
});

describe("F13-T05 — relatório comercial: cada indicador confere com a origem", () => {
  it("report_indicators=K/K sobre A (com ganhas, perdidas, tarefas e pedidos) e B = 0 em A", async () => {
    // Arrange — ganha uma, perde uma, duas tarefas (uma vencida, uma concluída), o pedido já existe.
    const [ganha, perdida] = [oportunidades[1]!, oportunidades[2]!];
    await pool.query(`update crm_leads set status='won', closed_at=$2 where id=$1`, [ganha, "2026-09-10T10:00:00.000Z"]);
    await pool.query(`update crm_leads set status='lost', lost_reason='price', closed_at=$2 where id=$1`, [perdida, "2026-09-11T10:00:00.000Z"]);
    await pool.query(
      `insert into crm_tasks (organization_id, title, status, due_date, created_by, lead_id) values
         ($1,'Ligar de volta','pending', now() - interval '2 days', $2, $3),
         ($1,'Enviar proposta','done', now() + interval '1 day', $2, $3)`,
      [ORG_A, ATT_A1, oportunidades[3]],
    );
    const relA = await relatorioComercial(ctxManager, PERIODO, deps);
    const relB = await relatorioComercial(ctxB, PERIODO, deps);

    // Act — recalcular cada indicador por SQL independente sobre a origem.
    const esperado: Record<(typeof INDICADORES)[number], number> = {
      "funnel.open": await conta(`select count(*)::text as n from crm_leads l join crm_stages s on s.id=l.stage_id and not s.is_archived where l.organization_id=$1 and l.status='open'`, [ORG_A]),
      "funnel.value_cents": await conta(`select coalesce(sum(l.value_cents),0)::text as n from crm_leads l join crm_stages s on s.id=l.stage_id and not s.is_archived where l.organization_id=$1 and l.status='open'`, [ORG_A]),
      "closed.won": await conta(`select count(*)::text as n from crm_leads where organization_id=$1 and status='won' and closed_at>=$2 and closed_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      "closed.won_value_cents": await conta(`select coalesce(sum(value_cents),0)::text as n from crm_leads where organization_id=$1 and status='won' and closed_at>=$2 and closed_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      "closed.lost": await conta(`select count(*)::text as n from crm_leads where organization_id=$1 and status='lost' and closed_at>=$2 and closed_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      "closed.lost_value_cents": await conta(`select coalesce(sum(value_cents),0)::text as n from crm_leads where organization_id=$1 and status='lost' and closed_at>=$2 and closed_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      "by_owner.open": await conta(`select count(*)::text as n from crm_leads where organization_id=$1 and status='open' and owner_user_id is not null`, [ORG_A]),
      "by_owner.won": await conta(`select count(*)::text as n from crm_leads where organization_id=$1 and status='won' and owner_user_id is not null and closed_at>=$2 and closed_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      queue_size: await conta(`select count(*)::text as n from crm_leads where organization_id=$1 and status='open' and owner_user_id is null and owner_agent_id is null`, [ORG_A]),
      "tasks.open": await conta(`select count(*)::text as n from crm_tasks where organization_id=$1 and status in ('pending','in_progress')`, [ORG_A]),
      "tasks.overdue": await conta(`select count(*)::text as n from crm_tasks where organization_id=$1 and status in ('pending','in_progress') and due_date < now()`, [ORG_A]),
      "tasks.done": await conta(`select count(*)::text as n from crm_tasks where organization_id=$1 and status='done' and updated_at>=$2 and updated_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      "orders.count": await conta(`select count(*)::text as n from crm_orders where organization_id=$1 and created_at>=$2 and created_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
      "orders.total_cents": await conta(`select coalesce(sum(total_cents),0)::text as n from crm_orders where organization_id=$1 and created_at>=$2 and created_at<$3`, [ORG_A, PERIODO.from, PERIODO.to]),
    };
    const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const lido: Record<(typeof INDICADORES)[number], number> = {
      "funnel.open": soma(relA.funnel.map((e) => e.open)),
      "funnel.value_cents": soma(relA.funnel.map((e) => e.value_cents)),
      "closed.won": relA.closed.won,
      "closed.won_value_cents": relA.closed.won_value_cents,
      "closed.lost": relA.closed.lost,
      "closed.lost_value_cents": relA.closed.lost_value_cents,
      "by_owner.open": soma(relA.by_owner.map((o) => o.open)),
      "by_owner.won": soma(relA.by_owner.map((o) => o.won)),
      queue_size: relA.queue_size,
      "tasks.open": relA.tasks.open,
      "tasks.overdue": relA.tasks.overdue,
      "tasks.done": relA.tasks.done,
      "orders.count": soma(relA.orders.map((o) => o.count)),
      "orders.total_cents": soma(relA.orders.map((o) => o.total_cents)),
    };

    // Assert — indicador a indicador, com o nome na mensagem.
    medidas.report_indicators_total = INDICADORES.length;
    for (const nome of INDICADORES) {
      expect(lido[nome], `indicador ${nome}: relatório=${lido[nome]} origem=${esperado[nome]}`).toBe(esperado[nome]);
      if (lido[nome] === esperado[nome]) medidas.report_indicators += 1;
    }
    // Números que a fixture conhece, para o relatório não "conferir" com uma origem vazia.
    expect(esperado["closed.won"]).toBe(1);
    expect(esperado["closed.lost"]).toBe(1);
    expect(esperado["tasks.overdue"]).toBe(1);
    expect(esperado["orders.count"]).toBe(1);
    expect(esperado["funnel.open"]).toBeGreaterThanOrEqual(3);
    expect(relA.funnel).toHaveLength(8);
    // Nada de B em A, e A não aparece em B (B tem a própria fila de 1).
    expect(relA.by_owner.map((o) => o.user_id)).not.toContain(ATT_B);
    expect(relB.queue_size).toBe(1);
    expect(relB.closed).toEqual({ won: 0, won_value_cents: 0, lost: 0, lost_value_cents: 0 });
    expect(relB.orders).toEqual([{ status: "draft", count: 1, total_cents: 1250 }]);
  });
});

describe("F13 — a linha `crm:` do VERIFY SUMMARY (ADR-035 §2)", () => {
  it("grava a linha com todos os campos medidos e denominadores", () => {
    const linha =
      `crm: fields_defined=${medidas.fields_defined} values_rejected=${medidas.values_rejected}/${medidas.values_rejected_total} ` +
      `values_preserved=${medidas.values_preserved}/${medidas.values_preserved_total} queue_size=${medidas.queue_size} ` +
      `distributed=${medidas.distributed}/${medidas.queue_size} balanced=${medidas.balanced} second_claim_rejected=${medidas.second_claim_rejected}/1 ` +
      `history_types=${medidas.history_types} orders_linked=${medidas.orders_linked}/1 cross_org_link_denied=${medidas.cross_org_link_denied}/1 ` +
      `report_indicators=${medidas.report_indicators}/${medidas.report_indicators_total} roles_denied=${medidas.roles_denied}/${medidas.roles_denied_total}`;
    console.log(linha);
    expect(linha).toBe(
      "crm: fields_defined=6 values_rejected=3/3 values_preserved=4/4 queue_size=5 distributed=5/5 balanced=1 second_claim_rejected=1/1 history_types=3 orders_linked=1/1 cross_org_link_denied=1/1 report_indicators=14/14 roles_denied=3/3",
    );
    gravarLinhaDoVerify("crm", linha);
  });
});
