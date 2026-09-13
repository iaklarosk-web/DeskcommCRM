/**
 * F05-T08 — a RESPOSTA ao lembrete: quantidade vira `update_order_quantity`
 * (by_risk), sem resposta vira aviso + tentativa de tarefa, resposta tardia vai
 * para gente (§5.12, §7.6, D33/D48).
 *
 * ═══ Os três cenários de §7.6 (`reminder-reply: scenarios=3 pass=3/3`) ═══
 *
 *   S1  Cliente responde NO PRAZO com quantidade → a entrada carimba
 *       `replied_at` → o turno lê o LEMBRETE no contexto (pedido draft com
 *       ids e revisão) → o modelo chama `update_order_quantity` → PENDÊNCIA
 *       (D33) → o attendant aprova → `crm_order_items.quantity` muda no banco.
 *   S2  Cliente NÃO responde até o corte → `rodarCortes` avisa a fila
 *       (`reminder.no_reply`) e TENTA `create_task` pelo catálogo; o domínio
 *       recusa executor não-humano (limite declarado, VARREDURA §B5/§C6) e a
 *       recusa fica gravada. Sem pedido draft, `no_draft_order`. Uma vez só.
 *   S3  Cliente responde DEPOIS do corte → `replied_late=true` → o turno chama
 *       gente (`tenant_rule`) SEM chamar o provedor, e o pedido não muda.
 *
 * `order_items.quantity` conferido por query 2/2: S1 mudou, S3 não.
 *
 * Nada sai para rede (adapter e provedor mock, D12). O relógio do LEMBRETE é
 * injetado (janela = hora local de agora); o da ENTRADA é o real — por isso S3
 * antecipa o `cutoff_at` da sua linha por SQL, como fixture, e diz que fez.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { confirm } from "@/src/actions/confirm";
import { comoTextoDoProvedor, responderTurno, type SaidaEstruturada } from "@/src/ai";
import { recebeEntrada } from "@/src/channels/inbound";
import { criarAdapterMock } from "@/src/channels/mock";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import { horaLocal, rodarCortes, rodarLembretes } from "@/src/reminder";
import type { TenantCtx } from "@/src/tenant-context";

import { CFG_LLM, mensagemDoPrompt, promptComoTexto, semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG = "f0500008-0000-4000-8000-00000000000a";
const ctx: TenantCtx = { organization_id: ORG, source: "job" };
const ATENDENTE = "f0500008-1001-4000-8000-00000000000a";
const ctxSessao: TenantCtx = { organization_id: ORG, user_id: ATENDENTE, role: "agent", source: "session" };

const SEGREDO_FICTICIO = "segredo-ficticio-da-resposta-f05-0008";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });
const FIXTURES = path.join(process.cwd(), "tests/fixtures/waha/2026.7.2");

const contato = (n: number) => `f0500008-2${String(n).padStart(3, "0")}-4000-8000-00000000000a`;
const pedidoDe = (n: number) => `f0500008-6${String(n).padStart(3, "0")}-4000-8000-00000000000a`;
const itemDe = (n: number) => `f0500008-7${String(n).padStart(3, "0")}-4000-8000-00000000000a`;
const empresaDe = (n: number) => `f0500008-5${String(n).padStart(3, "0")}-4000-8000-00000000000a`;

/** S1 = cliente 1 (responde no prazo), S2 = 2 (não responde) e 4 (não responde, SEM pedido), S3 = 3 (tarde). */
const CLIENTES = [1, 2, 3, 4] as const;
const COM_PEDIDO = [1, 2, 3] as const;

/** A janela é a hora local de AGORA: o lembrete "sai" agora e o cutoff é agora + 20h. */
const AGORA = new Date();
const LOCAL = horaLocal(AGORA, "America/Sao_Paulo");
const CUTOFF_HOURS = 20;

const TENANT: ConfigDeTenant = {
  org: ORG,
  slug: "f05-resposta",
  usuario: ATENDENTE,
  sessao: "f0500008-3000-4000-8000-00000000000a",
  conta: "f05-resposta-conta",
  contatos: CLIENTES.map((n) => ({
    id: contato(n),
    nome: `Cliente PJ Resposta ${n}`,
    telefone: `+55119${String(58_000_000 + n).padStart(9, "0")}`,
  })),
  conversas: [],
  produtos: [{ id: "f0500008-5900-4000-8000-00000000000a", codigo: "PJ-R", nome: "Café torrado premium", preco_cents: 2500 }],
  materiais: [],
  pedidos: COM_PEDIDO.map((n) => ({ id: pedidoDe(n), item: itemDe(n), contato: contato(n) })),
  settings: {
    "ai.enabled": true,
    "ai.confidence_threshold": 0.6,
    "orders.recurring_reminder": {
      enabled: true,
      weekday: LOCAL.weekday,
      hour: LOCAL.hour,
      cutoff_hours: CUTOFF_HOURS,
      message_template: "Olá {{customer.name}}! Repetimos o pedido desta semana? Último: {{last_order.summary}}",
      period: "weekly",
    },
  },
};

const listEligible = async (): Promise<string[]> => [ORG];
const depsDoLembrete = (agora: Date) => ({ pool, adapters: { mock: adapterMock }, modo: "mock", agora: () => agora, listEligible });

const contar = async (sql: string, valores: unknown[] = []): Promise<number> => {
  const r = await pool.query<{ v: string | number }>(sql, valores);
  return Number(r.rows[0]?.v ?? 0);
};

const quantidadeDoItem = async (item: string): Promise<string | null> => {
  const r = await pool.query<{ quantity: string | null }>(`select quantity::text as quantity from public.crm_order_items where id = $1`, [item]);
  return r.rows[0]?.quantity ?? null;
};

const conversaDoContato = async (n: number): Promise<{ id: string; saas_state: string; saas_tags: string[] }> => {
  const r = await pool.query<{ id: string; saas_state: string; saas_tags: string[] }>(
    `select id, saas_state, saas_tags from public.conversations where organization_id = $1 and contact_id = $2`,
    [ORG, contato(n)],
  );
  const linha = r.rows[0];
  if (linha === undefined) throw new Error(`o cliente ${n} não tem conversa — o lembrete não a criou`);
  return linha;
};

const runDoContato = async (n: number) => {
  const r = await pool.query<{
    id: string; replied_at: Date | null; replied_late: boolean; cutoff_at: Date | null;
    no_reply_notified_at: Date | null; task_id: string | null; task_denied_code: string | null;
    concluded_as: string | null;
  }>(
    `select id, replied_at, replied_late, cutoff_at, no_reply_notified_at, task_id, task_denied_code, concluded_as
       from public.reminder_runs where organization_id = $1 and customer_id = $2`,
    [ORG, contato(n)],
  );
  const linha = r.rows[0];
  if (linha === undefined) throw new Error(`o cliente ${n} não tem reminder_run`);
  return linha;
};

/** Um POST do provedor mock, assinado, como se o cliente `n` tivesse escrito. */
async function clienteEscreve(n: number, corpo: string, idExterno: string) {
  const bruto = JSON.parse(readFileSync(path.join(FIXTURES, "message-texto.json"), "utf8")) as { payload: Record<string, unknown> } & Record<string, unknown>;
  const numero = TENANT.contatos[n - 1]!.telefone.replace(/^\+/, "");
  const payload = {
    ...bruto,
    session: TENANT.conta,
    payload: {
      ...bruto.payload,
      id: `false_${numero}@c.us_${idExterno}`,
      from: `${numero}@c.us`,
      body: corpo,
      timestamp: Math.floor(Date.now() / 1000),
      _data: { ...(bruto.payload["_data"] as Record<string, unknown>), key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: idExterno }, message: { conversation: corpo } },
    },
  };
  const raw = JSON.stringify(payload);
  const assinatura = createHmac("sha256", SEGREDO_FICTICIO).update(Buffer.from(raw, "utf8")).digest("hex");
  return recebeEntrada("mock", raw, { "x-webhook-hmac": assinatura, "content-type": "application/json" }, { pool, adapters: { mock: adapterMock }, modo: "mock" });
}

const saidaDe = (parcial: Partial<SaidaEstruturada>): SaidaEstruturada => ({
  reply: "",
  intent: "desconhecida",
  confidence: 0,
  tool_calls: [],
  handoff: { wanted: false, reason: null },
  ...parcial,
});

/**
 * O roteiro do mock lê o LEMBRETE do PRÓPRIO PROMPT — os ids do pedido têm de
 * chegar ao modelo pelo contexto, senão a prova mediria o teste e não o turno.
 */
function registroQueLeOLembrete(conversationId = "") {
  const estado = { chamadas: 0, viuLembrete: false, orderId: "", itemId: "", revision: 0, conversationId };
  const registry = createFakeRegistry(async (options) => {
    estado.chamadas += 1;
    const prompt = options.prompt as unknown as readonly { content: unknown }[];
    const mensagem = mensagemDoPrompt(prompt);
    const bloco = promptComoTexto(prompt);
    // A ÚLTIMA ocorrência: as instruções do sistema também citam o rótulo.
    const marcador = "LEMBRETE DE PEDIDO RECORRENTE:";
    const inicio = bloco.lastIndexOf(marcador);
    let saida: SaidaEstruturada;
    if (inicio >= 0) {
      const linha = bloco.slice(inicio + marcador.length).split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"));
      const lembrete = JSON.parse(linha ?? "{}") as {
        reminder_run_id?: string;
        pedido_draft: { id: string; revision: number; items: { id: string }[] } | null;
      };
      estado.viuLembrete = true;
      const quantidade = /(\d+)\s*kg/i.exec(mensagem)?.[1] ?? null;
      if (lembrete.pedido_draft !== null && quantidade !== null) {
        estado.orderId = lembrete.pedido_draft.id;
        estado.itemId = lembrete.pedido_draft.items[0]!.id;
        estado.revision = lembrete.pedido_draft.revision;
        saida = saidaDe({
          reply: `Anotado: ${quantidade} kg. Vou confirmar com a equipe.`,
          intent: "repetir_pedido",
          confidence: 0.93,
          tool_calls: [
            {
              name: "update_order_quantity",
              input: {
                conversation_id: estado.conversationId,
                order_id: estado.orderId,
                item_id: estado.itemId,
                quantity: quantidade,
                expected_revision: estado.revision,
                idempotency_key: `f05-resposta-${estado.orderId}`,
              },
            },
          ],
        });
      } else {
        saida = saidaDe({ reply: "Quantos kg você quer esta semana?", intent: "repetir_pedido", confidence: 0.9 });
      }
    } else {
      saida = saidaDe({ reply: "Bom dia!", intent: "atendimento", confidence: 0.9 });
    }
    return {
      content: [{ type: "text" as const, text: comoTextoDoProvedor(saida) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 6, text: 6, reasoning: 0 } },
      warnings: [],
    };
  });
  return { registry, estado };
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT);
    for (const n of CLIENTES) {
      await client.query(`insert into public.crm_companies (id, organization_id, legal_name) values ($1,$2,$3)`, [empresaDe(n), ORG, `Empresa Resposta ${n} Ltda`]);
      await client.query(`update public.contacts set recurring = true, company_id = $3 where id = $1 and organization_id = $2`, [contato(n), ORG, empresaDe(n)]);
    }
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }

  // O lembrete sai para os quatro, e o worker entrega.
  const disparo = await rodarLembretes(depsDoLembrete(AGORA));
  if (disparo.sent !== CLIENTES.length) throw new Error(`o cenário exige ${CLIENTES.length} lembretes enviados, saíram ${disparo.sent}`);
  await rodarCicloDeSaida({ pool, adapters: { mock: adapterMock }, modo: "mock", lote: 50 });
});

afterAll(async () => {
  await pool.end();
});

const passaram: string[] = [];

describe("F05-T08 — reminder-reply: os três cenários de §7.6", () => {
  it("S1: resposta no prazo → update_order_quantity pendente → aprovada → quantidade muda no banco", async () => {
    // Arrange
    const antes = await quantidadeDoItem(itemDe(1));
    expect(antes).toBe("1.000");
    const conversaAntes = await conversaDoContato(1);
    expect(conversaAntes.saas_state).toBe("waiting_customer");
    expect(conversaAntes.saas_tags).toEqual(["awaiting_quantity"]);

    // Act 1 — o cliente responde pelo webhook (5.7 → 5.6): a entrada carimba a resposta.
    const entrada = await clienteEscreve(1, "pode mandar 10 kg desta vez", "3EB0F05RESP01");
    expect(entrada.status, JSON.stringify(entrada)).toBe("ingerido");
    const runDepoisDaEntrada = await runDoContato(1);
    expect(runDepoisDaEntrada.replied_at, "a entrada não carimbou replied_at").not.toBeNull();
    expect(runDepoisDaEntrada.replied_late).toBe(false);
    expect((await conversaDoContato(1)).saas_state).toBe("ai_handling");

    // Act 2 — o turno (5.9): o modelo lê o LEMBRETE do contexto e chama a tool.
    const { registry, estado } = registroQueLeOLembrete(conversaAntes.id);
    const turno = await responderTurno(
      ctx,
      { conversation_id: conversaAntes.id, mensagem_do_cliente: "pode mandar 10 kg desta vez" },
      { pool, cfg: CFG_LLM, registry, adapters: { mock: adapterMock }, modo: "mock" },
    );

    // Assert 2 — a tool foi chamada com os ids que vieram pelo contexto e ficou PENDENTE (D33).
    expect(estado.viuLembrete, "o prompt não carregou o bloco LEMBRETE").toBe(true);
    expect(estado.orderId).toBe(pedidoDe(1));
    expect(estado.itemId).toBe(itemDe(1));
    const tool = turno.tools_executadas.find((t) => t.name === "update_order_quantity");
    expect(tool?.status, `update_order_quantity: ${JSON.stringify(turno.tools_executadas)}`).toBe("pending");
    expect(await quantidadeDoItem(itemDe(1)), "a quantidade mudou ANTES da confirmação").toBe("1.000");
    expect((await conversaDoContato(1)).saas_state).toBe("waiting_confirmation");
    const pendencia = await pool.query<{ id: string }>(
      `select id from public.pending_actions where organization_id = $1 and conversation_id = $2 and status = 'pending'`,
      [ORG, conversaAntes.id],
    );
    expect(pendencia.rows.length).toBe(1);
    // A tag saiu e o lembrete foi concluído como `order_updated` — o ciclo fechou.
    expect((await conversaDoContato(1)).saas_tags).toEqual([]);
    expect((await runDoContato(1)).concluded_as).toBe("order_updated");

    // Act 3 — o attendant aprova no inbox.
    const aprovacao = await confirm(ctxSessao, pendencia.rows[0]!.id, "approved", { kind: "human", user_id: ATENDENTE }, { pool, adapters: { mock: adapterMock }, modo: "mock" });

    // Assert 3 — a quantidade mudou no BANCO, e só depois da aprovação.
    expect(aprovacao.status, `aprovação: ${aprovacao.reason ?? "-"} ${aprovacao.detalhe ?? ""}`).toBe("executed");
    const depois = await quantidadeDoItem(itemDe(1));
    expect(depois).toBe("10.000");
    expect((await conversaDoContato(1)).saas_state).toBe("ai_handling");
    passaram.push("S1");
    console.info(`reminder-reply-s1: replied_late=false tool=pending confirmed=1/1 quantity=${antes}->${depois}`);
  });

  it("S2: sem resposta até o corte → aviso reminder.no_reply + tentativa de tarefa registrada, uma vez só", async () => {
    // Arrange — o corte roda depois do prazo (relógio injetado).
    const depoisDoCorte = new Date(AGORA.getTime() + (CUTOFF_HOURS + 1) * 3_600_000);
    const avisosAntes = await contar(`select count(*)::int as v from public.notifications where organization_id = $1 and event = 'reminder.no_reply'`, [ORG]);

    // Act — o corte, duas vezes: a segunda tem de ser +0.
    const corte = await rodarCortes(depsDoLembrete(depoisDoCorte));
    const segundo = await rodarCortes(depsDoLembrete(depoisDoCorte));

    // Assert — cortou os que NÃO responderam (2, 3 e 4); o 1 respondeu e ficou de fora.
    const doTenant = corte.por_tenant.find((t) => t.organization_id === ORG);
    expect(doTenant?.runs_cut, JSON.stringify(corte)).toBe(3);
    expect(doTenant?.notified).toBe(3);
    expect(doTenant?.tasks_created, "o domínio aceitou create_task de automação — C6 foi decidida sem ninguém saber").toBe(0);
    expect(doTenant?.tasks_denied).toBe(3);
    expect(segundo.runs_cut, "o corte rodou duas vezes sobre o mesmo lembrete").toBe(0);
    const avisosDepois = await contar(`select count(*)::int as v from public.notifications where organization_id = $1 and event = 'reminder.no_reply'`, [ORG]);
    expect(avisosDepois - avisosAntes).toBe(3);

    // A tentativa de tarefa, gravada como o catálogo respondeu:
    const run2 = await runDoContato(2);
    const run4 = await runDoContato(4);
    expect(run2.no_reply_notified_at).not.toBeNull();
    expect(run2.task_id).toBeNull();
    expect(run2.task_denied_code, "com pedido draft, a recusa tem de ser a do domínio (C6)").toBe("non_human_executor_denied");
    expect(run4.task_denied_code, "sem pedido draft não há a que vincular a tarefa").toBe("no_draft_order");
    // ... e AUDITADA como recusa pelo catálogo, com executor automation.
    const recusasAuditadas = await contar(
      `select count(*)::int as v from public.audit_events
        where organization_id = $1 and action_name = 'create_task' and actor_type = 'automation' and result = 'denied'`,
      [ORG],
    );
    expect(recusasAuditadas).toBe(2);
    // O aviso aponta para o lembrete, o cliente e o desfecho da tarefa — só ids e etiquetas.
    const aviso = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from public.notifications where organization_id = $1 and event = 'reminder.no_reply' and payload->>'customer_id' = $2`,
      [ORG, contato(2)],
    );
    expect(aviso.rows[0]?.payload["reminder_run_id"]).toBe(run2.id);
    expect(aviso.rows[0]?.payload["task_denied_code"]).toBe("non_human_executor_denied");
    const jobs = await contar(`select count(*)::int as v from public.job_queue where organization_id = $1 and kind = 'recurring_reminder_cutoff'`, [ORG]);
    expect(jobs, "o corte abriu job sem ter o que cortar").toBe(1);
    passaram.push("S2");
    console.info(
      `reminder-reply-s2: runs_cut=3/3 notified=3/3 tasks_created=0 tasks_denied=3/3 (non_human_executor_denied=2, no_draft_order=1) second_pass=0/0`,
    );
  });

  it("S3: resposta DEPOIS do corte → handoff tenant_rule sem chamar o provedor; o pedido não muda", async () => {
    // Arrange — fixture: o corte do cliente 3 já passou (antecipado por SQL: a
    // entrada usa o relógio real, e esperar 20 h não é prova).
    await pool.query(`update public.reminder_runs set cutoff_at = now() - interval '1 hour' where organization_id = $1 and customer_id = $2`, [ORG, contato(3)]);
    const antes = await quantidadeDoItem(itemDe(3));
    const conversa = await conversaDoContato(3);
    expect(conversa.saas_tags).toEqual(["awaiting_quantity"]);

    // Act 1 — o cliente responde tarde.
    const entrada = await clienteEscreve(3, "pode mandar 25 kg", "3EB0F05RESP03");
    expect(entrada.status).toBe("ingerido");
    const run = await runDoContato(3);
    expect(run.replied_late, "a entrada não marcou a resposta como tardia").toBe(true);

    // Act 2 — o turno, com um provedor que RESPONDERIA: o que o impede é a regra.
    const { registry, estado } = registroQueLeOLembrete();
    const turno = await responderTurno(
      ctx,
      { conversation_id: conversa.id, mensagem_do_cliente: "pode mandar 25 kg" },
      { pool, cfg: CFG_LLM, registry, adapters: { mock: adapterMock }, modo: "mock" },
    );

    // Assert — zero token (a asserção NOMINAL, que o mutante 52 precisa ver
    // vermelha), gente, pedido intacto, lembrete concluído como tardio.
    expect(estado.chamadas, "o turno gastou token numa resposta que a regra manda para gente").toBe(0);
    expect(turno.status).toBe("handoff");
    expect(turno.motivo).toBe("tenant_rule");
    expect(turno.mensagens_enviadas).toBe(0);
    expect(await quantidadeDoItem(itemDe(3)), "resposta tardia mexeu no pedido").toBe(antes);
    expect((await conversaDoContato(3)).saas_state).toBe("waiting_human");
    expect((await conversaDoContato(3)).saas_tags).toEqual([]);
    expect((await runDoContato(3)).concluded_as).toBe("handoff_late_reply");
    const dossie = await pool.query<{ reason: string; intent: string }>(
      `select reason, intent from public.handoffs where organization_id = $1 and conversation_id = $2`,
      [ORG, conversa.id],
    );
    expect(dossie.rows[0]?.reason).toBe("tenant_rule");
    expect(dossie.rows[0]?.intent).toBe("resposta_apos_o_corte_do_lembrete");
    passaram.push("S3");
    console.info(`reminder-reply-s3: replied_late=true handoff=tenant_rule provider_calls=0 quantity=${antes}->${await quantidadeDoItem(itemDe(3))}`);
  });

  it("reminder-reply: scenarios=3 pass=3/3; order_items.quantity conferido por query 2/2", async () => {
    const q1 = await quantidadeDoItem(itemDe(1));
    const q3 = await quantidadeDoItem(itemDe(3));
    expect(passaram).toEqual(["S1", "S2", "S3"]);
    expect(q1).toBe("10.000");
    expect(q3).toBe("1.000");
    console.info(`reminder-reply: scenarios=3 pass=${passaram.length}/3 quantity_checked=2/2 (S1=${q1} S3=${q3})`);
  });
});
