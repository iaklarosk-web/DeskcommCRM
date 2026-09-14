/**
 * F03-T03/T04/T05 — a porta de entrada do SaaS contra um Postgres de verdade.
 *
 * O que este arquivo mede, e por que precisa de banco: resolução de tenant por
 * `channel_accounts`, quarentena de quem não tem dono, idempotência de
 * reentrega pelo ÍNDICE (não pelo TypeScript), a ordem dos efeitos herdados e o
 * estado D16 que a conversa passa a ter. Nenhum POST contra endpoint no ar
 * (G-41): o handler da rota é chamado EM PROCESSO com um `Request` sintético.
 *
 * A métrica do gate (`webhook: replay=2 stored=1 tables_checked=T`) sai daqui.
 */
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarHandlerDeWebhookSaas } from "@/app/api/v1/webhooks/saas/[provider]/route";
import { criarAdapterMock } from "@/src/channels/mock";
import {
  findTransition,
  resolverDeGuardasF03,
  resolveTarget,
  type ConversationState,
  type LegacyStatus,
} from "@/src/conversation";
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
 * Segredo FICTÍCIO deste arquivo. Não é credencial de lugar nenhum: o adapter
 * mock recebe a função que o devolve por injeção, e nada aqui lê `.env`.
 */
const SEGREDO_FICTICIO = "segredo-ficticio-de-teste-f03-0001";

const FIXTURES = path.resolve(__dirname, "../fixtures/waha/2026.7.2");

/** Uma organização por caso: a ordem dos `it` deixa de ser variável escondida. */
const CENARIOS = {
  tenantA: { org: "f0300003-0000-4000-8000-00000000000a", conta: "f03-conta-a" },
  tenantB: { org: "f0300003-0000-4000-8000-00000000000b", conta: "f03-conta-b" },
  idem: { org: "f0300003-0000-4000-8000-00000000000c", conta: "f03-conta-idem" },
  fixtures: { org: "f0300003-0000-4000-8000-00000000000d", conta: "f03-conta-fixtures" },
  pipeline: { org: "f0300003-0000-4000-8000-00000000000e", conta: "f03-conta-pipeline" },
  estado: { org: "f0300003-0000-4000-8000-00000000000f", conta: "f03-conta-estado" },
} as const;

const CONTA_INEXISTENTE = "f03-conta-que-nao-existe";

const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });
const adapterSemSegredo = criarAdapterMock({ segredoDeAssinatura: () => "", pool });

function handlerCom(adapter = adapterMock) {
  return criarHandlerDeWebhookSaas({
    pool,
    adapters: { mock: adapter },
    modo: "mock",
  });
}

function assinar(raw: string): string {
  return createHmac("sha256", SEGREDO_FICTICIO).update(Buffer.from(raw, "utf8")).digest("hex");
}

interface OpcoesDoPost {
  adapter?: ReturnType<typeof criarAdapterMock>;
  /** `false` manda uma assinatura que não confere; `null` omite o cabeçalho. */
  assinatura?: false | null;
  provider?: string;
}

async function postar(corpo: unknown, opcoes: OpcoesDoPost = {}): Promise<Response> {
  const raw = JSON.stringify(corpo);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opcoes.assinatura === false) headers["x-webhook-hmac"] = "00".repeat(32);
  else if (opcoes.assinatura !== null) headers["x-webhook-hmac"] = assinar(raw);

  const provider = opcoes.provider ?? "mock";
  const req = new Request(`http://127.0.0.1/api/v1/webhooks/saas/${provider}`, {
    method: "POST",
    body: raw,
    headers,
  }) as unknown as NextRequest;

  return handlerCom(opcoes.adapter)(req, { params: Promise.resolve({ provider }) });
}

/** A fixture do disco, com a conta trocada — o payload é o mesmo em tudo mais. */
function fixture(nome: string, conta: string): Record<string, unknown> {
  const bruto = JSON.parse(readFileSync(path.join(FIXTURES, nome), "utf8")) as Record<
    string,
    unknown
  >;
  return { ...bruto, session: conta };
}

/** Os nomes de fixture CONTADOS da pasta em tempo de teste (G-26/G-14). */
function nomesDasFixtures(): string[] {
  return readdirSync(FIXTURES)
    .filter((nome) => nome.endsWith(".json"))
    .sort();
}

/**
 * Contagem de linhas de TODAS as tabelas de `public`, com a lista lida de
 * `pg_tables` em tempo de teste (G-26). Uma lista escrita à mão mediria a
 * memória de quem a escreveu, e a tabela que ela esquecesse seria justamente
 * onde a escrita indevida passaria despercebida.
 */
async function snapshotDeContagens(): Promise<Map<string, number>> {
  const tabelas = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const nomes = tabelas.rows.map((linha) => linha.tablename);
  expect(nomes.length, "pg_tables não devolveu tabela nenhuma em public").toBeGreaterThan(10);

  const uniao = nomes
    .map(
      (nome) =>
        `select ${pg.escapeLiteral(nome)} as tabela, count(*)::int as linhas from public.${pg.escapeIdentifier(nome)}`,
    )
    .join(" union all ");
  const contagens = await pool.query<{ tabela: string; linhas: number }>(uniao);
  return new Map(contagens.rows.map((linha) => [linha.tabela, linha.linhas]));
}

function delta(antes: Map<string, number>, depois: Map<string, number>): Map<string, number> {
  const mudou = new Map<string, number>();
  for (const [tabela, valor] of depois) {
    const anterior = antes.get(tabela) ?? 0;
    if (valor !== anterior) mudou.set(tabela, valor - anterior);
  }
  for (const [tabela, valor] of antes) {
    if (!depois.has(tabela) && valor !== 0) mudou.set(tabela, -valor);
  }
  return mudou;
}

async function contar(sql: string, valores: unknown[]): Promise<number> {
  const r = await pool.query<{ n: number }>(sql, valores);
  return r.rows[0]?.n ?? 0;
}

const contatosDe = (org: string) =>
  contar(`select count(*)::int as n from public.contacts where organization_id = $1`, [org]);
const conversasDe = (org: string) =>
  contar(`select count(*)::int as n from public.conversations where organization_id = $1`, [org]);
const mensagensDe = (org: string) =>
  contar(`select count(*)::int as n from public.messages where organization_id = $1`, [org]);
const interacoesDe = (org: string) =>
  contar(
    `select count(*)::int as n from public.event_log
      where organization_id = $1 and event_type = 'ai_agent.dispatch_requested'`,
    [org],
  );

beforeAll(async () => {
  resetCounters();
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const [nome, cenario] of Object.entries(CENARIOS)) {
      await client.query(
        `insert into public.organizations (id, slug, legal_name, display_name)
         values ($1,$2,$3,$4)`,
        [cenario.org, `f03-webhook-${nome}`, `F03 Webhook ${nome}`, `F03 ${nome}`],
      );
      await client.query(
        `insert into public.channel_sessions
           (id, organization_id, waha_session_name, webhook_secret_encrypted)
         values ($1,$2,$3,'\\x00'::bytea)`,
        [sessaoDe(cenario.org), cenario.org, `sessao-${nome}`],
      );
      await client.query(
        `insert into public.channel_accounts
           (organization_id, provider, account_key, status, phone_e164, channel_session_id)
         values ($1,'mock',$2,'active',$3,$4)`,
        [cenario.org, cenario.conta, "+5511900000099", sessaoDe(cenario.org)],
      );
    }
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

/** A sessão herdada de cada organização — derivada, nunca uma segunda lista. */
function sessaoDe(org: string): string {
  return org.replace(/^f0300003-0000/, "f0300003-3000");
}

afterAll(async () => {
  await pool.end();
});

describe("F03-T03 — o tenant vem de channel_accounts, nunca do payload", () => {
  it("resolve as duas contas na organização certa e põe a conta desconhecida em quarentena", async () => {
    // Arrange
    const quarentenaAntes = await contar(
      `select count(*)::int as n from public.webhook_quarantine where account_key = $1`,
      [CONTA_INEXISTENTE],
    );
    const contadorAntes = counterValue("tenant_ctx_rejected", {
      source: "webhook",
      reason: "unknown_account",
    });

    // Act — o MESMO payload, trocando só a conta.
    const respostaA = await postar(fixture("message-texto.json", CENARIOS.tenantA.conta));
    const respostaB = await postar(fixture("message-texto.json", CENARIOS.tenantB.conta));
    const respostaOrfa = await postar(fixture("message-texto.json", CONTA_INEXISTENTE));

    // Assert — a conta órfã vem PRIMEIRO: é o desfecho que dá nome ao caso, e
    // é a asserção que `tests/mutants/36-f03-webhook-quarentena.sh` derruba.
    expect(
      respostaOrfa.status,
      "conta desconhecida não foi para quarentena: a rota não respondeu 202",
    ).toBe(202);
    expect(respostaA.status).toBe(200);
    expect(respostaB.status).toBe(200);

    const naA = await mensagensDe(CENARIOS.tenantA.org);
    const naB = await mensagensDe(CENARIOS.tenantB.org);
    expect(naA, "a conta A não gravou na organização A").toBe(1);
    expect(naB, "a conta B não gravou na organização B").toBe(1);

    const quarentenaDepois = await contar(
      `select count(*)::int as n from public.webhook_quarantine where account_key = $1`,
      [CONTA_INEXISTENTE],
    );
    const contadorDepois = counterValue("tenant_ctx_rejected", {
      source: "webhook",
      reason: "unknown_account",
    });
    const linhasDeQuarentena = quarentenaDepois - quarentenaAntes;
    const contador = contadorDepois - contadorAntes;
    expect(linhasDeQuarentena).toBe(1);
    expect(contador).toBe(1);

    // O corpo da resposta não pode ser um oráculo de tenant.
    const corpoOrfao = JSON.stringify(await respostaOrfa.json());
    expect(corpoOrfao).not.toContain(CENARIOS.tenantA.org);
    expect(corpoOrfao).not.toContain(CENARIOS.tenantB.org);

    const resolvidos = (naA === 1 ? 1 : 0) + (naB === 1 ? 1 : 0);
    console.log(
      `webhook-tenant: resolved=${resolvidos}/2 quarantine_rows=${linhasDeQuarentena} counter=${contador}`,
    );
  });
});

describe("F03-T04 — a reentrega é reconhecida pelo índice, não pelo código", () => {
  it("o segundo POST idêntico produz delta 0 em TODAS as tabelas de public", async () => {
    // Arrange — a lista de tabelas sai de pg_tables AGORA (G-26).
    const payload = fixture("message-texto.json", CENARIOS.idem.conta);
    const antes = await snapshotDeContagens();

    // Act 1 — a entrada de verdade.
    const primeira = await postar(payload);
    expect(primeira.status).toBe(200);
    const depoisDoPrimeiro = await snapshotDeContagens();
    const alteradas = delta(antes, depoisDoPrimeiro);
    const tablesChecked = alteradas.size;

    // Assert 1 — se o primeiro POST mexeu em menos de 4 tabelas, o pipeline não
    // rodou inteiro e a prova de idempotência mediria o nada.
    expect(
      tablesChecked,
      `o primeiro POST mexeu em ${tablesChecked} tabela(s): ${[...alteradas.keys()].join(", ")}`,
    ).toBeGreaterThanOrEqual(4);

    // Act 2 — a reentrega, byte a byte igual.
    const segunda = await postar(payload);
    const depoisDoSegundo = await snapshotDeContagens();

    // Assert 2 — 200 (reentrega é sucesso) e ZERO delta nas tabelas que o
    // primeiro POST alterou.
    expect(segunda.status).toBe(200);
    // A CONTAGEM vem primeiro, antes do corpo da resposta e antes do laço de
    // deltas: é ela que nomeia o defeito ("gravou duas") em vez de descrevê-lo
    // pelo sintoma ("a resposta não disse replay", "a tabela X mexeu"). É esta
    // a asserção que `tests/mutants/35-f03-webhook-idempotencia.sh` derruba.
    const armazenadas = await contar(
      `select count(*)::int as n from public.messages
        where organization_id = $1 and provider = 'mock' and external_id = $2`,
      [CENARIOS.idem.org, (payload.payload as { id: string }).id],
    );
    expect(
      armazenadas,
      `a reentrega gravou uma segunda linha de mensagem: stored=${armazenadas}`,
    ).toBe(1);
    expect(await segunda.json()).toMatchObject({ data: { replay: true } });
    for (const tabela of alteradas.keys()) {
      expect(
        depoisDoSegundo.get(tabela),
        `a reentrega mexeu em public.${tabela}`,
      ).toBe(depoisDoPrimeiro.get(tabela));
    }
    expect(counterValue("webhook_replay_ignored", { provider: "mock" })).toBeGreaterThanOrEqual(1);

    const linha = `webhook: replay=2 stored=${armazenadas} tables_checked=${tablesChecked}`;
    gravarLinhaDoVerify("webhook", linha);
    console.log(linha);
  });

  it("roda a pasta de fixtures inteira e classifica cada desfecho", async () => {
    // Arrange — N contado da pasta, nunca escrito à mão.
    const nomes = nomesDasFixtures();
    const esperado: Record<string, string> = {
      "message-texto.json": "ingerido",
      "message-imagem.json": "ingerido",
      "message-lid-com-telefone.json": "ingerido",
      "message-campo-desconhecido.json": "ingerido",
      "message-lid-sem-telefone.json": "quarentena:lid_without_pn",
      "message-grupo.json": "quarentena:group_chat",
      "message-ack-entregue.json": "ack",
      "message-ack-lido.json": "ack",
    };
    expect(
      Object.keys(esperado).sort(),
      "a pasta de fixtures mudou e o catálogo deste teste não",
    ).toEqual(nomes);

    // Act
    let classificados = 0;
    let contatosAntesDoGrupo = 0;
    for (const nome of nomes) {
      if (nome === "message-grupo.json") {
        contatosAntesDoGrupo = await contatosDe(CENARIOS.fixtures.org);
      }
      const resposta = await postar(fixture(nome, CENARIOS.fixtures.conta));
      const corpo = (await resposta.json()) as { data?: unknown; error?: unknown };

      // Assert — por fixture, com o desfecho nomeado.
      const alvo = esperado[nome];
      expect(alvo, `fixture sem desfecho catalogado: ${nome}`).toBeDefined();
      if (alvo === undefined) throw new Error(`fixture sem desfecho catalogado: ${nome}`);
      if (alvo === "ingerido") {
        expect(resposta.status, `${nome} não foi aceita`).toBe(200);
        expect(corpo).toMatchObject({ data: { accepted: true, replay: false } });
      } else if (alvo === "ack") {
        expect(resposta.status, `${nome} não foi aceita`).toBe(200);
        expect(corpo).toMatchObject({ data: { accepted: true } });
      } else {
        const motivo = alvo.split(":")[1];
        expect(resposta.status, `${nome} devia ir para quarentena com 202`).toBe(202);
        expect(corpo).toMatchObject({ data: { accepted: false, reason: motivo } });
        const linhas = await contar(
          `select count(*)::int as n from public.webhook_quarantine
            where account_key = $1 and reason = $2`,
          [CENARIOS.fixtures.conta, motivo],
        );
        expect(linhas, `${nome} não deixou linha de quarentena com o motivo ${motivo}`).toBe(1);
      }

      if (nome === "message-grupo.json") {
        // Descarte ESPERADO por doutrina — e sem contato órfão atrás.
        expect(
          await contatosDe(CENARIOS.fixtures.org),
          "a mensagem de grupo criou contato",
        ).toBe(contatosAntesDoGrupo);
      }
      classificados += 1;
    }

    expect(classificados).toBe(nomes.length);
    console.log(`fixtures=${nomes.length} parsed=${classificados}`);
  });
});

describe("F03-T05 — o pipeline de entrada, e o que a segunda mensagem NÃO cria", () => {
  it("primeira mensagem cria contato, conversa, mensagem e interação; a segunda só a mensagem", async () => {
    // Arrange
    const org = CENARIOS.pipeline.org;
    const base = fixture("message-texto.json", CENARIOS.pipeline.conta);
    const primeiroPayload = base.payload as Record<string, unknown>;
    const segundo = {
      ...base,
      payload: {
        ...primeiroPayload,
        id: `${String(primeiroPayload.id)}-segunda`,
        body: "segunda mensagem do mesmo numero",
        timestamp: Number(primeiroPayload.timestamp) + 60,
      },
    };
    const antes = {
      contatos: await contatosDe(org),
      conversas: await conversasDe(org),
      mensagens: await mensagensDe(org),
      interacoes: await interacoesDe(org),
    };
    let asserts = 0;

    // Act 1
    expect((await postar(base)).status).toBe(200);
    const meio = {
      contatos: await contatosDe(org),
      conversas: await conversasDe(org),
      mensagens: await mensagensDe(org),
      interacoes: await interacoesDe(org),
    };

    // Assert 1 — quatro deltas de +1.
    for (const chave of ["contatos", "conversas", "mensagens", "interacoes"] as const) {
      expect(meio[chave] - antes[chave], `a 1ª mensagem não somou +1 em ${chave}`).toBe(1);
      asserts += 1;
    }

    // Act 2 — mesmo número, mensagem nova.
    expect((await postar(segundo)).status).toBe(200);
    const depois = {
      contatos: await contatosDe(org),
      conversas: await conversasDe(org),
      mensagens: await mensagensDe(org),
      interacoes: await interacoesDe(org),
    };

    // Assert 2 — o contato e a conversa são os MESMOS; a mensagem e a interação
    // são novas.
    const deltas = {
      customers: depois.contatos - meio.contatos,
      conversations: depois.conversas - meio.conversas,
      messages: depois.mensagens - meio.mensagens,
      interacoes: depois.interacoes - meio.interacoes,
    };
    expect(deltas.customers).toBe(0);
    asserts += 1;
    expect(deltas.conversations).toBe(0);
    asserts += 1;
    expect(deltas.messages).toBe(1);
    asserts += 1;
    expect(deltas.interacoes).toBe(1);
    asserts += 1;

    console.log(
      `inbound: customers=+${deltas.customers} conversations=+${deltas.conversations} ` +
        `messages=+${deltas.messages} (${asserts}/8)`,
    );
    expect(asserts).toBe(8);
  });

  it("a conversa termina no estado que a tabela D16 manda para a guarda observada", async () => {
    // Arrange — o destino NÃO é escrito à mão: sai da tabela e da guarda real.
    const org = CENARIOS.estado.org;
    const ctx: TenantCtx = { organization_id: org, source: "webhook" };

    // Act
    expect((await postar(fixture("message-texto.json", CENARIOS.estado.conta))).status).toBe(200);
    const conversa = await pool.query<{
      id: string;
      status: LegacyStatus;
      saas_state: ConversationState;
      saas_state_entered_at: Date | null;
      last_outbound_at: Date | null;
      service_revision: string;
      contact_id: string;
    }>(
      `select id, status, saas_state, saas_state_entered_at, last_outbound_at,
              service_revision, contact_id
         from public.conversations where organization_id = $1`,
      [org],
    );
    expect(conversa.rows.length).toBe(1);
    const linhaDaConversa = conversa.rows[0];
    if (linhaDaConversa === undefined) throw new Error("a entrada não criou conversa");

    const linhaD16 = findTransition("open", "inbound.message");
    expect(linhaD16, "a tabela D16 não tem inbound.message a partir de open").not.toBeNull();
    const guardas = resolverDeGuardasF03({ pool });
    const guardaSatisfeita =
      linhaD16?.guard === undefined
        ? true
        : await guardas(linhaD16.guard, ctx, linhaDaConversa);
    const esperado = resolveTarget(linhaD16!, guardaSatisfeita);

    // Assert
    expect(esperado, "a tabela D16 não deu destino para a guarda observada").not.toBeNull();
    expect(linhaDaConversa.saas_state).toBe(esperado);
  });
});

describe("F03-T03 — as guardas da rota não escrevem nada", () => {
  it("sem credencial responde 503 e não toca em tabela nenhuma", async () => {
    // Arrange
    const antes = await snapshotDeContagens();

    // Act
    const resposta = await postar(fixture("message-texto.json", CENARIOS.tenantA.conta), {
      adapter: adapterSemSegredo,
    });

    // Assert
    expect(resposta.status).toBe(503);
    const mudou = delta(antes, await snapshotDeContagens());
    expect([...mudou.entries()], "o 503 escreveu em alguma tabela").toEqual([]);
  });

  it("assinatura inválida responde 401 e não toca em tabela nenhuma", async () => {
    // Arrange
    const antes = await snapshotDeContagens();

    // Act
    const resposta = await postar(fixture("message-texto.json", CENARIOS.tenantA.conta), {
      assinatura: false,
    });

    // Assert
    expect(resposta.status).toBe(401);
    const mudou = delta(antes, await snapshotDeContagens());
    expect([...mudou.entries()], "o 401 escreveu em alguma tabela").toEqual([]);
  });
});
