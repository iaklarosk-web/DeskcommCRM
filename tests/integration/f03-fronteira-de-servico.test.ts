/**
 * F03-T05 — a fronteira herdada precede a máquina D16.
 *
 * `fn_service_inbound` desiste em silêncio quando a mensagem chega ANTES do
 * fechamento do atendimento (`m.sent_at <= c.service_closed_at`): não carimba
 * `messages.service_revision` e deixa a conversa terminal. É a janela de
 * serviço do ServiceBoundary, que a ADR-016 manda preservar.
 *
 * O DEFEITO que este arquivo trava: sem consultar esse carimbo, a transição
 * rodava a partir de `archived`, e a linha D16 desse par declara o efeito
 * `new_conversation` — que o schema herdado não comporta, porque
 * `uniq_conversations_1to1_per_contact_session` admite UMA conversa por
 * contato e sessão. O resultado observado era HTTP 500 numa mensagem legítima
 * de cliente, com a linha gravada e a transação desfeita pelo erro.
 *
 * A prova tem as duas metades de propósito. Só a metade "fora da janela"
 * passaria também num sistema que recusasse TODA mensagem — por isso a segunda
 * metade manda uma mensagem posterior ao fechamento e exige que ela reabra.
 */
import { createHmac } from "node:crypto";

import type { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarHandlerDeWebhookSaas } from "@/app/api/v1/webhooks/saas/[provider]/route";
import { criarAdapterMock } from "@/src/channels/mock";
import { counterTotal, resetCounters } from "@/src/obs/counters";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT ausente: rode por scripts/test-integration.sh");
const port = Number(rawPort);

const pool = new pg.Pool({
  host: "127.0.0.1",
  port,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  max: 4,
});

const SEGREDO_FICTICIO = "segredo-ficticio-de-teste-f03-0002";
const ORG = "f0300004-0000-4000-8000-00000000000a";
const SESSAO = "f0300004-3000-4000-8000-00000000000a";
const CONTA = "f03-conta-fronteira";
const TELEFONE = "5511900000123@c.us";

/** Novembro de 2023: garantidamente anterior a qualquer fechamento desta suíte. */
const CARIMBO_ANTIGO = 1_700_000_000;

const adapter = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });
const handler = criarHandlerDeWebhookSaas({ pool, adapters: { mock: adapter }, modo: "mock" });

function envelope(idDaMensagem: string, carimbo: number): Record<string, unknown> {
  return {
    event: "message.any",
    session: CONTA,
    payload: {
      id: `false_${TELEFONE}_${idDaMensagem}`,
      from: TELEFONE,
      to: "5511900000099@c.us",
      fromMe: false,
      body: "mensagem da prova de fronteira",
      type: "chat",
      hasMedia: false,
      timestamp: carimbo,
      _data: {
        pushName: "Cliente Ficticio Fronteira",
        key: { remoteJid: "5511900000123@s.whatsapp.net", fromMe: false, id: idDaMensagem },
        message: { conversation: "mensagem da prova de fronteira" },
      },
    },
  };
}

async function postar(corpo: unknown): Promise<Response> {
  const raw = JSON.stringify(corpo);
  const req = new Request("http://127.0.0.1/api/v1/webhooks/saas/mock", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-webhook-hmac": createHmac("sha256", SEGREDO_FICTICIO)
        .update(Buffer.from(raw, "utf8"))
        .digest("hex"),
    },
  }) as unknown as NextRequest;
  return handler(req, { params: Promise.resolve({ provider: "mock" }) });
}

async function conversaDaOrg(): Promise<{ id: string; status: string; saas_state: string }> {
  const r = await pool.query<{ id: string; status: string; saas_state: string }>(
    `select id, status, saas_state from public.conversations where organization_id = $1`,
    [ORG],
  );
  expect(r.rows, "a suíte espera exatamente uma conversa nesta organização").toHaveLength(1);
  return r.rows[0]!;
}

async function mensagensDaOrg(): Promise<Array<{ external_id: string; service_revision: string | null }>> {
  const r = await pool.query<{ external_id: string; service_revision: string | null }>(
    `select external_id, service_revision from public.messages
      where organization_id = $1 order by sent_at asc`,
    [ORG],
  );
  return r.rows;
}

beforeAll(async () => {
  resetCounters();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into public.organizations (id, slug, legal_name, display_name)
       values ($1,'f03-fronteira','F03 Fronteira','F03 Fronteira')`,
      [ORG],
    );
    await client.query(
      `insert into public.channel_sessions
         (id, organization_id, waha_session_name, webhook_secret_encrypted)
       values ($1,$2,'sessao-fronteira','\\x00'::bytea)`,
      [SESSAO, ORG],
    );
    await client.query(
      `insert into public.channel_accounts
         (organization_id, provider, account_key, status, phone_e164, channel_session_id)
       values ($1,'mock',$2,'active','+5511900000099',$3)`,
      [ORG, CONTA, SESSAO],
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

describe("F03-T05 — mensagem fora da janela de serviço não derruba a rota", () => {
  it("arquiva a conversa, recebe uma mensagem anterior ao fechamento e responde 200 sem mover nada", async () => {
    // Arrange — primeira mensagem abre o atendimento; depois ele é arquivado.
    const primeira = await postar(envelope("F03FRONT001", Math.floor(Date.now() / 1000)));
    expect(primeira.status, await primeira.text().catch(() => "")).toBe(200);

    const aberta = await conversaDaOrg();
    await pool.query(`select public.fn_service_status($1::uuid,$2::uuid,'archived')`, [
      ORG,
      aberta.id,
    ]);
    const arquivada = await conversaDaOrg();
    expect(arquivada.status, "o preparo não arquivou a conversa").toBe("archived");
    expect(arquivada.saas_state, "a projeção não acompanhou o arquivamento").toBe("archived");

    resetCounters();
    const antes = (await mensagensDaOrg()).length;

    // Act — mensagem cujo envio é ANTERIOR ao fechamento.
    //
    // O `catch` traduz a exceção para a MESMA frase da asserção de status. Sem
    // ele, a regressão que este teste trava (a transição alcançar `archived` e
    // levantar `EffectNotImplemented`) apareceria como um stack trace cru, e o
    // vermelho não diria qual contrato quebrou. Rota que cai e rota que devolve
    // 500 são o mesmo defeito para quem manda a mensagem.
    const atrasada = await postar(envelope("F03FRONT002", CARIMBO_ANTIGO)).catch((erro: unknown) => {
      throw new Error(
        `mensagem fora da janela derrubou a rota: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    });

    // Assert — 200, mensagem gravada, conversa parada, fato contado.
    expect(atrasada.status, "mensagem fora da janela derrubou a rota").toBe(200);
    const corpo = (await atrasada.json()) as { data?: { in_service_window?: boolean } };
    expect(corpo.data?.in_service_window).toBe(false);

    const mensagens = await mensagensDaOrg();
    expect(mensagens.length, "a mensagem fora da janela não foi gravada").toBe(antes + 1);
    const gravada = mensagens.find((m) => m.external_id.includes("F03FRONT002"));
    expect(gravada, "a linha da mensagem atrasada sumiu").toBeDefined();
    expect(
      gravada!.service_revision,
      "a fronteira herdada atribuiu a mensagem a um atendimento fechado",
    ).toBeNull();

    const depois = await conversaDaOrg();
    expect(depois.status, "mensagem atrasada reabriu o atendimento legado").toBe("archived");
    expect(depois.saas_state, "mensagem atrasada moveu o estado D16").toBe("archived");
    expect(
      counterTotal("conversation_inbound_fora_da_fronteira"),
      "o fato não foi contado",
    ).toBe(1);

    console.log(
      "fronteira: fora_da_janela=1/1 http=200 gravada=1/1 movimentos=0/1 contador=1/1",
    );
  });

  it("mensagem posterior ao fechamento reabre — a guarda não recusa tudo", async () => {
    // Arrange — a conversa continua arquivada do caso anterior.
    const antes = await conversaDaOrg();
    expect(antes.saas_state).toBe("archived");
    resetCounters();

    // Act — agora o envio é POSTERIOR ao fechamento.
    const nova = await postar(envelope("F03FRONT003", Math.floor(Date.now() / 1000) + 60));

    // Assert — a reabertura é da RPC herdada, e o estado D16 acompanha.
    expect(nova.status).toBe(200);
    const corpo = (await nova.json()) as { data?: { in_service_window?: boolean } };
    expect(corpo.data?.in_service_window, "a mensagem nova também caiu fora da janela").toBeUndefined();

    const depois = await conversaDaOrg();
    expect(depois.status, "a RPC herdada não reabriu o atendimento").not.toBe("archived");
    expect(depois.saas_state, "o estado D16 ficou preso em archived").not.toBe("archived");
    expect(
      counterTotal("conversation_inbound_fora_da_fronteira"),
      "a mensagem dentro da janela foi contada como fora",
    ).toBe(0);

    console.log("fronteira: dentro_da_janela=1/1 reaberta=1/1 contador=0/1");
  });
});
