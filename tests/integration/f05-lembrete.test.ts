/**
 * F05-T06/T07 — o lembrete recorrente PJ: um job por tenant elegível, uma
 * mensagem por cliente por período, envio só pelo catálogo (§5.12, §7.6, D23).
 *
 * ═══ O que este arquivo mede, e por que precisa de Postgres ════════════════
 *
 * As quatro invariantes de §5.12 são sobre o que FICOU GRAVADO — e a de
 * idempotência só é observável na SEGUNDA execução:
 *
 *   (1) job 2× no mesmo período = `reminder_runs` +0, `messages` +0,
 *       `mock_outbox` +0 na segunda — é a linha `reminder: runs=2 sent=1
 *       duplicates=0` do VERIFY SUMMARY (ADR-024), medida num tenant com UM
 *       cliente elegível, somando as três tabelas (G-57);
 *   (2) `enabled=false` = 0 job runs;
 *   (3) tenant em `America/Manaus` dispara 1 hora depois do de São Paulo;
 *   (4) `mock_outbox` recebe exatamente N mensagens para N clientes elegíveis
 *       — com N=3 e um QUARTO elegível cuja conversa está com uma pessoa, que
 *       é pulado com motivo (a automação não fala no meio de um atendimento).
 *
 * E a de F05-T07: `audit_rows` = envios, com executor `automation`, e
 * NENHUM chamador de `adapter.send`/`channelAdapter` fora de `src/actions/`.
 *
 * Nada sai para rede: adapter mock, entrega pelo worker de saída em processo.
 * O relógio é INJETADO — a janela de disparo é comparada com hora fixa.
 */
import { execFileSync } from "node:child_process";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarAdapterMock } from "@/src/channels/mock";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import { rodarLembretes, chaveDeIdempotencia } from "@/src/reminder";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import { semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

/** Segredo FICTÍCIO do adapter — não é credencial de lugar nenhum. */
const SEGREDO_FICTICIO = "segredo-ficticio-do-lembrete-f05-0006";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

/**
 * Quatro tenants, quatro papéis na prova:
 *  · IDEMP   — UM cliente elegível; é nele que `runs=2 sent=1 duplicates=0` é medido;
 *  · SP      — três elegíveis (N=3) + um elegível com conversa OCUPADA + dois inelegíveis;
 *  · MANAUS  — um elegível, fuso `America/Manaus`: dispara uma hora depois;
 *  · OFF     — um elegível, `enabled=false`: zero job runs.
 */
const ORGS = {
  idemp: "f0500006-0000-4000-8000-00000000000a",
  sp: "f0500006-0000-4000-8000-00000000000b",
  manaus: "f0500006-0000-4000-8000-00000000000c",
  off: "f0500006-0000-4000-8000-00000000000d",
} as const;
type Nome = keyof typeof ORGS;

const usuarioDe = (org: string) => org.replace(/^f0500006-0000/, "f0500006-1000");
const sessaoDe = (org: string) => org.replace(/^f0500006-0000/, "f0500006-3000");
const contatoDe = (org: string, n: number) => org.replace(/^f0500006-0000/, `f0500006-2${n}00`);
const conversaDe = (org: string, n: number) => org.replace(/^f0500006-0000/, `f0500006-4${n}00`);
const empresaDe = (org: string, n: number) => org.replace(/^f0500006-0000/, `f0500006-5${n}00`);

/** Quinta-feira 10/09/2026, 18:00 UTC = 15:00 em São Paulo, 14:00 em Manaus. */
const QUINTA_18Z = new Date("2026-09-10T18:00:00.000Z");
/** Uma hora depois: 16:00 em São Paulo (fora da janela), 15:00 em Manaus (dentro). */
const QUINTA_19Z = new Date("2026-09-10T19:00:00.000Z");
const PERIODO = "2026-W37";

const LEMBRETE = {
  enabled: true,
  weekday: 4,
  hour: 15,
  cutoff_hours: 20,
  message_template:
    "Olá {{customer.name}}! Podemos repetir o pedido desta semana ({{period}})? Semana passada foi: {{last_order.summary}}",
  period: "weekly",
};

function tenant(nome: Nome, contatos: number, conversas: readonly { n: number; estado: string; legado: string }[]): ConfigDeTenant {
  const org = ORGS[nome];
  return {
    org,
    slug: `f05-lembrete-${nome}`,
    usuario: usuarioDe(org),
    sessao: sessaoDe(org),
    conta: `f05-lembrete-${nome}-conta`,
    contatos: Array.from({ length: contatos }, (_, i) => ({
      id: contatoDe(org, i + 1),
      nome: `Cliente PJ ${nome} ${i + 1}`,
      telefone: `+55119${String(56_000_000 + Object.keys(ORGS).indexOf(nome) * 100 + i).padStart(9, "0")}`,
    })),
    conversas: conversas.map((c) => ({
      id: conversaDe(org, c.n),
      contato: contatoDe(org, c.n),
      estado: c.estado,
      statusLegado: c.legado,
    })),
    produtos: [{ id: org.replace(/^f0500006-0000/, "f0500006-5900"), codigo: `PJ-${nome}`, nome: "Café torrado premium", preco_cents: 2500 }],
    materiais: [],
    pedidos: [{ id: org.replace(/^f0500006-0000/, "f0500006-6100"), item: org.replace(/^f0500006-0000/, "f0500006-7100"), contato: contatoDe(org, 1) }],
    settings: {
      "ai.enabled": true,
      "orders.recurring_reminder": nome === "off" ? { ...LEMBRETE, enabled: false } : LEMBRETE,
    },
  };
}

const TENANTS: Record<Nome, ConfigDeTenant> = {
  idemp: tenant("idemp", 1, []),
  // SP: cliente 1 sem conversa ("nenhuma"), 2 em resolved (reabre), 3 em
  // waiting_customer (move no lugar), 4 em human_handling (OCUPADA — pulado),
  // 5 recorrente SEM empresa (inelegível), 6 não recorrente (inelegível).
  sp: tenant("sp", 6, [
    { n: 2, estado: "resolved", legado: "closed" },
    { n: 3, estado: "waiting_customer", legado: "ai_handling" },
    { n: 4, estado: "human_handling", legado: "claimed" },
  ]),
  manaus: tenant("manaus", 1, []),
  off: tenant("off", 1, []),
};

/** Quem é recorrente COM empresa em cada tenant (o que `selectEligibleCustomers` deve achar). */
const ELEGIVEIS: Record<Nome, readonly number[]> = { idemp: [1], sp: [1, 2, 3, 4], manaus: [1], off: [1] };
/** Recorrente SEM empresa: `recurring=true`, `company_id` nulo — fica de fora. */
const SEM_EMPRESA: Record<Nome, readonly number[]> = { idemp: [], sp: [5], manaus: [], off: [] };

const listEligible = async (): Promise<string[]> => {
  const r = await pool.query<{ organization_id: string }>(
    `select organization_id from public.tenant_settings
      where key = 'orders.recurring_reminder' and (value->>'enabled')::boolean is true
      order by organization_id`,
  );
  return r.rows.map((l) => l.organization_id);
};

const deps = (agora: Date) => ({
  pool,
  adapters: { mock: adapterMock },
  modo: "mock",
  agora: () => agora,
  listEligible,
});

const contar = async (sql: string, valores: unknown[] = []): Promise<number> => {
  const r = await pool.query<{ v: string | number }>(sql, valores);
  return Number(r.rows[0]?.v ?? 0);
};

const jobsDe = (org: string, kind = "recurring_reminder") =>
  contar(`select count(*)::int as v from public.job_queue where organization_id = $1 and kind = $2`, [org, kind]);
const jobRunsDe = (org: string) =>
  contar(
    `select count(*)::int as v from public.job_runs r join public.job_queue j on j.id = r.job_id
      where r.organization_id = $1 and j.kind = 'recurring_reminder'`,
    [org],
  );
const runsDe = (org: string) =>
  contar(`select count(*)::int as v from public.reminder_runs where organization_id = $1`, [org]);
const enviadosDe = (org: string) =>
  contar(`select count(*)::int as v from public.reminder_runs where organization_id = $1 and sent_message_id is not null`, [org]);
const mensagensDe = (org: string) =>
  contar(`select count(*)::int as v from public.messages where organization_id = $1 and direction = 'outbound' and sent_via = 'automation'`, [org]);
const outboxDe = (org: string) =>
  contar(`select count(*)::int as v from public.mock_outbox where organization_id = $1`, [org]);
const auditoriaDe = (org: string) =>
  contar(
    `select count(*)::int as v from public.audit_events
      where organization_id = $1 and action_name = 'send_message' and actor_type = 'automation' and result = 'executed'`,
    [org],
  );

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const nome of Object.keys(TENANTS) as Nome[]) {
      const cfg = TENANTS[nome];
      await semearTenant(client, cfg);
      // A empresa-cliente (crm_companies) e o vínculo dos recorrentes.
      for (const n of ELEGIVEIS[nome]) {
        await client.query(
          `insert into public.crm_companies (id, organization_id, legal_name) values ($1,$2,$3)`,
          [empresaDe(cfg.org, n), cfg.org, `Empresa ${nome} ${n} Ltda`],
        );
        await client.query(
          `update public.contacts set recurring = true, company_id = $3 where id = $1 and organization_id = $2`,
          [contatoDe(cfg.org, n), cfg.org, empresaDe(cfg.org, n)],
        );
      }
      for (const n of SEM_EMPRESA[nome]) {
        await client.query(`update public.contacts set recurring = true where id = $1 and organization_id = $2`, [
          contatoDe(cfg.org, n),
          cfg.org,
        ]);
      }
    }
    // A conversa OCUPADA de SP tem dono — como uma conversa assumida tem.
    await client.query(`update public.conversations set assigned_to_user_id = $2 where id = $1`, [
      conversaDe(ORGS.sp, 4),
      usuarioDe(ORGS.sp),
    ]);
    // Manaus: o fuso é alias canônico de organizations.timezone (§5.2).
    await client.query(`update public.organizations set timezone = 'America/Manaus' where id = $1`, [ORGS.manaus]);
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("F05-T06 — o job por tenant, a janela local e o período", () => {
  it("às 15h de São Paulo: IDEMP e SP disparam, MANAUS ainda não, OFF nunca (inv. 2 e 3)", async () => {
    // Act — a primeira rodada, na hora fixa.
    const r = await rodarLembretes(deps(QUINTA_18Z));

    // Assert — elegibilidade vem da Setting; OFF nem entra na lista.
    expect(r.tenants_eligible, "OFF entrou na lista de elegíveis").toBe(3);
    expect(r.tenants_failed).toBe(0);
    expect(r.tenants_fired).toBe(2);
    const porOrg = new Map(r.por_tenant.map((t) => [t.organization_id, t]));
    expect(porOrg.get(ORGS.idemp)?.fired).toBe(true);
    expect(porOrg.get(ORGS.sp)?.fired).toBe(true);
    expect(porOrg.get(ORGS.manaus)?.fired).toBe(false);
    expect(porOrg.get(ORGS.manaus)?.reason).toBe("outside_window");
    expect(porOrg.get(ORGS.idemp)?.period_key).toBe(PERIODO);

    expect(await jobsDe(ORGS.idemp)).toBe(1);
    expect(await jobsDe(ORGS.sp)).toBe(1);
    expect(await jobsDe(ORGS.manaus), "Manaus disparou na hora de São Paulo").toBe(0);
    expect(await jobsDe(ORGS.off), "enabled=false produziu job run (inv. 2)").toBe(0);
    expect(await runsDe(ORGS.off)).toBe(0);
    expect(await jobRunsDe(ORGS.idemp) + await jobRunsDe(ORGS.sp)).toBe(2);
    console.info(
      `reminder-tenants: eligible=${r.tenants_eligible}/3 fired=${r.tenants_fired}/2 off_job_runs=0/0 manaus_at_sp_hour=0/0`,
    );
  });

  it("uma hora depois: MANAUS dispara, São Paulo já não (inv. 3, contado)", async () => {
    const r = await rodarLembretes(deps(QUINTA_19Z));
    const porOrg = new Map(r.por_tenant.map((t) => [t.organization_id, t]));

    expect(porOrg.get(ORGS.manaus)?.fired).toBe(true);
    expect(porOrg.get(ORGS.sp)?.fired).toBe(false);
    expect(porOrg.get(ORGS.idemp)?.fired).toBe(false);
    expect(await jobsDe(ORGS.manaus)).toBe(1);
    expect(await jobsDe(ORGS.sp), "SP disparou duas vezes em horas diferentes").toBe(1);
    expect(await enviadosDe(ORGS.manaus)).toBe(1);
    console.info("reminder-timezone: manaus_fired_one_hour_later=1/1 sp_at_manaus_hour=0/0");
  });

  it("N=3 clientes elegíveis = N mensagens; a conversa OCUPADA é pulada com motivo (inv. 4)", async () => {
    // Arrange — os quatro elegíveis de SP e o que aconteceu com cada um.
    const runs = await pool.query<{ customer_id: string; sent_message_id: string | null; skipped_reason: string | null; conversation_id: string | null }>(
      `select customer_id, sent_message_id, skipped_reason, conversation_id
         from public.reminder_runs where organization_id = $1 order by customer_id`,
      [ORGS.sp],
    );
    const porCliente = new Map(runs.rows.map((l) => [l.customer_id, l]));

    // Act — a entrega, pelo worker de saída (o job só enfileira).
    const ciclo = await rodarCicloDeSaida({ pool, adapters: { mock: adapterMock }, modo: "mock", lote: 50 });

    // Assert — exatamente os quatro elegíveis têm linha; os dois inelegíveis não.
    expect(runs.rows.length, "reminder_runs de SP não tem uma linha por elegível").toBe(ELEGIVEIS.sp.length);
    expect(porCliente.has(contatoDe(ORGS.sp, 5)), "recorrente SEM empresa recebeu lembrete").toBe(false);
    expect(porCliente.has(contatoDe(ORGS.sp, 6)), "não recorrente recebeu lembrete").toBe(false);
    // 1 (nenhuma → criada), 2 (resolved → reaberta), 3 (waiting_customer → no lugar): enviados.
    for (const n of [1, 2, 3]) {
      const l = porCliente.get(contatoDe(ORGS.sp, n));
      expect(l?.sent_message_id, `cliente ${n} de SP sem mensagem`).toBeTruthy();
      expect(l?.skipped_reason).toBeNull();
    }
    // 4 (human_handling): pulado, com a etiqueta — e a conversa dele NÃO recebeu nada.
    const ocupado = porCliente.get(contatoDe(ORGS.sp, 4));
    expect(ocupado?.sent_message_id).toBeNull();
    expect(ocupado?.skipped_reason).toBe("conversation_busy");
    expect(
      await contar(`select count(*)::int as v from public.messages where conversation_id = $1 and direction = 'outbound'`, [conversaDe(ORGS.sp, 4)]),
    ).toBe(0);
    const ocupada = await pool.query<{ saas_state: string; assigned_to_user_id: string | null; saas_tags: string[] }>(
      `select saas_state, assigned_to_user_id, saas_tags from public.conversations where id = $1`,
      [conversaDe(ORGS.sp, 4)],
    );
    expect(ocupada.rows[0]?.saas_state, "a automação moveu uma conversa que é de uma pessoa").toBe("human_handling");
    expect(ocupada.rows[0]?.assigned_to_user_id).toBe(usuarioDe(ORGS.sp));
    expect(ocupada.rows[0]?.saas_tags).toEqual([]);

    // As três conversas enviadas estão em waiting_customer com a tag.
    const estados = await pool.query<{ id: string; saas_state: string; saas_tags: string[]; status: string }>(
      `select id, saas_state, saas_tags, status from public.conversations
        where organization_id = $1 and contact_id in ($2, $3, $4)`,
      [ORGS.sp, contatoDe(ORGS.sp, 1), contatoDe(ORGS.sp, 2), contatoDe(ORGS.sp, 3)],
    );
    expect(estados.rows.length, "a conversa do cliente 1 não foi criada").toBe(3);
    for (const c of estados.rows) {
      expect(c.saas_state, `conversa ${c.id} não está em waiting_customer`).toBe("waiting_customer");
      expect(c.saas_tags, `conversa ${c.id} sem a tag awaiting_quantity`).toEqual(["awaiting_quantity"]);
      expect(c.status, "o legado não foi projetado").toBe("ai_handling");
    }
    // A conversa 2 é a MESMA linha reaberta (uniq 1:1 por contato/sessão), não uma nova.
    expect(estados.rows.some((c) => c.id === conversaDe(ORGS.sp, 2))).toBe(true);

    // N mensagens no mock_outbox — nem uma a mais.
    expect(ciclo.entregues).toBeGreaterThanOrEqual(3);
    expect(await outboxDe(ORGS.sp)).toBe(3);
    expect(await mensagensDe(ORGS.sp)).toBe(3);
    // O corpo saiu do template: nome do cliente e resumo do último pedido (cliente 1 tem pedido).
    const corpo = await pool.query<{ body: string }>(
      `select body from public.mock_outbox where organization_id = $1 and conversation_id = (select id from public.conversations where organization_id = $1 and contact_id = $2)`,
      [ORGS.sp, contatoDe(ORGS.sp, 1)],
    );
    expect(corpo.rows[0]?.body).toContain("Cliente PJ sp 1");
    expect(corpo.rows[0]?.body).toContain(PERIODO);
    expect(corpo.rows[0]?.body).toContain("Café torrado premium");
    expect(corpo.rows[0]?.body, "template com campo não preenchido").not.toContain("{{");
    // A chave de idempotência de §5.12, letra por letra, no adapter.
    const chaves = await pool.query<{ idempotency_key: string }>(
      `select idempotency_key from public.mock_outbox where organization_id = $1 order by idempotency_key`,
      [ORGS.sp],
    );
    expect(chaves.rows.map((c) => c.idempotency_key).sort()).toEqual(
      [1, 2, 3].map((n) => chaveDeIdempotencia(ORGS.sp, contatoDe(ORGS.sp, n), PERIODO)).sort(),
    );

    console.info(
      `reminder-n: customers_eligible=${ELEGIVEIS.sp.length} sent=3/3 outbox=3/3 skipped_busy=1/1 created=1 reopened=1 in_place=1`,
    );
  });
});

describe("F05-T06 — idempotência por (tenant, cliente, período): o job rodado DUAS vezes", () => {
  it("reminder: runs=2 sent=1 duplicates=0", async () => {
    // Arrange — a PRIMEIRA execução. Normalmente já aconteceu no primeiro
    // caso do arquivo; quando este caso roda sozinho (o mutante 51 o seleciona
    // com `-t`), ela acontece aqui — o cenário nasce dentro do caso, para que
    // o vermelho do mutante fale da chave e não da falta de cenário.
    if ((await jobsDe(ORGS.idemp)) === 0) await rodarLembretes(deps(QUINTA_18Z));
    await rodarCicloDeSaida({ pool, adapters: { mock: adapterMock }, modo: "mock", lote: 50 });
    const antes = {
      jobs: await jobsDe(ORGS.idemp),
      runs: await runsDe(ORGS.idemp),
      mensagens: await mensagensDe(ORGS.idemp),
      outbox: await outboxDe(ORGS.idemp),
    };
    expect(antes.jobs, "o cenário exige a primeira execução já feita").toBe(1);
    expect(antes.runs).toBe(1);
    expect(antes.mensagens).toBe(1);
    expect(antes.outbox).toBe(1);

    // Act — a MESMA hora, o MESMO período: segunda execução.
    const segunda = await rodarLembretes(deps(QUINTA_18Z));
    await rodarCicloDeSaida({ pool, adapters: { mock: adapterMock }, modo: "mock", lote: 50 });

    // Assert — o job rodou (runs=2), e as três tabelas tocadas ganharam +0.
    const depois = {
      jobs: await jobsDe(ORGS.idemp),
      runs: await runsDe(ORGS.idemp),
      mensagens: await mensagensDe(ORGS.idemp),
      outbox: await outboxDe(ORGS.idemp),
    };
    const doTenant = segunda.por_tenant.find((t) => t.organization_id === ORGS.idemp);
    const duplicates =
      depois.runs - antes.runs + (depois.mensagens - antes.mensagens) + (depois.outbox - antes.outbox);
    // A asserção NOMINAL vem primeiro: é ela que o mutante 51 precisa ver
    // vermelha — as outras a cercam, não a substituem.
    expect(duplicates, "a segunda execução do mesmo período gravou de novo").toBe(0);
    expect(doTenant?.fired, "a segunda execução não disparou — runs=2 seria vácuo").toBe(true);
    expect(doTenant?.duplicates_avoided).toBe(1);
    expect(doTenant?.sent).toBe(0);
    expect(depois.jobs).toBe(2);
    expect(await jobRunsDe(ORGS.idemp)).toBe(2);
    expect(await enviadosDe(ORGS.idemp)).toBe(1);

    const linha = `reminder: runs=${depois.jobs} sent=${await enviadosDe(ORGS.idemp)} duplicates=${duplicates} tables_summed=3`;
    console.info(linha);
    gravarLinhaDoVerify("reminder", linha);
  });

  it("o cutoff_at foi fixado no envio: sent_at + cutoff_hours, no relógio injetado", async () => {
    const r = await pool.query<{ sent_at: Date; cutoff_at: Date; period_key: string }>(
      `select sent_at, cutoff_at, period_key from public.reminder_runs where organization_id = $1`,
      [ORGS.idemp],
    );
    const linha = r.rows[0]!;
    expect(linha.sent_at.toISOString()).toBe(QUINTA_18Z.toISOString());
    expect(linha.cutoff_at.getTime() - linha.sent_at.getTime()).toBe(LEMBRETE.cutoff_hours * 3_600_000);
    expect(linha.period_key).toBe(PERIODO);
    console.info(`reminder-cutoff-at: fixed_at_send=1/1 hours=${LEMBRETE.cutoff_hours}`);
  });
});

describe("F05-T07 — envio só pelo catálogo, executor automation", () => {
  it("audit_rows = envios, com actor_type=automation, em todos os tenants que enviaram", async () => {
    let auditadas = 0;
    let enviadas = 0;
    for (const org of [ORGS.idemp, ORGS.sp, ORGS.manaus]) {
      auditadas += await auditoriaDe(org);
      enviadas += await enviadosDe(org);
    }
    expect(enviadas, "nenhum envio — a prova seria vácua").toBe(5);
    expect(auditadas, "houve envio sem linha de auditoria com executor automation").toBe(enviadas);
    // E o texto da mensagem NÃO está na auditoria.
    const vazou = await contar(
      `select count(*)::int as v from public.audit_events where payload::text ilike '%repetir o pedido%'`,
    );
    expect(vazou).toBe(0);
    console.info(`reminder-audit: audit_rows=${auditadas}/${enviadas} executor=automation texto_na_auditoria=${vazou}/0`);
  });

  it("grep -rn \"adapter.send\\|channelAdapter\" src/ | grep -v src/actions/ = 0", () => {
    // Arrange + Act — o grep literal de §7.6, no texto do produto.
    let saida = "";
    try {
      saida = execFileSync("grep", ["-rn", "adapter.send\\|channelAdapter", "src/"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    } catch (erro) {
      const e = erro as { status?: number; stdout?: string };
      if (e.status !== 1) throw erro;
      saida = e.stdout ?? "";
    }
    const ocorrencias = saida.split("\n").filter((l) => l.trim().length > 0);
    const foraDeActions = ocorrencias.filter((l) => !l.startsWith("src/actions/"));
    const dentro = ocorrencias.filter((l) => l.startsWith("src/actions/"));

    // Assert — zero fora, e pelo menos uma DENTRO (guarda de vacuidade do grep).
    expect(foraDeActions, "chamador de adapter.send/channelAdapter fora de src/actions").toEqual([]);
    expect(dentro.length, "o grep não acha nem o chamador legítimo — padrão morto").toBeGreaterThan(0);
    console.info(`reminder-grep: fora_de_actions=${foraDeActions.length}/0 dentro=${dentro.length}`);
  });
});
