/**
 * F04-T09 — erro do provedor vira handoff, e NÃO vira laço (§5.9, D19; §7.5
 * `provider-error: handoffs=1/1 provider_calls=1`).
 *
 * ─── Por que `provider_calls` é o número que importa ───────────────────────
 *
 * "Sem laço de retry" é a única parte desta task que não se enxerga no
 * resultado: com um `for` de três tentativas em volta da chamada, a conversa
 * terminaria no MESMO `waiting_human`, com o MESMO item de inbox, e nada na tela
 * seria diferente — só a fatura, e só no fim do mês. Por isso o registro do
 * provedor CONTA as próprias chamadas, e a asserção é sobre esse contador, não
 * sobre o desfecho.
 *
 * ─── E o silêncio depois do handoff ───────────────────────────────────────
 *
 * O segundo caso deste arquivo é a regra 19 do AGENTS.md medida onde ela vale:
 * um turno NOVO na conversa que já foi para `waiting_human` não fala, não gasta
 * e não chama o provedor. Sem ele, "handoff" seria só um estado, e não um fim de
 * conversa para a IA.
 *
 * Nada sai para rede: o registro é o mock do SDK (`createFakeRegistry`).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { comoTextoDoProvedor, responderTurno } from "@/src/ai";
import { criarAdapterMock } from "@/src/channels/mock";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import { CFG_LLM, semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG = "f0409999-0000-4000-8000-00000000000a";
const ctx: TenantCtx = { organization_id: ORG, source: "job" };

/** Segredo FICTÍCIO do adapter — não é credencial de lugar nenhum. */
const SEGREDO_FICTICIO = "segredo-ficticio-do-turno-f04-t09-0001";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

const TENANT: ConfigDeTenant = {
  org: ORG,
  slug: "f04-erro-provedor",
  usuario: "f0409999-1000-4000-8000-00000000000a",
  sessao: "f0409999-3000-4000-8000-00000000000a",
  conta: "f04-erro-conta",
  contatos: [
    { id: "f0409999-2100-4000-8000-00000000000a", nome: "Padaria Aurora", telefone: "+5511933000001" },
    { id: "f0409999-2200-4000-8000-00000000000a", nome: "Mercado Bela Vista", telefone: "+5511933000002" },
    { id: "f0409999-2300-4000-8000-00000000000a", nome: "Bar da Esquina", telefone: "+5511933000003" },
  ],
  conversas: [
    {
      id: "f0409999-4100-4000-8000-00000000000a",
      contato: "f0409999-2100-4000-8000-00000000000a",
      estado: "ai_handling",
      statusLegado: "ai_handling",
    },
    {
      id: "f0409999-4200-4000-8000-00000000000a",
      contato: "f0409999-2200-4000-8000-00000000000a",
      estado: "ai_handling",
      statusLegado: "ai_handling",
    },
    // Semeada JÁ em `waiting_human` — o estado em que um handoff deixa a
    // conversa. Assim o caso do silêncio não depende de o caso anterior ter
    // rodado: ele é o que o mutante 44 executa sozinho, com `-t`.
    {
      id: "f0409999-4300-4000-8000-00000000000a",
      contato: "f0409999-2300-4000-8000-00000000000a",
      estado: "waiting_human",
      statusLegado: "pending",
    },
  ],
  produtos: [
    {
      id: "f0409999-5100-4000-8000-00000000000a",
      codigo: "CAFE-01",
      nome: "Café torrado premium",
      preco_cents: 2500,
    },
  ],
  materiais: [
    {
      fonte: "f0409999-6100-4000-8000-00000000000a",
      versao: "f0409999-7100-4000-8000-00000000000a",
      nome: "Entregas e prazos",
      trechos: ["o prazo de entrega para Campinas e de dois dias uteis"],
    },
  ],
  settings: {
    "ai.enabled": true,
    "ai.unknown_answer": "Ainda não tenho essa informação aqui.",
    "ai.confidence_threshold": 0.6,
  },
};

const CONVERSA_QUE_FALHA = TENANT.conversas[0]!.id;
const CONVERSA_QUE_RESPONDE = TENANT.conversas[1]!.id;
const CONVERSA_COM_HUMANO = TENANT.conversas[2]!.id;

/** Registro que CONTA e FALHA: `provider_calls` é medido, não suposto. */
function registroQueFalha() {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    throw new Error("provedor fictício fora do ar (503)");
  });
  return { registry, estado };
}

/** Registro que CONTA e responde — para medir o silêncio depois do handoff. */
function registroQueResponde() {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    return {
      content: [
        {
          type: "text" as const,
          text: comoTextoDoProvedor({
            reply: "Claro, posso ajudar.",
            intent: "saudacao",
            confidence: 0.95,
            tool_calls: [],
            handoff: { wanted: false, reason: null },
          }),
        },
      ],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    };
  });
  return { registry, estado };
}

const contar = async (sql: string, valores: unknown[] = []): Promise<number> => {
  const r = await pool.query<{ v: string | number }>(sql, valores);
  return Number(r.rows[0]?.v ?? 0);
};

const estadoDa = async (conversa: string): Promise<string | null> => {
  const r = await pool.query<{ v: string }>(
    `select saas_state as v from public.conversations where id = $1`,
    [conversa],
  );
  return r.rows[0]?.v ?? null;
};

const deps = (registry: ReturnType<typeof createFakeRegistry>) => ({
  pool,
  cfg: CFG_LLM,
  registry,
  adapters: { mock: adapterMock },
  modo: "mock",
});

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT);
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

describe("F04-T09: erro do provedor → handoff sem laço", () => {
  it("provider-error: handoffs=1/1 provider_calls=1", async () => {
    // Arrange
    const { registry, estado } = registroQueFalha();
    const handoffsAntes = await contar(
      `select count(*)::int as v from public.agent_inbox_items
        where organization_id = $1 and kind = 'handoff'`,
      [ORG],
    );

    // Act — UM turno. O erro do provedor não sobe para quem chamou: ele é um
    // desfecho de negócio, e o desfecho é o handoff.
    const resultado = await responderTurno(
      ctx,
      {
        conversation_id: CONVERSA_QUE_FALHA,
        mensagem_do_cliente: "qual o prazo de entrega para Campinas?",
      },
      deps(registry),
    );

    // Assert 1 — o desfecho, com o motivo do enum de §5.11 (nunca frase, G-78).
    expect(resultado.status).toBe("handoff");
    expect(resultado.motivo).toBe("provider_error");
    expect(resultado.mensagens_enviadas, "a IA falou com o cliente depois de falhar").toBe(0);

    // Assert 2 — SEM LAÇO. É esta linha que separa esta task de um retry mudo.
    expect(
      estado.chamadas,
      "o turno chamou o provedor mais de uma vez — é laço de retry (F04-T09)",
    ).toBe(1);
    expect(resultado.chamadas_ao_modelo).toBe(1);

    // Assert 3 — contra o BANCO (G-35): estado, item de inbox e falha registrada.
    const handoffs =
      (await contar(
        `select count(*)::int as v from public.agent_inbox_items
          where organization_id = $1 and kind = 'handoff' and ref_id = $2`,
        [ORG, CONVERSA_QUE_FALHA],
      )) - 0;
    const totalDeHandoffs = await contar(
      `select count(*)::int as v from public.agent_inbox_items
        where organization_id = $1 and kind = 'handoff'`,
      [ORG],
    );
    const falhas = await contar(
      `select count(*)::int as v from public.llm_calls
        where organization_id = $1 and status = 'erro'`,
      [ORG],
    );

    expect(await estadoDa(CONVERSA_QUE_FALHA)).toBe("waiting_human");
    expect(handoffs, "o handoff não deixou item de inbox na conversa certa").toBe(1);
    expect(totalDeHandoffs - handoffsAntes).toBe(1);
    expect(
      falhas,
      "a falha do provedor não virou linha em llm_calls — a tabela que explica ficou vazia",
    ).toBe(1);
    // Uma chamada que FALHOU não projeta consumo: não há número honesto a
    // projetar quando o SDK lançou (ADR-023, "Consequências").
    expect(
      await contar(
        `select count(*)::int as v from public.ai_usage_events where organization_id = $1`,
        [ORG],
      ),
    ).toBe(0);

    const linha = `provider-error: handoffs=${handoffs}/1 provider_calls=${estado.chamadas}`;
    console.info(linha);
    gravarLinhaDoVerify("provider-error", linha);
  });

  it("em waiting_human a IA não fala: turno silenciado, sem gastar e sem enviar", async () => {
    // Arrange — `waiting_human` é o estado em que o handoff deixa a conversa, e
    // a fixture já a semeia assim: o caso não depende do anterior ter rodado.
    const { registry, estado } = registroQueResponde();
    const mensagensAntes = await contar(
      `select count(*)::int as v from public.messages
        where conversation_id = $1 and direction = 'outbound'`,
      [CONVERSA_COM_HUMANO],
    );

    // Act
    const resultado = await responderTurno(
      ctx,
      { conversation_id: CONVERSA_COM_HUMANO, mensagem_do_cliente: "e aí, alguém responde?" },
      deps(registry),
    );
    const mensagensDepois = await contar(
      `select count(*)::int as v from public.messages
        where conversation_id = $1 and direction = 'outbound'`,
      [CONVERSA_COM_HUMANO],
    );

    // Assert — AGENTS.md regra 19: `ai_messages_after_handoff = 0`, verificado.
    // As duas asserções CONTADAS vêm primeiro: são elas que ficam vermelhas
    // quando a guarda de silêncio some (tests/mutants/44-f04-silencio-da-ia.sh).
    expect(
      mensagensDepois - mensagensAntes,
      "a IA respondeu numa conversa em waiting_human",
    ).toBe(0);
    expect(estado.chamadas, "a IA gastou token numa conversa que já é de uma pessoa").toBe(0);
    expect(resultado.status).toBe("silenciado");
    expect(resultado.motivo).toBe("estado_nao_e_da_ia");
    expect(await estadoDa(CONVERSA_COM_HUMANO), "a conversa saiu de waiting_human").toBe(
      "waiting_human",
    );

    console.info(
      `f04-t09-silencio: ai_messages_after_handoff=${mensagensDepois - mensagensAntes}/0 provider_calls=${estado.chamadas}/0`,
    );
  });

  it("o provedor de volta: a MESMA fixture responde noutra conversa (não é verde por acidente)", async () => {
    // Arrange — sem este caso, "zero mensagens" e "zero chamadas" acima
    // poderiam ser um turno que nunca funciona (G-03).
    const { registry, estado } = registroQueResponde();

    // Act
    const resultado = await responderTurno(
      ctx,
      { conversation_id: CONVERSA_QUE_RESPONDE, mensagem_do_cliente: "bom dia, tudo bem?" },
      deps(registry),
    );

    // Assert
    expect(resultado.status).toBe("respondido");
    expect(estado.chamadas).toBe(1);
    expect(resultado.mensagens_enviadas).toBe(1);
    expect(await estadoDa(CONVERSA_QUE_RESPONDE)).toBe("waiting_customer");
    const saidas = await contar(
      `select count(*)::int as v from public.messages
        where conversation_id = $1 and direction = 'outbound' and sent_via = 'ai'`,
      [CONVERSA_QUE_RESPONDE],
    );
    expect(saidas).toBe(1);
    // O consumo da chamada BEM-SUCEDIDA é registrado uma vez (F04-T08).
    expect(
      await contar(
        `select count(*)::int as v from public.ai_usage_events
          where organization_id = $1 and conversation_id = $2`,
        [ORG, CONVERSA_QUE_RESPONDE],
      ),
    ).toBe(1);

    console.info(
      `f04-t09-controle: provider_calls=${estado.chamadas}/1 saidas=${saidas}/1 estado=waiting_customer`,
    );
  });
});
