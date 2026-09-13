/**
 * F05-T05 — os SEIS eventos de §5.16 viram aviso POR USUÁRIO e e-mail mock
 * (§5.16, §7.6; D12/D35).
 *
 * ═══ O que este arquivo mede, e por que precisa de Postgres ════════════════
 *
 * A prova de §7.6 é sobre o que FICOU GRAVADO:
 *
 *   `notifications: events=6 rows=6/6 email_outbox=6/6` — um `notify` por
 *   evento, um destinatário por chamada, uma linha em `notifications` e uma em
 *   `email_outbox` por evento, lidas do BANCO.
 *
 * E depois, pelos CAMINHOS REAIS que a F05-T05 ligou — não pela função
 * chamada à mão: o handoff pela tool `transfer_to_human` (fila = 2 pessoas), a
 * confirmação `by_risk` pela `execute()` (fila = 2), a tarefa atribuída pelo
 * serviço da F02 (1 pessoa; quem se atribui a si mesmo não é avisado), a
 * resposta do cliente pelo webhook de entrada numa conversa em `waiting_human`
 * (fila = 2) e o bloqueio do job pelo worker de saída (o `tenant_admin`).
 * `reminder.no_reply` ganha o seu caminho real em F05-T08.
 *
 * Nada sai para rede: o adapter de canal é o mock e o de e-mail é o mock (D12,
 * G-41). `email_outbox` é o que TERIA saído.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execute } from "@/src/actions";
import { ChannelSendFailed, type SaasChannelAdapter } from "@/src/channels/contract";
import { recebeEntrada } from "@/src/channels/inbound";
import { criarAdapterMock } from "@/src/channels/mock";
import { executeLinkedTaskCommand } from "@/src/crm/work/service";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import {
  EVENTOS_DE_NOTIFICACAO,
  marcarLida,
  naoLidas,
  notify,
  notifyFora,
  TEXTO_DO_EMAIL,
  type EventoDeNotificacao,
} from "@/src/notifications";
import { withTenant, type TenantCtx } from "@/src/tenant-context";
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

const ORG = "f0500005-0000-4000-8000-00000000000a";
const ctx: TenantCtx = { organization_id: ORG, source: "job" };

/** Segredo FICTÍCIO do adapter — não é credencial de lugar nenhum. */
const SEGREDO_FICTICIO = "segredo-ficticio-das-notificacoes-f05-0005";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

const FIXTURES = path.join(process.cwd(), "tests/fixtures/waha/2026.7.2");

const contato = (n: number) => `f0500005-2${String(n).padStart(3, "0")}-4000-8000-00000000000a`;
const conversa = (n: number) => `f0500005-4${String(n).padStart(3, "0")}-4000-8000-00000000000a`;

/** O atendente que semeia a fixture (papel herdado `agent` = `attendant`). */
const ATENDENTE_A = "f0500005-1001-4000-8000-00000000000a";
/** O segundo atendente: com ele a fila tem DUAS pessoas, e "+1 por destinatário" tem denominador. */
const ATENDENTE_B = "f0500005-1002-4000-8000-00000000000a";
/** O `tenant_admin` (papel herdado `admin`): é quem recebe `job.blocked`. */
const ADMIN = "f0500005-1003-4000-8000-00000000000a";
/** Um membro REVOGADO: nunca recebe nada — avisar quem saiu é vazar. */
const REVOGADO = "f0500005-1004-4000-8000-00000000000a";

const EMAIL_DE: Record<string, string> = {
  [ATENDENTE_A]: "f05-notif@integration.test",
  [ATENDENTE_B]: "f05-notif-b@integration.test",
  [ADMIN]: "f05-notif-admin@integration.test",
};

const PEDIDO = { id: "f0500005-6000-4000-8000-00000000000a", item: "f0500005-7000-4000-8000-00000000000a" };

const TENANT: ConfigDeTenant = {
  org: ORG,
  slug: "f05-notif",
  usuario: ATENDENTE_A,
  sessao: "f0500005-3000-4000-8000-00000000000a",
  conta: "f05-notif-conta",
  contatos: Array.from({ length: 4 }, (_, i) => ({
    id: contato(i + 1),
    nome: `Cliente F05 Notif ${i + 1}`,
    telefone: `+55119${String(55_000_000 + i).padStart(9, "0")}`,
  })),
  conversas: Array.from({ length: 4 }, (_, i) => ({
    id: conversa(i + 1),
    contato: contato(i + 1),
    estado: "ai_handling",
    statusLegado: "ai_handling",
  })),
  produtos: [
    { id: "f0500005-5001-4000-8000-00000000000a", codigo: "F05N-1", nome: "Café torrado premium", preco_cents: 2500 },
  ],
  materiais: [],
  pedidos: [{ id: PEDIDO.id, item: PEDIDO.item, contato: contato(1) }],
  settings: {
    "ai.enabled": true,
    "notifications.email.enabled": true,
  },
};

const sessaoDe = (userId: string): TenantCtx => ({
  organization_id: ORG,
  user_id: userId,
  role: "agent",
  source: "session",
});

const contar = async (sql: string, valores: unknown[] = []): Promise<number> => {
  const r = await pool.query<{ v: string | number }>(sql, valores);
  return Number(r.rows[0]?.v ?? 0);
};

const avisosDe = (userId: string, evento: string) =>
  contar(
    `select count(*)::int as v from public.notifications
      where organization_id = $1 and user_id = $2 and event = $3`,
    [ORG, userId, evento],
  );

const emailsDe = (userId: string, evento: string) =>
  contar(
    `select count(*)::int as v from public.email_outbox
      where organization_id = $1 and user_id = $2 and event = $3`,
    [ORG, userId, evento],
  );

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT);
    // `semearTenant` cria um usuário só. A fila com um membro não distingue
    // "todos veem" de "o dono vê"; o admin é quem recebe `job.blocked`; o
    // revogado é o controle negativo de "membro ativo".
    await client.query(
      `insert into auth.users (id, email) values ($1,$2),($3,$4),($5,'f05-notif-revogado@integration.test')`,
      [ATENDENTE_B, EMAIL_DE[ATENDENTE_B], ADMIN, EMAIL_DE[ADMIN], REVOGADO],
    );
    await client.query(`update auth.users set email = $2 where id = $1`, [
      ATENDENTE_A,
      EMAIL_DE[ATENDENTE_A],
    ]);
    await client.query(
      `insert into public.user_organizations
         (organization_id, user_id, role, accepted_at, revoked_at)
       values ($1,$2,'agent',now(),null),($1,$3,'admin',now(),null),($1,$4,'agent',now(),now())`,
      [ORG, ATENDENTE_B, ADMIN, REVOGADO],
    );
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

/** O adapter que FALHA `vezes` vezes — o bloqueio do job de saída precisa de três. */
function adapterQueFalha(vezes: number): SaasChannelAdapter {
  let falhas = 0;
  return {
    ...adapterMock,
    async send(ctxEnvio, msg) {
      if (falhas < vezes) {
        falhas += 1;
        throw new ChannelSendFailed("mock", "falha_simulada_de_teste");
      }
      return adapterMock.send(ctxEnvio, msg);
    },
  };
}

/** Um POST do provedor mock, assinado, com o remetente trocado pelo contato dado. */
async function clienteEscreve(telefoneE164: string, corpo: string, idExterno: string) {
  const bruto = JSON.parse(readFileSync(path.join(FIXTURES, "message-texto.json"), "utf8")) as {
    payload: Record<string, unknown>;
  } & Record<string, unknown>;
  const numero = telefoneE164.replace(/^\+/, "");
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
  return recebeEntrada("mock", raw, { "x-webhook-hmac": assinatura, "content-type": "application/json" }, {
    pool,
    adapters: { mock: adapterMock },
    modo: "mock",
  });
}

/** Um destinatário por evento — é o que faz `rows=6/6` e `email_outbox=6/6` serem 1:1. */
const ROTEIRO: readonly { readonly evento: EventoDeNotificacao; readonly para: string; readonly payload: Record<string, unknown> }[] = [
  { evento: "handoff.created", para: ATENDENTE_A, payload: { handoff_id: "h-1", conversation_id: conversa(1), reason: "customer_request" } },
  { evento: "task.assigned", para: ATENDENTE_B, payload: { task_id: "t-1", order_id: PEDIDO.id } },
  { evento: "confirmation.requested", para: ATENDENTE_A, payload: { pending_action_id: "p-1", conversation_id: conversa(2), action_name: "create_order" } },
  { evento: "customer.replied_while_human", para: ATENDENTE_A, payload: { conversation_id: conversa(3), inbound_message_id: "m-1" } },
  { evento: "reminder.no_reply", para: ATENDENTE_A, payload: { customer_id: contato(1), period_key: "2026-W37", reminder_run_id: "r-1" } },
  { evento: "job.blocked", para: ADMIN, payload: { job_id: "j-1", attempts: 3, error: "provider_unreachable" } },
];

describe("F05-T05 — os seis eventos, um aviso por destinatário, e-mail mock por aviso", () => {
  it("notifications: events=6 rows=6/6 email_outbox=6/6", async () => {
    // Arrange — o roteiro cobre o enum inteiro; se um evento entrar em §5.16
    // sem linha aqui, reprova.
    expect([...ROTEIRO].map((r) => r.evento).sort()).toEqual([...EVENTOS_DE_NOTIFICACAO].sort());
    const antesAvisos = await contar(`select count(*)::int as v from public.notifications where organization_id = $1`, [ORG]);
    const antesEmails = await contar(`select count(*)::int as v from public.email_outbox where organization_id = $1`, [ORG]);
    expect(antesAvisos).toBe(0);
    expect(antesEmails).toBe(0);

    // Act — um `notify` por evento, DENTRO de uma transação (como os chamadores).
    let linhas = 0;
    let emails = 0;
    for (const passo of ROTEIRO) {
      const r = await withTenant(
        ctx,
        async (db) => notify(db, ctx, passo.evento, [passo.para], passo.payload),
        { pool },
      );
      expect(r.count, `${passo.evento} não gravou o aviso`).toBe(1);
      expect(r.emails, `${passo.evento} não gravou o e-mail mock`).toBe(1);
      linhas += r.count;
      emails += r.emails;
    }

    // Assert — no BANCO, evento a evento: +1 aviso para o destinatário, +1
    // e-mail para o endereço DELE, com o assunto do evento.
    let conferidos = 0;
    for (const passo of ROTEIRO) {
      expect(await avisosDe(passo.para, passo.evento), `${passo.evento}: aviso do destinatário`).toBe(1);
      const email = await pool.query<{ to_email: string; subject: string; body: string; sent_at: Date | null }>(
        `select to_email, subject, body, sent_at from public.email_outbox
          where organization_id = $1 and user_id = $2 and event = $3`,
        [ORG, passo.para, passo.evento],
      );
      expect(email.rows.length, `${passo.evento}: e-mail do destinatário`).toBe(1);
      expect(email.rows[0]?.to_email).toBe(EMAIL_DE[passo.para]);
      expect(email.rows[0]?.subject).toBe(TEXTO_DO_EMAIL[passo.evento].assunto);
      expect(email.rows[0]?.body, "o corpo não leu o payload").not.toContain("{{");
      expect(email.rows[0]?.sent_at, "mock sem sent_at — 'enviado' no mock é 'gravado'").not.toBeNull();
      conferidos += 1;
    }
    const totalAvisos = await contar(`select count(*)::int as v from public.notifications where organization_id = $1`, [ORG]);
    const totalEmails = await contar(`select count(*)::int as v from public.email_outbox where organization_id = $1`, [ORG]);
    expect(totalAvisos).toBe(ROTEIRO.length);
    expect(totalEmails).toBe(ROTEIRO.length);
    expect(linhas).toBe(ROTEIRO.length);
    expect(emails).toBe(ROTEIRO.length);
    expect(conferidos).toBe(EVENTOS_DE_NOTIFICACAO.length);
    // O membro REVOGADO não recebeu nada, e o payload nunca carregou corpo de mensagem.
    expect(await contar(`select count(*)::int as v from public.notifications where user_id = $1`, [REVOGADO])).toBe(0);

    const linha = `notifications: events=${EVENTOS_DE_NOTIFICACAO.length} rows=${totalAvisos}/${ROTEIRO.length} email_outbox=${totalEmails}/${ROTEIRO.length}`;
    console.info(linha);
    gravarLinhaDoVerify("notifications", linha);
  });

  it("destinatário repetido conta uma vez; lista vazia conta zero e não lança", async () => {
    const repetido = await withTenant(
      ctx,
      async (db) => notify(db, ctx, "task.assigned", [ATENDENTE_B, ATENDENTE_B], { task_id: "t-dup" }),
      { pool },
    );
    const ninguem = await notifyFora(ctx, "task.assigned", [], { task_id: "t-nobody" }, { pool });

    expect(repetido.count, "o mesmo usuário citado duas vezes recebeu dois avisos").toBe(1);
    expect(ninguem.count).toBe(0);
    expect(ninguem.emails).toBe(0);
    console.info("f05-t05-dedup: repetido=1/1 vazio=0/0");
  });

  it("e-mail desligado = aviso in-app sem linha na caixa; `notifications.email.to` redireciona", async () => {
    // Arrange — desliga o e-mail do tenant; o aviso in-app continua SEMPRE.
    const emailsAntes = await contar(`select count(*)::int as v from public.email_outbox where organization_id = $1`, [ORG]);
    await pool.query(
      `update public.tenant_settings set value = 'false'::jsonb
        where organization_id = $1 and key = 'notifications.email.enabled'`,
      [ORG],
    );
    const semEmail = await notifyFora(ctx, "job.blocked", [ADMIN], { job_id: "j-off" }, { pool });

    // Religa com caixa da organização: TODO aviso vai para ela, não para a pessoa.
    await pool.query(
      `update public.tenant_settings set value = 'true'::jsonb
        where organization_id = $1 and key = 'notifications.email.enabled'`,
      [ORG],
    );
    await pool.query(
      `insert into public.tenant_settings (organization_id, key, value, schema_version, source)
       values ($1,'notifications.email.to','"caixa@ficticia.test"'::jsonb,1,'tenant_admin')`,
      [ORG],
    );
    const comCaixa = await notifyFora(ctx, "job.blocked", [ADMIN], { job_id: "j-caixa" }, { pool });
    const destino = await pool.query<{ to_email: string }>(
      `select to_email from public.email_outbox where organization_id = $1 order by created_at desc limit 1`,
      [ORG],
    );
    // Volta ao estado inicial para os casos seguintes.
    await pool.query(`delete from public.tenant_settings where organization_id = $1 and key = 'notifications.email.to'`, [ORG]);

    // Assert
    expect(semEmail.count).toBe(1);
    expect(semEmail.emails, "e-mail desligado e a caixa recebeu linha").toBe(0);
    expect(await contar(`select count(*)::int as v from public.email_outbox where organization_id = $1`, [ORG])).toBe(emailsAntes + 1);
    expect(comCaixa.emails).toBe(1);
    expect(destino.rows[0]?.to_email).toBe("caixa@ficticia.test");
    console.info("f05-t05-email: desligado_in_app=1/1 desligado_email=0/0 caixa_da_org=1/1");
  });

  it("a lista in-app é da pessoa: só o dono lê e só o dono marca como lido", async () => {
    const listaB = await naoLidas(ctx, ATENDENTE_B, { pool });
    expect(listaB.length, "o atendente B não vê os seus avisos").toBeGreaterThanOrEqual(1);
    const alvo = listaB[0]!;

    const marcadoPorA = await marcarLida(ctx, ATENDENTE_A, alvo.id, { pool });
    const marcadoPorB = await marcarLida(ctx, ATENDENTE_B, alvo.id, { pool });
    const deNovo = await marcarLida(ctx, ATENDENTE_B, alvo.id, { pool });
    const depois = await naoLidas(ctx, ATENDENTE_B, { pool });

    expect(marcadoPorA, "A marcou como lido um aviso de B").toBe(0);
    expect(marcadoPorB).toBe(1);
    expect(deNovo, "marcar de novo mudou linha").toBe(0);
    expect(depois.length).toBe(listaB.length - 1);
    expect(depois.some((a) => a.id === alvo.id)).toBe(false);
    console.info(`f05-t05-lista: lidas_por_outro=0/0 lida_pelo_dono=1/1 restantes=${depois.length}/${listaB.length - 1}`);
  });
});

describe("F05-T05 — pelos caminhos reais, não pela função chamada à mão", () => {
  it("transfer_to_human avisa TODA a fila (2 attendants), o admin não, o revogado não", async () => {
    // Arrange
    const alvo = conversa(1);
    const antesA = await avisosDe(ATENDENTE_A, "handoff.created");
    const antesB = await avisosDe(ATENDENTE_B, "handoff.created");

    // Act
    const pedido = await execute(
      ctx,
      { kind: "human", user_id: ATENDENTE_A },
      "transfer_to_human",
      { conversation_id: alvo, reason: "customer_request", summary: "O cliente pediu uma pessoa." },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );

    // Assert — +1 para cada attendant ativo, 0 para quem não é da fila.
    expect(pedido.status).toBe("executed");
    const handoffId = (pedido.output as { handoff_id: string }).handoff_id;
    expect((await avisosDe(ATENDENTE_A, "handoff.created")) - antesA).toBe(1);
    expect((await avisosDe(ATENDENTE_B, "handoff.created")) - antesB).toBe(1);
    expect(await avisosDe(ADMIN, "handoff.created")).toBe(0);
    expect(await avisosDe(REVOGADO, "handoff.created")).toBe(0);
    const comOId = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and event = 'handoff.created' and payload->>'handoff_id' = $2`,
      [ORG, handoffId],
    );
    expect(comOId, "o aviso não aponta para o dossiê").toBe(2);
    expect((await emailsDe(ATENDENTE_B, "handoff.created")), "e-mail ligado e B não recebeu").toBeGreaterThanOrEqual(1);
    console.info(`f05-t05-handoff-real: fila=2/2 admin=0/0 revogado=0/0 com_handoff_id=${comOId}/2`);
  });

  it("create_order pela IA vira pendência e avisa a fila com confirmation.requested", async () => {
    const alvo = conversa(2);
    const antesA = await avisosDe(ATENDENTE_A, "confirmation.requested");
    const antesB = await avisosDe(ATENDENTE_B, "confirmation.requested");

    const resultado = await execute(
      ctx,
      { kind: "ai" },
      "create_order",
      {
        conversation_id: alvo,
        customer_id: contato(2),
        idempotency_key: "f05-notif-create-order",
        items: [{ requested_text: "2kg de café", product_id: TENANT.produtos[0]!.id, quantity: "2" }],
      },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );

    expect(resultado.status, `esperava pendência: ${resultado.reason ?? "-"}`).toBe("pending");
    expect((await avisosDe(ATENDENTE_A, "confirmation.requested")) - antesA).toBe(1);
    expect((await avisosDe(ATENDENTE_B, "confirmation.requested")) - antesB).toBe(1);
    const comPendencia = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and event = 'confirmation.requested' and payload->>'pending_action_id' = $2`,
      [ORG, String(resultado.pending_action_id)],
    );
    expect(comPendencia, "o aviso não aponta para a pendência").toBe(2);
    console.info(`f05-t05-confirmacao-real: fila=2/2 com_pending_action_id=${comPendencia}/2`);
  });

  it("tarefa atribuída avisa o assignee; atribuir a si mesmo não avisa; reatribuir avisa o novo", async () => {
    const antesB = await avisosDe(ATENDENTE_B, "task.assigned");
    const antesA = await avisosDe(ATENDENTE_A, "task.assigned");

    // A cria uma tarefa e a atribui a B.
    const criada = await executeLinkedTaskCommand(
      sessaoDe(ATENDENTE_A),
      { type: "human", user_id: ATENDENTE_A },
      {
        command: "create_linked_task",
        command_id: "f0500005-8001-4000-8000-00000000000a",
        order_id: PEDIDO.id,
        title: "Conferir a entrega",
        priority: "medium",
        assigned_to: ATENDENTE_B,
      },
      { pool },
    );
    // A cria outra e atribui a si mesma: ninguém é avisado do que acabou de fazer.
    const propria = await executeLinkedTaskCommand(
      sessaoDe(ATENDENTE_A),
      { type: "human", user_id: ATENDENTE_A },
      {
        command: "create_linked_task",
        command_id: "f0500005-8002-4000-8000-00000000000a",
        order_id: PEDIDO.id,
        title: "Separar o pedido",
        priority: "low",
        assigned_to: ATENDENTE_A,
      },
      { pool },
    );
    // B reatribui a própria tarefa para A: A é avisada.
    const reatribuida = await executeLinkedTaskCommand(
      sessaoDe(ATENDENTE_B),
      { type: "human", user_id: ATENDENTE_B },
      {
        command: "edit_linked_task",
        command_id: "f0500005-8003-4000-8000-00000000000a",
        task_id: criada.result.task_id,
        expected_revision: criada.result.task_revision,
        assigned_to: ATENDENTE_A,
      },
      { pool },
    );

    expect(criada.replayed).toBe(false);
    expect(propria.replayed).toBe(false);
    expect(reatribuida.replayed).toBe(false);
    expect((await avisosDe(ATENDENTE_B, "task.assigned")) - antesB, "B não foi avisado da tarefa").toBe(1);
    expect((await avisosDe(ATENDENTE_A, "task.assigned")) - antesA, "A: 0 pela própria + 1 pela reatribuição").toBe(1);
    const comTarefa = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and event = 'task.assigned' and payload->>'task_id' = $2`,
      [ORG, criada.result.task_id],
    );
    expect(comTarefa).toBe(2);
    console.info(`f05-t05-tarefa-real: assignee=1/1 a_si_mesmo=0/0 reatribuida=1/1 com_task_id=${comTarefa}/2`);
  });

  it("o cliente responde numa conversa em waiting_human e a FILA é avisada pelo webhook", async () => {
    // Arrange — a conversa 1 foi para a fila no caso do handoff acima e ninguém
    // a assumiu: `donoOuFila` cai na fila (2 attendants).
    const alvo = conversa(1);
    const estado = await pool.query<{ saas_state: string }>(
      `select saas_state from public.conversations where id = $1`,
      [alvo],
    );
    expect(estado.rows[0]?.saas_state, "o cenário exige a conversa 1 em waiting_human").toBe("waiting_human");
    const antesA = await avisosDe(ATENDENTE_A, "customer.replied_while_human");
    const antesB = await avisosDe(ATENDENTE_B, "customer.replied_while_human");

    // Act — o POST do provedor, pelo pipeline de entrada inteiro (§5.7 → §5.6).
    const resultado = await clienteEscreve(TENANT.contatos[0]!.telefone, "alguem me responde?", "3EB0F05NOTIF01");

    // Assert
    expect(resultado.status, `a entrada não foi ingerida: ${JSON.stringify(resultado)}`).toBe("ingerido");
    expect((await avisosDe(ATENDENTE_A, "customer.replied_while_human")) - antesA).toBe(1);
    expect((await avisosDe(ATENDENTE_B, "customer.replied_while_human")) - antesB).toBe(1);
    expect(await avisosDe(ADMIN, "customer.replied_while_human")).toBe(0);
    const comMensagem = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and event = 'customer.replied_while_human'
          and payload->>'conversation_id' = $2 and payload->>'inbound_message_id' is not null`,
      [ORG, alvo],
    );
    expect(comMensagem).toBe(2);
    // O payload aponta para a mensagem e NÃO carrega o texto dela.
    const textoVazado = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and payload::text ilike '%alguem me responde%'`,
      [ORG],
    );
    expect(textoVazado, "o aviso carregou o corpo da mensagem do cliente").toBe(0);
    console.info(`f05-t05-resposta-real: fila=2/2 admin=0/0 com_message_id=${comMensagem}/2 texto_vazado=${textoVazado}/0`);
  });

  it("o job de saída bloqueia na terceira falha e o tenant_admin é avisado pelo worker", async () => {
    // Arrange — uma mensagem humana cuja entrega falha sempre.
    const alvo = conversa(4);
    const adapter = adapterQueFalha(99);
    const envio = await execute(
      ctx,
      { kind: "human", user_id: ATENDENTE_A },
      "send_message",
      { conversation_id: alvo, body: "não vai sair nunca" },
      { pool, adapters: { mock: adapter }, modo: "mock" },
    );
    expect(envio.status).toBe("executed");
    const job = String(envio.output?.["job_id"]);
    const antesAdmin = await avisosDe(ADMIN, "job.blocked");

    // Act — três rodadas; na terceira o job bloqueia (G-15).
    for (let i = 0; i < 3; i += 1) {
      await rodarCicloDeSaida({ pool, adapters: { mock: adapter }, modo: "mock", backoffMs: [0, 0] });
    }

    // Assert — o cartão herdado continua, e o aviso por usuário foi para o admin.
    const statusDoJob = await pool.query<{ status: string }>(`select status from public.job_queue where id = $1`, [job]);
    expect(statusDoJob.rows[0]?.status).toBe("blocked");
    expect((await avisosDe(ADMIN, "job.blocked")) - antesAdmin).toBe(1);
    expect(await avisosDe(ATENDENTE_A, "job.blocked")).toBe(0);
    const cartaoHerdado = await contar(
      `select count(*)::int as v from public.agent_inbox_items
        where organization_id = $1 and kind = 'job_dead' and ref_id = $2`,
      [ORG, job],
    );
    const comJob = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and event = 'job.blocked' and payload->>'job_id' = $2`,
      [ORG, job],
    );
    const textoVazado = await contar(
      `select count(*)::int as v from public.notifications
        where organization_id = $1 and payload::text ilike '%não vai sair nunca%'`,
      [ORG],
    );
    expect(cartaoHerdado, "o cartão herdado job_dead sumiu — a F05 amplia, não substitui").toBe(1);
    expect(comJob).toBe(1);
    expect(textoVazado).toBe(0);
    console.info(`f05-t05-bloqueio-real: admin=1/1 attendant=0/0 cartao_herdado=${cartaoHerdado}/1 com_job_id=${comJob}/1 texto_vazado=${textoVazado}/0`);
  });
});
