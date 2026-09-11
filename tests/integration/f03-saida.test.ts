/**
 * F03-T06/T07/T08 — o caminho de SAÍDA contra um Postgres de verdade.
 *
 * O que este arquivo mede, e por que precisa de banco: o envio humano pelo
 * catálogo (`src/actions/execute.ts`), a guarda de estado, a fila com retry e
 * bloqueio (`src/jobs/*`), a idempotência por `message_id` — que é de ÍNDICE,
 * não de TypeScript — e o que sobra no banco depois de um envio que falhou até
 * o fim.
 *
 * Nenhum POST contra endpoint no ar (G-41): `execute()` e o worker são chamados
 * EM PROCESSO, e o adapter é o `mock` (D12), que grava em `mock_outbox` em vez
 * de falar com transporte nenhum. Os acks entram pelo pipeline de entrada real
 * (`recebeEntrada`), com as fixtures versionadas de `tests/fixtures/waha/`.
 *
 * As métricas do gate (`outbound: …`, `outbound-failure: …`,
 * `outbound-queue: …`) saem daqui.
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execute } from "@/src/actions/execute";
import { ChannelSendFailed, type SaasChannelAdapter } from "@/src/channels/contract";
import { recebeEntrada } from "@/src/channels/inbound";
import { criarAdapterMock } from "@/src/channels/mock";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import { enqueue } from "@/src/jobs/enqueue";
import { counterValue, resetCounters } from "@/src/obs/counters";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

/**
 * Segredo FICTÍCIO deste arquivo — não é credencial de lugar nenhum. Entra no
 * adapter por injeção; nada aqui lê `.env`.
 */
const SEGREDO_FICTICIO = "segredo-ficticio-de-saida-f03-0001";

const FIXTURES = path.resolve(__dirname, "../fixtures/waha/2026.7.2");

/** Uma organização por cenário: a ordem dos `it` deixa de ser variável escondida. */
const CENARIOS = {
  envio: { org: "f0300006-0000-4000-8000-00000000000a", conta: "f03-saida-envio" },
  guarda: { org: "f0300006-0000-4000-8000-00000000000b", conta: "f03-saida-guarda" },
  retry: { org: "f0300006-0000-4000-8000-00000000000c", conta: "f03-saida-retry" },
  bloqueio: { org: "f0300006-0000-4000-8000-00000000000d", conta: "f03-saida-bloqueio" },
  fila: { org: "f0300006-0000-4000-8000-00000000000e", conta: "f03-saida-fila" },
} as const;

type NomeDeCenario = keyof typeof CENARIOS;

/**
 * Ids derivados da organização — nunca uma segunda lista para envelhecer.
 *
 * O número da conversa entra no SEGUNDO grupo do UUID e não no último: o último
 * é onde mora a letra que distingue as organizações, e sobrescrevê-lo faria
 * dois cenários compartilharem contato (medido: `contacts_pkey` duplicada).
 */
const usuarioDe = (org: string) => org.replace(/^f0300006-0000/, "f0300006-1000");
const sessaoDe = (org: string) => org.replace(/^f0300006-0000/, "f0300006-3000");
const contatoDe = (org: string, n: number) =>
  org.replace(/^f0300006-0000/, `f0300006-2${n}00`);
const conversaDe = (org: string, n: number) =>
  org.replace(/^f0300006-0000/, `f0300006-4${n}00`);

const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

function ctxDe(nome: NomeDeCenario): TenantCtx {
  return {
    organization_id: CENARIOS[nome].org,
    user_id: usuarioDe(CENARIOS[nome].org),
    role: "agent",
    source: "session",
  };
}

const humanoDe = (nome: NomeDeCenario) =>
  ({ kind: "human", user_id: usuarioDe(CENARIOS[nome].org) }) as const;

/**
 * Um adapter que FALHA as `vezes` primeiras chamadas e depois delega ao mock.
 * É o único jeito honesto de exercitar retry: sabotar o banco produziria um
 * vermelho sobre outra coisa.
 */
function adapterQueFalha(vezes: number): SaasChannelAdapter {
  let falhas = 0;
  return {
    ...adapterMock,
    async send(ctx, msg) {
      if (falhas < vezes) {
        falhas += 1;
        throw new ChannelSendFailed("mock", "falha_simulada_de_teste");
      }
      return adapterMock.send(ctx, msg);
    },
  };
}

async function contar(sql: string, valores: unknown[]): Promise<number> {
  const r = await pool.query<{ n: number }>(sql, valores);
  return r.rows[0]?.n ?? 0;
}

async function statusDaMensagem(id: string): Promise<string | null> {
  const r = await pool.query<{ status: string }>(
    `select status from public.messages where id = $1`,
    [id],
  );
  return r.rows[0]?.status ?? null;
}

async function externalIdDaMensagem(id: string): Promise<string | null> {
  const r = await pool.query<{ external_id: string | null }>(
    `select external_id from public.messages where id = $1`,
    [id],
  );
  return r.rows[0]?.external_id ?? null;
}

const outboxDe = (org: string) =>
  contar(`select count(*)::int as n from public.mock_outbox where organization_id = $1`, [org]);

const auditoriaDe = (org: string) =>
  contar(
    `select count(*)::int as n from public.api_audit_log
      where organization_id = $1 and action like 'action.send_message%'`,
    [org],
  );

/** A fixture do disco, com a conta e o id da mensagem trocados. */
function fixtureDeAck(nome: string, conta: string, providerMessageId: string): string {
  const bruto = JSON.parse(readFileSync(path.join(FIXTURES, nome), "utf8")) as {
    payload: Record<string, unknown>;
  } & Record<string, unknown>;
  return JSON.stringify({
    ...bruto,
    session: conta,
    payload: { ...bruto.payload, id: providerMessageId },
  });
}

/**
 * Manda o ack pelo pipeline de entrada REAL. Assinatura sobre os bytes exatos,
 * como o contrato de §5.7 exige.
 */
async function entregarAck(nome: string, conta: string, providerMessageId: string) {
  const raw = fixtureDeAck(nome, conta, providerMessageId);
  const assinatura = createHmac("sha256", SEGREDO_FICTICIO)
    .update(Buffer.from(raw, "utf8"))
    .digest("hex");
  return recebeEntrada("mock", raw, { "x-webhook-hmac": assinatura }, {
    pool,
    adapters: { mock: adapterMock },
    modo: "mock",
  });
}

interface SemeaduraDeConversa {
  readonly n: number;
  readonly status: string;
  readonly saasState: string;
}

const CONVERSAS_POR_CENARIO: Record<NomeDeCenario, readonly SemeaduraDeConversa[]> = {
  envio: [{ n: 1, status: "claimed", saasState: "human_handling" }],
  guarda: [
    { n: 1, status: "resolved", saasState: "resolved" },
    { n: 2, status: "archived", saasState: "archived" },
    { n: 3, status: "claimed", saasState: "human_handling" },
  ],
  retry: [{ n: 1, status: "claimed", saasState: "human_handling" }],
  bloqueio: [{ n: 1, status: "claimed", saasState: "human_handling" }],
  fila: [{ n: 1, status: "claimed", saasState: "human_handling" }],
};

beforeAll(async () => {
  resetCounters();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const nomes = Object.keys(CENARIOS) as NomeDeCenario[];
    for (const [nome, cenario] of Object.entries(CENARIOS) as [
      NomeDeCenario,
      (typeof CENARIOS)[NomeDeCenario],
    ][]) {
      const indice = nomes.indexOf(nome) + 1;
      await client.query(
        `insert into auth.users (id, email) values ($1, $2)`,
        [usuarioDe(cenario.org), `f03-saida-${nome}@integration.test`],
      );
      await client.query(
        `insert into public.organizations (id, slug, legal_name, display_name)
         values ($1,$2,$3,$4)`,
        [cenario.org, `f03-saida-${nome}`, `F03 Saida ${nome}`, `F03 ${nome}`],
      );
      await client.query(
        `insert into public.user_organizations
           (organization_id, user_id, role, accepted_at, revoked_at)
         values ($1,$2,'agent',now(),null)`,
        [cenario.org, usuarioDe(cenario.org)],
      );
      await client.query(
        `insert into public.channel_sessions
           (id, organization_id, waha_session_name, webhook_secret_encrypted)
         values ($1,$2,$3,'\\x00'::bytea)`,
        [sessaoDe(cenario.org), cenario.org, `sessao-saida-${nome}`],
      );
      await client.query(
        `insert into public.channel_accounts
           (organization_id, provider, account_key, status, phone_e164, channel_session_id)
         values ($1,'mock',$2,'active',$3,$4)`,
        [cenario.org, cenario.conta, "+5511900000099", sessaoDe(cenario.org)],
      );

      for (const conversa of CONVERSAS_POR_CENARIO[nome]) {
        await client.query(
          `insert into public.contacts (id, organization_id, display_name, phone_number)
           values ($1,$2,$3,$4)`,
          [
            contatoDe(cenario.org, conversa.n),
            cenario.org,
            `Contato ${nome} ${conversa.n}`,
            // Telefone FICTÍCIO, único por (cenário, conversa): `contacts` tem
            // índice parcial por telefone dentro da organização.
            `+5511${9}0${String(indice).padStart(2, "0")}0000${conversa.n}`,
          ],
        );
        await client.query(
          `insert into public.conversations
             (id, organization_id, contact_id, channel_session_id, channel, status,
              is_group, saas_state)
           values ($1,$2,$3,$4,'whatsapp',$5,false,$6)`,
          [
            conversaDe(cenario.org, conversa.n),
            cenario.org,
            contatoDe(cenario.org, conversa.n),
            sessaoDe(cenario.org),
            conversa.status,
            conversa.saasState,
          ],
        );
      }
    }
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

describe("F03-T06 — o envio humano sai pelo catálogo e o status caminha", () => {
  it("grava 1 linha em mock_outbox, leva a mensagem de queued a read e audita", async () => {
    // Arrange — o adapter observador lê o status DURANTE o envio; é a única
    // forma de ver `sending`, que é transitório por construção.
    const cenario = CENARIOS.envio;
    const ctx = ctxDe("envio");
    const conversa = conversaDe(cenario.org, 1);
    let statusDuranteEnvio: string | null = null;
    let mensagemEmVoo = "";
    const observador: SaasChannelAdapter = {
      ...adapterMock,
      async send(ctxEnvio, msg) {
        statusDuranteEnvio = await statusDaMensagem(mensagemEmVoo);
        return adapterMock.send(ctxEnvio, msg);
      },
    };

    // Act 1 — a Action enfileira; nada saiu ainda.
    const resultado = await execute(
      ctx,
      humanoDe("envio"),
      "send_message",
      { conversation_id: conversa, body: "Bom dia, seu pedido saiu para entrega." },
      { pool, adapters: { mock: observador }, modo: "mock" },
    );
    expect(resultado.status, `execute() recusou o envio humano: ${resultado.reason ?? "-"}`).toBe(
      "executed",
    );
    const mensagem = String(resultado.output?.["message_id"]);
    mensagemEmVoo = mensagem;
    const statusAoEnfileirar = await statusDaMensagem(mensagem);
    expect(statusAoEnfileirar, "a mensagem não nasceu em queued").toBe("queued");
    expect(await outboxDe(cenario.org), "execute() enviou sozinho — devia só enfileirar").toBe(0);

    // Act 2 — o worker entrega.
    const ciclo = await rodarCicloDeSaida({
      pool,
      adapters: { mock: observador },
      modo: "mock",
      backoffMs: [0, 0],
    });
    expect(ciclo.entregues, "o ciclo do worker não entregou o job de saída").toBe(1);

    const statusAposEnvio = await statusDaMensagem(mensagem);
    const providerMessageId = await externalIdDaMensagem(mensagem);
    expect(statusAposEnvio, "a mensagem não chegou a sent").toBe("sent");
    expect(statusDuranteEnvio, "a mensagem não passou por sending antes do adapter").toBe(
      "sending",
    );
    expect(providerMessageId, "a mensagem ficou sem provider_message_id").toBeTruthy();

    // Act 3 — os dois acks das fixtures, que compartilham o mesmo id.
    await entregarAck("message-ack-entregue.json", cenario.conta, providerMessageId as string);
    const aposEntregue = await statusDaMensagem(mensagem);
    await entregarAck("message-ack-lido.json", cenario.conta, providerMessageId as string);
    const aposLido = await statusDaMensagem(mensagem);

    // Assert — as três transições que o desenho nomeia, contadas.
    const caminho = [statusAposEnvio, aposEntregue, aposLido];
    const esperado = ["sent", "delivered", "read"];
    const acertos = caminho.filter((s, i) => s === esperado[i]).length;
    expect(
      caminho,
      `o status de saída não caminhou sent → delivered → read: ${caminho.join(" → ")}`,
    ).toEqual(esperado);

    const outbox = await outboxDe(cenario.org);
    const auditoria = await auditoriaDe(cenario.org);
    expect(outbox, "mock_outbox não tem exatamente uma linha do envio").toBe(1);
    expect(auditoria, "o envio não deixou linha de auditoria (audit: always)").toBe(1);

    const linha = `outbound: mock_outbox=${outbox} status_transitions=${acertos}/3 audit_rows=${auditoria}`;
    console.log(linha);
    console.log(`outbound-status: queued→sending→sent=3/3`);
    gravarLinhaDoVerify("outbound", linha);
  });
});

describe("F03-T06 — a guarda recusa o que não pode sair", () => {
  it("nega conversa resolved, conversa archived e executor fora do subset", async () => {
    // Arrange
    const cenario = CENARIOS.guarda;
    const ctx = ctxDe("guarda");
    const outboxAntes = await outboxDe(cenario.org);

    // Act — três recusas de política, cada uma pelo seu motivo.
    const emResolvida = await execute(
      ctx,
      humanoDe("guarda"),
      "send_message",
      { conversation_id: conversaDe(cenario.org, 1), body: "texto que não deve sair" },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );
    const emArquivada = await execute(
      ctx,
      humanoDe("guarda"),
      "send_message",
      { conversation_id: conversaDe(cenario.org, 2), body: "texto que não deve sair" },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );
    // A ação mudou em F04-T01, e a mudança é do CATÁLOGO, não deste teste.
    //
    // Na F03 `send_message` nascia com `executors: ["human"]` — a IA ainda não
    // tinha `execute()`, e o comentário de `catalog.ts` dizia isso com todas as
    // letras. F04-T01 completou o catálogo com a tabela de §5.8/D18, onde
    // `send_message` é `human, ai, automation`: a IA passar por aquele subset
    // deixou de ser defeito e virou o desenho.
    //
    // O que este caso mede — "executor fora do subset é negado, sem escrita e
    // sem fila" — continua inteiro, e continua sendo medido com a MESMA força:
    // `resume_ai` (D34) é `executors: ["human"]`, e a IA pedindo para devolver a
    // conversa a si mesma é exatamente a tentativa que a política tem de negar.
    const porIa = await execute(
      ctx,
      { kind: "ai" },
      "resume_ai",
      { conversation_id: conversaDe(cenario.org, 3) },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );
    const nomeInventado = await execute(
      ctx,
      humanoDe("guarda"),
      "action_que_nao_existe",
      { conversation_id: conversaDe(cenario.org, 3), body: "texto que não deve sair" },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );

    // Assert — motivo por motivo: "negou" sem causa aprovaria a recusa errada.
    expect(emResolvida.reason, "conversa resolved não foi recusada pela guarda").toBe(
      "conversation_closed",
    );
    expect(emArquivada.reason, "conversa archived não foi recusada pela guarda").toBe(
      "conversation_closed",
    );
    expect(porIa.reason, "a IA passou pelo subset de executores de resume_ai").toBe(
      "executor_not_allowed",
    );
    expect(nomeInventado.reason, "nome fora do catálogo não foi negado (§5.8, inv. 4)").toBe(
      "unknown_action",
    );

    const negados = [emResolvida, emArquivada, porIa].filter(
      (r) => r.status === "denied",
    ).length;
    const auditados = [emResolvida, emArquivada, porIa].filter(
      (r) => r.audit_id.length > 0,
    ).length;
    const outboxDepois = await outboxDe(cenario.org);
    const jobs = await contar(
      `select count(*)::int as n from public.job_queue
        where organization_id = $1 and kind = 'outbound_message'`,
      [cenario.org],
    );
    expect(outboxDepois - outboxAntes, "uma recusa escreveu em mock_outbox").toBe(0);
    expect(jobs, "uma recusa enfileirou job de saída").toBe(0);

    const linhaDaGuarda =
      `outbound-guard: denied=${negados}/3 audited=${auditados}/3 ` +
      `mock_outbox_delta=0/0 unknown_action_denied=1/1`;
    console.log(linhaDaGuarda);
    gravarLinhaDoVerify("outbound-guard", linhaDaGuarda);
  });
});

describe("F03-T07 — retry com backoff e bloqueio na terceira falha", () => {
  it("falha 2×, entrega na 3ª, e deixa três linhas em job_runs", async () => {
    // Arrange
    const cenario = CENARIOS.retry;
    const ctx = ctxDe("retry");
    const adapter = adapterQueFalha(2);

    const resultado = await execute(
      ctx,
      humanoDe("retry"),
      "send_message",
      { conversation_id: conversaDe(cenario.org, 1), body: "vai na terceira" },
      { pool, adapters: { mock: adapter }, modo: "mock" },
    );
    expect(resultado.status).toBe("executed");
    const mensagem = String(resultado.output?.["message_id"]);
    const job = String(resultado.output?.["job_id"]);

    // Act — três rodadas do worker, com backoff zerado (o relógio não é o alvo).
    for (let i = 0; i < 3; i += 1) {
      await rodarCicloDeSaida({ pool, adapters: { mock: adapter }, modo: "mock", backoffMs: [0, 0] });
    }

    // Assert
    const linhaDoJob = await pool.query<{ status: string; attempts: number }>(
      `select status, attempts from public.job_queue where id = $1`,
      [job],
    );
    const tentativas = linhaDoJob.rows[0]?.attempts ?? 0;
    const statusFinal = (await statusDaMensagem(mensagem)) ?? "-";
    const corridas = await contar(
      `select count(*)::int as n from public.job_runs where job_id = $1`,
      [job],
    );
    const desfechos = await pool.query<{ outcome: string | null }>(
      `select outcome from public.job_runs where job_id = $1 order by attempt`,
      [job],
    );

    expect(
      tentativas,
      `o retry não chegou à terceira tentativa: attempts=${tentativas} final=${statusFinal}`,
    ).toBe(3);
    expect(
      statusFinal,
      `o envio não terminou entregue: attempts=${tentativas} final=${statusFinal}`,
    ).toBe("sent");
    expect(corridas, `job_runs não registrou uma linha por tentativa: ${corridas}/3`).toBe(3);
    expect(desfechos.rows.map((l) => l.outcome)).toEqual(["erro", "erro", "ok"]);
    expect(await outboxDe(cenario.org), "a entrega bem-sucedida não gravou em mock_outbox").toBe(1);

    const linha = `outbound-failure: attempts=${tentativas} final=${statusFinal} job_runs=${corridas}/3`;
    console.log(linha);
    gravarLinhaDoVerify("outbound-failure", linha);
  });

  it("falha 3×, bloqueia o job, registra o erro e avisa um humano", async () => {
    // Arrange
    const cenario = CENARIOS.bloqueio;
    const ctx = ctxDe("bloqueio");
    const adapter = adapterQueFalha(99);

    const resultado = await execute(
      ctx,
      humanoDe("bloqueio"),
      "send_message",
      { conversation_id: conversaDe(cenario.org, 1), body: "não vai sair nunca" },
      { pool, adapters: { mock: adapter }, modo: "mock" },
    );
    const mensagem = String(resultado.output?.["message_id"]);
    const job = String(resultado.output?.["job_id"]);

    // Act — três rodadas; a quarta prova que nada mais roda sozinho (G-15).
    for (let i = 0; i < 3; i += 1) {
      await rodarCicloDeSaida({ pool, adapters: { mock: adapter }, modo: "mock", backoffMs: [0, 0] });
    }
    const quartaRodada = await rodarCicloDeSaida({
      pool,
      adapters: { mock: adapter },
      modo: "mock",
      backoffMs: [0, 0],
    });

    // Assert
    const linhaDoJob = await pool.query<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>(`select status, attempts, last_error from public.job_queue where id = $1`, [job]);
    const estado = linhaDoJob.rows[0];
    const tentativas = estado?.attempts ?? 0;
    const statusDoJob = estado?.status ?? "-";
    const erroRegistrado = (estado?.last_error ?? "").length > 0 ? 1 : 0;
    const avisos = await contar(
      `select count(*)::int as n from public.agent_inbox_items
        where organization_id = $1 and kind = 'job_dead' and ref_id = $2`,
      [cenario.org, job],
    );
    const corridas = await contar(
      `select count(*)::int as n from public.job_runs where job_id = $1`,
      [job],
    );

    expect(
      statusDoJob,
      `o job não bloqueou na terceira falha: final=${statusDoJob} esperado=blocked`,
    ).toBe("blocked");
    expect(tentativas, `o bloqueio veio com attempts=${tentativas}, esperado 3`).toBe(3);
    expect(corridas, `job_runs não registrou as três tentativas: ${corridas}/3`).toBe(3);
    expect(erroRegistrado, "o job bloqueou sem last_error registrado").toBe(1);
    expect(avisos, "o bloqueio não avisou ninguém (notify(job.blocked))").toBe(1);
    expect(
      quartaRodada.reivindicados,
      "o job bloqueado foi reivindicado de novo na quarta rodada",
    ).toBe(0);
    expect(await outboxDe(cenario.org), "um envio que falhou 3× chegou ao mock_outbox").toBe(0);

    // O erro registrado é NORMALIZADO — nem o corpo da mensagem nem o telefone.
    const erro = estado?.last_error ?? "";
    expect(erro, "o erro gravado vazou o corpo da mensagem").not.toContain("não vai sair nunca");
    expect(erro, "o erro gravado vazou telefone").not.toMatch(/\+?55\d{6,}/);

    const linha =
      `outbound-failure: attempts=${tentativas} final=${statusDoJob} ` +
      `error_logged=${erroRegistrado}/1 notified=${avisos}/1`;
    console.log(linha);
    gravarLinhaDoVerify("outbound-blocked", linha);

    // Nada se perde: a mensagem continua no banco, declarada `failed`, e o job
    // continua consultável. "Sumiu" e "falhou" não podem ser indistinguíveis.
    const statusDaLinha = await statusDaMensagem(mensagem);
    const jobConsultavel = await contar(
      `select count(*)::int as n from public.job_queue where id = $1 and organization_id = $2`,
      [job, cenario.org],
    );
    expect(statusDaLinha, "a mensagem sumiu ou ficou sem estado depois do bloqueio").toBe(
      "failed",
    );
    expect(jobConsultavel, "o job bloqueado sumiu da fila").toBe(1);
    const linhaDaIntegridade =
      `outbound-integridade: message_rows=1/1 message_status=${statusDaLinha} ` +
      `job_rows=${jobConsultavel}/1 job_runs=${corridas}/3`;
    console.log(linhaDaIntegridade);
    gravarLinhaDoVerify("outbound-integridade", linhaDaIntegridade);
  });
});

describe("F03-T08 — a fila recusa job sem tenant e não envia duas vezes", () => {
  it("recusa e conta dois payloads sem organization_id, e enfileira a mesma mensagem uma vez só", async () => {
    // Arrange
    const cenario = CENARIOS.fila;
    const ctx = ctxDe("fila");
    const contadorAntes = counterValue("tenant_ctx_rejected", { source: "job" });

    // Act 1 — dois payloads sem tenant. Recusa é ERRO, nunca `null` silencioso.
    let recusados = 0;
    for (const payload of [
      { message_id: "f0300006-9000-4000-8000-000000000001" },
      {
        conversation_id: conversaDe(cenario.org, 1),
        message_id: "f0300006-9000-4000-8000-000000000002",
      },
    ]) {
      try {
        await enqueue(ctx, "outbound_message", payload, { pool });
      } catch {
        recusados += 1;
      }
    }
    const contador = counterValue("tenant_ctx_rejected", { source: "job" }) - contadorAntes;
    const jobsOrfaos = await contar(
      `select count(*)::int as n from public.job_queue
        where kind = 'outbound_message' and payload->>'organization_id' is null`,
      [],
    );

    // Act 2 — a MESMA mensagem enfileirada duas vezes.
    const resultado = await execute(
      ctx,
      humanoDe("fila"),
      "send_message",
      { conversation_id: conversaDe(cenario.org, 1), body: "uma vez só" },
      { pool, adapters: { mock: adapterMock }, modo: "mock" },
    );
    const mensagem = String(resultado.output?.["message_id"]);
    const primeiro = String(resultado.output?.["job_id"]);
    const segundo = await enqueue(
      ctx,
      "outbound_message",
      {
        organization_id: cenario.org,
        conversation_id: conversaDe(cenario.org, 1),
        message_id: mensagem,
        to_e164: "+5511900000123",
        provider: "mock",
        account_key: cenario.conta,
        idempotency_key: mensagem,
      },
      { pool },
    );

    await rodarCicloDeSaida({
      pool,
      adapters: { mock: adapterMock },
      modo: "mock",
      backoffMs: [0, 0],
    });

    // Assert
    const jobs = await contar(
      `select count(*)::int as n from public.job_queue
        where organization_id = $1 and kind = 'outbound_message'`,
      [cenario.org],
    );
    const enviados = await outboxDe(cenario.org);
    const enviosDuplicados = Math.max(enviados - 1, 0);

    expect(
      recusados,
      `a fila aceitou payload sem organization_id: rejected_without_tenant=${recusados}/2`,
    ).toBe(2);
    expect(
      contador,
      `a recusa não foi contada: tenant_ctx_rejected{source=job} subiu ${contador}, esperado 2`,
    ).toBe(2);
    expect(jobsOrfaos, "job sem tenant chegou a ser gravado na fila").toBe(0);
    expect(segundo.created, "o segundo enqueue da mesma mensagem criou um job novo").toBe(false);
    expect(segundo.job_id, "o segundo enqueue devolveu outro job").toBe(primeiro);
    expect(jobs, "a mesma mensagem gerou mais de um job de saída").toBe(1);
    expect(
      enviosDuplicados,
      `a mesma mensagem saiu mais de uma vez: duplicate_sends=${enviosDuplicados}/2`,
    ).toBe(0);

    const linha = `outbound-queue: rejected_without_tenant=${recusados}/2 duplicate_sends=${enviosDuplicados}/2`;
    console.log(linha);
    gravarLinhaDoVerify("outbound-queue", linha);
  });
});

describe("F03-T06 — src/actions é o único que chama adapter.send (§5.7, inv. 3)", () => {
  /**
   * A ÚNICA exceção conhecida, nomeada: `src/channels/waha.ts` IMPLEMENTA o
   * `send` do contrato embrulhando o adapter herdado (ADR-017 decisão 1). Ele é
   * o outro lado do contrato, não um chamador que fura o catálogo.
   *
   * A exceção é uma LISTA e não um filtro de pasta de propósito: `src/channels/`
   * inteira liberada deixaria o pipeline de entrada passar a enviar sem que
   * ninguém percebesse.
   */
  const EXCECOES_DECLARADAS = ["src/channels/waha.ts"];

  it("o grep do invariante não acha chamador fora de src/actions", () => {
    // Arrange — o grep LITERAL de §5.7, rodado agora sobre a árvore.
    let saida = "";
    try {
      saida = execFileSync("grep", ["-rn", "\\.send(", "src/"], {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
      });
    } catch (erro) {
      // grep sem match sai 1 — e zero ocorrência é um resultado válido aqui.
      const status = (erro as { status?: number }).status;
      if (status !== 1) throw erro;
    }

    const ocorrencias = saida.split("\n").filter((l) => l.trim().length > 0);
    const arquivos = ocorrencias.map((l) => l.split(":")[0] ?? "");
    const foraDeActions = arquivos.filter((a) => !a.startsWith("src/actions/"));
    const violacoes = foraDeActions.filter((a) => !EXCECOES_DECLARADAS.includes(a));
    const dentroDeActions = arquivos.length - foraDeActions.length;

    // Assert
    expect(
      violacoes,
      `módulo fora de src/actions/ chama adapter.send: ${violacoes.join(", ")}`,
    ).toEqual([]);
    expect(
      [...new Set(foraDeActions)].sort(),
      "a lista de implementações do contrato mudou — confira se a nova é adapter ou chamador",
    ).toEqual(EXCECOES_DECLARADAS);
    // Sem esta linha a prova ficaria verde num mundo onde NINGUÉM envia.
    expect(dentroDeActions, "src/actions/ não chama adapter.send — o catálogo ficou sem envio").
      toBeGreaterThan(0);

    const linhaDoGrep =
      `send-allowlist: matches=${arquivos.length} in_actions=${dentroDeActions} ` +
      `adapter_impl=${foraDeActions.length} violations=${violacoes.length}/${arquivos.length}`;
    console.log(linhaDoGrep);
    gravarLinhaDoVerify("send-allowlist", linhaDoGrep);
  });
});
