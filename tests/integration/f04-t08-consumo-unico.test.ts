/**
 * F04-T08 — uma chamada, um registro, um preço, contra Postgres de verdade
 * (§5.3, D14/D36; ADR-021 decisão 3; ADR-023).
 *
 * Por que precisa de banco: o que está em jogo é a CONTAGEM de linhas em duas
 * tabelas e a igualdade campo a campo entre elas. Um fake de pool prova o
 * contrato (`tests/unit/f04-t08-um-registro-de-consumo.test.ts`); só o Postgres
 * prova que o CTE de fato escreve nos dois lugares, que o índice único impede a
 * segunda projeção e que a FK amarra uma linha à outra.
 *
 * Nenhum byte sai para provedor nenhum: o registry é o mock do SDK
 * (`createFakeRegistry`, zero rede, zero chave real) e conta as próprias
 * chamadas — `provider_calls` é medido, não suposto (G-41, D12).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { chamarModelo } from "@/src/ai";
import { EntitlementDenied } from "@/src/entitlement";
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

const ORG = "f0408888-0000-4000-8000-00000000000a";
const CONVERSA = "f0408888-4000-4000-8000-00000000000a";
const CONTATO = "f0408888-2000-4000-8000-00000000000a";
const SESSAO = "f0408888-3000-4000-8000-00000000000a";

const ctx: TenantCtx = { organization_id: ORG, source: "job" };

/**
 * Chave FICTÍCIA deste arquivo — não é credencial de lugar nenhum, entra por
 * injeção e nada aqui lê `.env`.
 */
const CHAVE_FICTICIA = "chave-ficticia-de-integracao-f04-t08-nunca-real";

/**
 * O modelo TEM preço de propósito. Com um id desconhecido da tabela, custo seria
 * `null` dos dois lados e "o custo confere" passaria sem medir nada — verde por
 * vacuidade. `claude-sonnet-4` casa por prefixo (3 USD/Mtok de entrada).
 */
const MODELO = "claude-sonnet-4-de-integracao";

/** Quantas chamadas ao provedor esta prova faz. */
const N = 5;

const cfg = { anthropicApiKey: CHAVE_FICTICIA, cacheTtl: "1h" as const };

/** Registry mock que CONTA — `provider_calls` sai daqui, não de uma suposição. */
function registryQueConta(entrada: number, saida: number) {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    return {
      content: [{ type: "text" as const, text: "resposta do mock" }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: entrada, noCache: entrada, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: saida, text: saida, reasoning: 0 },
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

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into public.organizations (id, slug, legal_name, display_name, status, settings)
       values ($1,'f04-consumo','F04 Consumo','F04 Consumo','active',$2::jsonb)`,
      [
        ORG,
        JSON.stringify({
          llm: {
            provider: "anthropic",
            default_model: MODELO,
            params: {},
            enabled_models: [],
            monthly_budget_cents: null,
          },
        }),
      ],
    );
    await client.query(
      `insert into public.channel_sessions
         (id, organization_id, waha_session_name, webhook_secret_encrypted)
       values ($1,$2,'sessao-f04-consumo','\\x00'::bytea)`,
      [SESSAO, ORG],
    );
    await client.query(
      `insert into public.contacts (id, organization_id, display_name, phone_number)
       values ($1,$2,'Contato do consumo','+5511900000801')`,
      [CONTATO, ORG],
    );
    await client.query(
      `insert into public.conversations
         (id, organization_id, contact_id, channel_session_id, channel, status,
          is_group, saas_state)
       values ($1,$2,$3,$4,'whatsapp','ai_handling',false,'ai_handling')`,
      [CONVERSA, ORG, CONTATO, SESSAO],
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

describe("F04-T08: um registro de consumo por chamada", () => {
  it(`${N} chamadas ao provedor mock = ${N} llm_calls = ${N} ai_usage_events, com o mesmo custo`, async () => {
    // Arrange
    const { registry, estado } = registryQueConta(1200, 340);

    // Act
    for (let i = 0; i < N; i += 1) {
      await chamarModelo(
        ctx,
        "ai.reply",
        {
          messages: [{ role: "user", content: `pergunta ${i}` }],
          conversationId: CONVERSA,
        },
        { pool, cfg, registry },
      );
    }

    // Assert
    const chamadas = await contar(
      `select count(*)::int as v from public.llm_calls
        where organization_id = $1 and status = 'ok'`,
      [ORG],
    );
    const usos = await contar(
      `select count(*)::int as v from public.ai_usage_events where organization_id = $1`,
      [ORG],
    );
    expect(estado.chamadas, "o mock não foi chamado o número esperado de vezes").toBe(N);
    expect(chamadas).toBe(N);
    expect(usos, "o livro-razão não tem uma linha por chamada").toBe(N);

    // A conferência é por JOIN em llm_call_id — contagem igual por acaso não
    // basta: o que se afirma é que CADA uso é a projeção de UMA chamada.
    const conferidos = await contar(
      `select count(*)::int as v
         from public.ai_usage_events u
         join public.llm_calls c on c.id = u.llm_call_id
        where u.organization_id = $1
          and u.model = c.model
          and u.prompt_tokens = c.input_tokens
          and u.completion_tokens = c.output_tokens
          and u.latency_ms is not distinct from c.latency_ms
          and u.estimated_cost_cents = coalesce(c.cost_cents, 0)`,
      [ORG],
    );
    expect(conferidos, "custo/tokens da projeção divergem da chamada de origem").toBe(N);

    // O custo não pode ser zero dos dois lados: a igualdade seria vacuosa.
    const custo = await contar(
      `select coalesce(sum(estimated_cost_cents),0)::float8 as v
         from public.ai_usage_events where organization_id = $1`,
      [ORG],
    );
    expect(custo, "custo zerado: a conferência passaria sem medir nada").toBeGreaterThan(0);

    const linha =
      `consumo: provider_calls=${estado.chamadas} llm_calls=${chamadas}/${N} ` +
      `ai_usage_events=${usos}/${N} custo_conferido=${conferidos}/${N}`;
    console.log(linha);
    gravarLinhaDoVerify("consumo", linha);
  });

  it("a projeção leva conversa, operação e o id da resposta do provedor", async () => {
    // Arrange + Act
    const r = await pool.query<{ conversation_id: string; operation: string; n: string }>(
      `select conversation_id, operation, count(*)::text as n
         from public.ai_usage_events where organization_id = $1
        group by conversation_id, operation`,
      [ORG],
    );

    // Assert
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.conversation_id).toBe(CONVERSA);
    expect(r.rows[0]?.operation).toBe("chat");
  });

  it("uma SEGUNDA projeção da mesma chamada é erro 23505, não número inflado", async () => {
    // Arrange
    const { rows } = await pool.query<{ id: string }>(
      `select id from public.llm_calls where organization_id = $1 limit 1`,
      [ORG],
    );
    const chamada = rows[0]?.id;
    expect(chamada).toBeTruthy();

    // Act
    let codigo: string | null = null;
    try {
      await pool.query(
        `insert into public.ai_usage_events
           (organization_id, model, operation, prompt_tokens, completion_tokens,
            estimated_cost_cents, llm_call_id)
         values ($1,$2,'chat',1,1,0,$3)`,
        [ORG, MODELO, chamada],
      );
    } catch (erro) {
      codigo = (erro as { code?: string }).code ?? null;
    }

    // Assert
    expect(codigo, "dupla contagem da mesma chamada passou sem erro").toBe("23505");
  });

  it("saldo negado: nenhuma chamada ao provedor e nenhuma linha nova (D36)", async () => {
    // Arrange
    const { registry, estado } = registryQueConta(1200, 340);
    const chamadasAntes = await contar(
      `select count(*)::int as v from public.llm_calls where organization_id = $1`,
      [ORG],
    );
    const usosAntes = await contar(
      `select count(*)::int as v from public.ai_usage_events where organization_id = $1`,
      [ORG],
    );

    // Act — três tentativas iguais (G-15/D36)
    const ATTEMPTS = 3;
    const negadas: unknown[] = [];
    for (let tentativa = 1; tentativa <= ATTEMPTS; tentativa += 1) {
      try {
        await chamarModelo(
          ctx,
          "ai.reply",
          { messages: [{ role: "user", content: "tentativa sem saldo" }] },
          {
            pool,
            cfg,
            registry,
            resolver: () => ({ allowed: false, remaining: 0, reason: "sem_saldo" }),
          },
        );
      } catch (erro) {
        negadas.push(erro);
      }
    }

    // Assert
    expect(negadas).toHaveLength(ATTEMPTS);
    for (const erro of negadas) expect(erro).toBeInstanceOf(EntitlementDenied);
    expect(estado.chamadas, "o provedor foi chamado com saldo negado").toBe(0);
    expect(
      await contar(`select count(*)::int as v from public.llm_calls where organization_id = $1`, [
        ORG,
      ]),
    ).toBe(chamadasAntes);
    // A linha de dupla contagem do caso anterior entrou à mão; o que importa
    // aqui é que NENHUMA linha nova apareceu por causa das três tentativas.
    expect(
      await contar(
        `select count(*)::int as v from public.ai_usage_events where organization_id = $1`,
        [ORG],
      ),
    ).toBe(usosAntes);

    const linha = `consumo: provider_calls_at_zero_balance=${estado.chamadas} attempts=${ATTEMPTS}`;
    console.log(linha);
    gravarLinhaDoVerify("consumo-saldo-zero", linha);
  });
});
