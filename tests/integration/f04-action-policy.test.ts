/**
 * F04-T01/T02 — o catálogo e a confirmação `by_risk` contra um Postgres de
 * verdade (§5.8, D17/D18/D33).
 *
 * O que este arquivo mede, e por que precisa de banco: as nove tools de D18
 * executadas PELA IA deixam nove linhas em `audit_events` (invariante 2 de
 * §5.8), as dez células negadas da matriz N × 3 são negadas DE FATO e
 * auditadas, e os três caminhos da confirmação (aprovar, recusar, vencer) levam
 * a conversa aos três destinos que D16 escreve.
 *
 * Nenhum POST contra endpoint no ar (G-41): `execute()`, `confirm()` e
 * `expirarConfirmacoes()` são chamados EM PROCESSO, e o adapter é o `mock`
 * (D12) — nada sai para transporte nenhum.
 *
 * As métricas do gate (`action-policy: …`, `confirmation: …`) saem daqui.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { confirm, expirarConfirmacoes } from "@/src/actions/confirm";
import { execute } from "@/src/actions/execute";
import { ACTION_CATALOG, ACTION_EXECUTORS } from "@/src/actions/catalog";
import { criarAdapterMock } from "@/src/channels/mock";
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
const SEGREDO_FICTICIO = "segredo-ficticio-de-action-policy-f04-0001";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

/** Uma organização por cenário: a ordem dos `it` deixa de ser variável escondida. */
const CENARIOS = {
  catalogo: { org: "f0400001-0000-4000-8000-00000000000a", conta: "f04-catalogo" },
  negado: { org: "f0400001-0000-4000-8000-00000000000b", conta: "f04-negado" },
  confirmacao: { org: "f0400001-0000-4000-8000-00000000000c", conta: "f04-confirmacao" },
} as const;

type NomeDeCenario = keyof typeof CENARIOS;

/** Ids derivados da organização — nunca uma segunda lista para envelhecer. */
const usuarioDe = (org: string) => org.replace(/^f0400001-0000/, "f0400001-1000");
const sessaoDe = (org: string) => org.replace(/^f0400001-0000/, "f0400001-3000");
const contatoDe = (org: string, n: number) => org.replace(/^f0400001-0000/, `f0400001-2${n}00`);
const conversaDe = (org: string, n: number) => org.replace(/^f0400001-0000/, `f0400001-4${n}00`);
const produtoDe = (org: string, n: number) => org.replace(/^f0400001-0000/, `f0400001-5${n}00`);

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
const IA = { kind: "ai" } as const;

const deps = () => ({ pool, adapters: { mock: adapterMock }, modo: "mock" });

async function umValor<T>(sql: string, valores: unknown[]): Promise<T | null> {
  const r = await pool.query<{ v: T }>(sql, valores);
  return r.rows[0]?.v ?? null;
}

const contar = async (sql: string, valores: unknown[]): Promise<number> =>
  Number((await umValor<string | number>(sql, valores)) ?? 0);

const estadoDa = (conversa: string) =>
  umValor<string>(`select saas_state as v from public.conversations where id = $1`, [conversa]);

const assigneeDa = (conversa: string) =>
  umValor<string | null>(`select assigned_to_user_id as v from public.conversations where id = $1`, [
    conversa,
  ]);

const statusDaPendencia = (id: string) =>
  umValor<string>(`select status as v from public.pending_actions where id = $1`, [id]);

const auditoriaDaIa = (org: string) =>
  contar(
    `select count(*)::int as v from public.audit_events
      where organization_id = $1 and actor_type = 'ai'`,
    [org],
  );

/** Quantas conversas cada cenário precisa, e em que estado cada uma nasce. */
const CONVERSAS_POR_CENARIO: Record<NomeDeCenario, readonly number[]> = {
  // 1 send_message · 2 request_confirmation · 3 transfer_to_human ·
  // 4 create_order · 5 update_order_quantity
  catalogo: [1, 2, 3, 4, 5],
  negado: [],
  // 1 aprovar · 2 recusar · 3 vencer
  confirmacao: [1, 2, 3],
};

/** O pedido semeado por cenário, para `get_orders` e `update_order_quantity`. */
const PEDIDO = {
  catalogo: {
    id: "f0400001-6000-4000-8000-00000000000a",
    item: "f0400001-7000-4000-8000-00000000000a",
  },
  confirmacao: {
    id: "f0400001-6000-4000-8000-00000000000c",
    item: "f0400001-7000-4000-8000-00000000000c",
  },
} as const;

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const nomes = Object.keys(CENARIOS) as NomeDeCenario[];
    for (const nome of nomes) {
      const cenario = CENARIOS[nome];
      const indice = nomes.indexOf(nome) + 1;
      await client.query(`insert into auth.users (id, email) values ($1, $2)`, [
        usuarioDe(cenario.org),
        `f04-${nome}@integration.test`,
      ]);
      await client.query(
        `insert into public.organizations (id, slug, legal_name, display_name, status)
         values ($1,$2,$3,$4,'active')`,
        [cenario.org, `f04-${nome}`, `F04 ${nome}`, `F04 ${nome}`],
      );
      await client.query(
        `insert into public.user_organizations
           (organization_id, user_id, role, accepted_at, revoked_at)
         values ($1,$2,'agent',now(),null)`,
        [cenario.org, usuarioDe(cenario.org)],
      );
      // `ai.enabled` é gravada e não deixada no default: a guarda `ai_enabled`
      // lê por PRESENÇA de linha (§5.6/F03), e ausência é "IA não configurada".
      await client.query(
        `insert into public.tenant_settings
           (organization_id, key, value, schema_version, source)
         values ($1,'ai.enabled','true'::jsonb,1,'tenant_admin')`,
        [cenario.org],
      );
      await client.query(
        `insert into public.channel_sessions
           (id, organization_id, waha_session_name, webhook_secret_encrypted)
         values ($1,$2,$3,'\\x00'::bytea)`,
        [sessaoDe(cenario.org), cenario.org, `sessao-f04-${nome}`],
      );
      await client.query(
        `insert into public.channel_accounts
           (organization_id, provider, account_key, status, phone_e164, channel_session_id)
         values ($1,'mock',$2,'active',$3,$4)`,
        [cenario.org, cenario.conta, "+5511900000199", sessaoDe(cenario.org)],
      );
      await client.query(
        `insert into public.catalog_products
           (id, organization_id, codigo, nome, preco_cents, moeda, sale_unit, ativo)
         values ($1,$2,'CAFE-01','Café torrado premium',2500,'BRL','kg',true),
                ($3,$2,'ACU-02','Açúcar cristal',800,'BRL','kg',true)`,
        [produtoDe(cenario.org, 1), cenario.org, produtoDe(cenario.org, 2)],
      );

      for (const n of CONVERSAS_POR_CENARIO[nome]) {
        await client.query(
          `insert into public.contacts (id, organization_id, display_name, phone_number)
           values ($1,$2,$3,$4)`,
          [
            contatoDe(cenario.org, n),
            cenario.org,
            `Contato ${nome} ${n}`,
            // Telefone FICTÍCIO, único por (cenário, conversa).
            `+551190${String(indice).padStart(2, "0")}0000${n}`,
          ],
        );
        await client.query(
          `insert into public.conversations
             (id, organization_id, contact_id, channel_session_id, channel, status,
              is_group, saas_state)
           values ($1,$2,$3,$4,'whatsapp','ai_handling',false,'ai_handling')`,
          [conversaDe(cenario.org, n), cenario.org, contatoDe(cenario.org, n), sessaoDe(cenario.org)],
        );
      }
    }

    // Um pedido `draft` por cenário que precisa dele, com UM item — é o alvo de
    // `get_orders` e de `update_order_quantity`.
    for (const nome of ["catalogo", "confirmacao"] as const) {
      const cenario = CENARIOS[nome];
      const pedido = PEDIDO[nome];
      await client.query(
        `insert into public.crm_orders
           (id, organization_id, contact_id, source, channel, currency, total_cents,
            created_by_actor_type, created_by_actor_id)
         values ($1,$2,$3,'ui','whatsapp','BRL',2500,'user',$4)`,
        [pedido.id, cenario.org, contatoDe(cenario.org, 1), usuarioDe(cenario.org)],
      );
      await client.query(
        `insert into public.crm_order_items
           (id, organization_id, order_id, position, requested_text, product_id,
            product_name_snapshot, sale_unit_snapshot, quantity, unit_price_cents,
            currency_snapshot, line_total_cents)
         values ($1,$2,$3,1,'1kg de café',$4,'Café torrado premium','kg',1.000,2500,'BRL',2500)`,
        [pedido.item, cenario.org, pedido.id, produtoDe(cenario.org, 1)],
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

afterAll(async () => {
  await pool.end();
});

/** A entrada de cada tool, montada com os ids do cenário `catalogo`. */
function entradaDaTool(nome: string, org: string): Record<string, unknown> {
  switch (nome) {
    case "get_customer":
      return { customer_id: contatoDe(org, 1) };
    case "search_products":
      return { query: "café" };
    case "get_orders":
      return { customer_id: contatoDe(org, 1) };
    case "create_order":
      return {
        conversation_id: conversaDe(org, 4),
        customer_id: contatoDe(org, 4),
        idempotency_key: "f04-catalogo-create-order",
        items: [{ requested_text: "2kg de açúcar", product_id: produtoDe(org, 2), quantity: "2" }],
      };
    case "update_order_quantity":
      return {
        conversation_id: conversaDe(org, 5),
        order_id: PEDIDO.catalogo.id,
        item_id: PEDIDO.catalogo.item,
        quantity: "3",
        expected_revision: 1,
        idempotency_key: "f04-catalogo-update-qty",
      };
    case "create_task":
      return {
        order_id: PEDIDO.catalogo.id,
        title: "Conferir a entrega de sexta",
        idempotency_key: "f0400001-8000-4000-8000-00000000000a",
      };
    case "transfer_to_human":
      return {
        conversation_id: conversaDe(org, 3),
        reason: "customer_request",
        summary: "O cliente pediu para falar com uma pessoa.",
      };
    case "request_confirmation":
      return { conversation_id: conversaDe(org, 2), question: "Confirma 2kg de açúcar?" };
    case "send_message":
      return { conversation_id: conversaDe(org, 1), body: "Bom dia! Já anotei o seu pedido." };
    default:
      throw new Error(`entrada de tool não prevista no cenário: ${nome}`);
  }
}

/**
 * O desfecho ESPERADO de cada tool quando quem chama é a IA. É afirmação do
 * teste, escrita à mão de propósito — derivá-la do código faria o caso
 * concordar com qualquer comportamento.
 *
 * `create_task` = `denied` é LIMITE DECLARADO, não defeito escondido: o serviço
 * de tarefa da F02 (`executeLinkedTaskCommand`) exige executor humano com
 * sessão, e abrir a escrita do CRM a executor não-humano é decisão de §5.5 —
 * não desta task. A recusa é auditada como qualquer outra, e é por isso que ela
 * continua contando para `audit_rows`.
 */
const ESPERADO_DA_IA: Readonly<Record<string, "executed" | "pending" | "denied">> = {
  get_customer: "executed",
  search_products: "executed",
  get_orders: "executed",
  create_order: "pending",
  update_order_quantity: "pending",
  create_task: "denied",
  transfer_to_human: "executed",
  request_confirmation: "executed",
  send_message: "executed",
};

describe("F04-T01 — as nove tools de D18 pela IA, todas auditadas", () => {
  it("nove execuções, nove linhas de auditoria com actor_type=ai", async () => {
    // Arrange — as nove saem do CATÁLOGO, não de uma lista paralela.
    const cenario = CENARIOS.catalogo;
    const ctx = ctxDe("catalogo");
    const tools = ACTION_CATALOG.filter((e) => e.executors.includes("ai"));
    expect(tools.length, "o catálogo deixou de ter nove tools de IA").toBe(9);
    const auditoriaAntes = await auditoriaDaIa(cenario.org);

    // Act — uma chamada por tool, cada uma na sua conversa.
    const desfechos = new Map<string, string>();
    for (const entrada of tools) {
      const resultado = await execute(
        ctx,
        IA,
        entrada.name,
        entradaDaTool(entrada.name, cenario.org),
        deps(),
      );
      desfechos.set(entrada.name, resultado.status);
    }

    // Assert 1 — cada tool terminou onde o desenho diz.
    const acertos = tools.filter(
      (e) => desfechos.get(e.name) === ESPERADO_DA_IA[e.name],
    ).length;
    expect(
      Object.fromEntries(desfechos),
      "alguma tool terminou num status diferente do desenhado",
    ).toEqual(ESPERADO_DA_IA);
    expect(acertos).toBe(tools.length);

    // Assert 2 — §5.8, invariante 2: uma linha de auditoria por `execute()` da IA.
    const auditoria = (await auditoriaDaIa(cenario.org)) - auditoriaAntes;
    expect(auditoria, "audit_events não recebeu uma linha por execução da IA").toBe(
      tools.length,
    );

    // Assert 3 — o efeito REAL das que executaram, contra o banco (G-35).
    const mensagens = await contar(
      `select count(*)::int as v from public.messages
        where organization_id = $1 and direction = 'outbound' and sent_via = 'ai'`,
      [cenario.org],
    );
    expect(mensagens, "send_message + request_confirmation deviam ter gravado 2 saídas").toBe(2);
    expect(await estadoDa(conversaDe(cenario.org, 3)), "transfer_to_human não moveu").toBe(
      "waiting_human",
    );
    expect(await estadoDa(conversaDe(cenario.org, 2)), "request_confirmation mudou o estado").toBe(
      "ai_handling",
    );
    const pendentes = await contar(
      `select count(*)::int as v from public.pending_actions
        where organization_id = $1 and status = 'pending'`,
      [cenario.org],
    );
    expect(pendentes, "as duas ações `by_risk` deviam ter virado pendência").toBe(2);
    const handoffs = await contar(
      `select count(*)::int as v from public.agent_inbox_items
        where organization_id = $1 and kind = 'handoff'`,
      [cenario.org],
    );
    expect(handoffs, "o handoff não deixou item de inbox").toBe(1);

    console.info(
      `f04-t01-tools: tools=${tools.length}/9 desfecho_esperado=${acertos}/${tools.length} audit_rows=${auditoria}/${tools.length} saidas=${mensagens}/2 pendencias=${pendentes}/2 handoff=${handoffs}/1`,
    );
  });
});

describe("F04-T01 — executor fora do subset é negado e auditado", () => {
  it("as dez células negadas da matriz N × 3 são negadas DE FATO", async () => {
    // Arrange — as dez (seis de F04, quatro das duas ações LGPD de F06-T03,
    // negadas a `ai` e `automation`) saem do catálogo, não de uma lista à mão.
    const cenario = CENARIOS.negado;
    const ctx = ctxDe("negado");
    const celulasNegadas = ACTION_CATALOG.flatMap((entrada) =>
      ACTION_EXECUTORS.filter((executor) => !entrada.executors.includes(executor)).map(
        (executor) => ({ entrada, executor }),
      ),
    );
    expect(celulasNegadas.length, "a matriz deixou de ter dez células negadas").toBe(10);

    // Act — cada célula é TENTADA. Ler o catálogo provaria o catálogo; o que
    // se quer saber é se `execute()` obedece a ele.
    let negadas = 0;
    for (const { entrada, executor } of celulasNegadas) {
      const resultado = await execute(
        ctx,
        { kind: executor, user_id: executor === "human" ? usuarioDe(cenario.org) : undefined },
        entrada.name,
        // Entrada vazia DE PROPÓSITO: a recusa por executor acontece ANTES da
        // validação de schema (§5.8, a ordem do cabeçalho de `execute.ts`).
        // Se algum dia ela acontecesse depois, este caso ficaria `invalid_input`
        // e o vermelho apontaria para a ordem trocada.
        {},
        deps(),
      );
      expect(
        `${entrada.name}:${executor}:${resultado.status}:${resultado.reason ?? "-"}`,
        `${entrada.name} × ${executor} não foi negado por executor`,
      ).toBe(`${entrada.name}:${executor}:denied:executor_not_allowed`);
      negadas += 1;
    }

    // Assert — e TODAS auditadas: recusa sem rastro é recusa que ninguém conta.
    const auditadas = await contar(
      `select count(*)::int as v from public.audit_events
        where organization_id = $1 and result = 'denied'
          and payload->>'reason' = 'executor_not_allowed'`,
      [cenario.org],
    );
    expect(auditadas, "recusa por executor sem linha em audit_events").toBe(
      celulasNegadas.length,
    );

    // Nome fora do catálogo: `denied`, nunca exceção (§5.8, invariante 4).
    const inventada = await execute(ctx, IA, "drop_database", {}, deps());
    expect(inventada.status).toBe("denied");
    expect(inventada.reason).toBe("unknown_action");
    expect(inventada.audit_id, "recusa de nome inventado sem auditoria").toBeTruthy();

    expect(negadas).toBe(celulasNegadas.length);
    console.info(
      `f04-t01-executor: executor_denied=${negadas}/${celulasNegadas.length} audit_rows=${auditadas}/${celulasNegadas.length} nome_inventado_negado=1/1`,
    );

    // A linha do VERIFY SUMMARY de F04-T01 (§7.5).
    const catalogo = ACTION_CATALOG.length;
    const auditoriaDaIaNoCatalogo = await auditoriaDaIa(CENARIOS.catalogo.org);
    const linha = `action-policy: actions=${catalogo} catalog_total=${catalogo} fields=8/8 executor_denied=${negadas}/${celulasNegadas.length} audit_rows=${auditoriaDaIaNoCatalogo}/9`;
    console.info(linha);
    gravarLinhaDoVerify("action-policy", linha);
    // Doze desde a F06-T03 (dez de F04 + as duas ações LGPD, negadas a `ai` e
    // `automation`: 6 + 4 células). A auditoria da IA no catálogo não muda —
    // a IA nunca vê as duas novas.
    expect(linha).toBe(
      "action-policy: actions=12 catalog_total=12 fields=8/8 executor_denied=10/10 audit_rows=9/9",
    );
  });
});

describe("F04-T02 — os três caminhos da confirmação `by_risk` (D33)", () => {
  it("aprovar: a ação pendente EXECUTA antes, e a conversa volta para ai_handling", async () => {
    // Arrange — a IA pede `create_order`; com o default `medium`, vira pendência.
    const cenario = CENARIOS.confirmacao;
    const ctx = ctxDe("confirmacao");
    const conversa = conversaDe(cenario.org, 1);
    const pedidosAntes = await contar(
      `select count(*)::int as v from public.crm_orders where organization_id = $1`,
      [cenario.org],
    );

    const pedido = await execute(
      ctx,
      IA,
      "create_order",
      {
        conversation_id: conversa,
        customer_id: contatoDe(cenario.org, 1),
        idempotency_key: "f04-confirmacao-aprovar",
        items: [
          { requested_text: "2kg de açúcar", product_id: produtoDe(cenario.org, 2), quantity: "2" },
        ],
      },
      deps(),
    );

    // Assert 1 — a ASSERÇÃO NOMINAL que o mutante 40 derruba: pedido da IA com
    // risco `medium` NÃO executa, fica pendente.
    expect(
      pedido.status,
      "create_order pela IA executou sem confirmação — o gate de by_risk (D33) não está valendo",
    ).toBe("pending");
    expect(await estadoDa(conversa), "a conversa não foi para waiting_confirmation").toBe(
      "waiting_confirmation",
    );
    expect(
      await contar(`select count(*)::int as v from public.crm_orders where organization_id = $1`, [
        cenario.org,
      ]),
      "o pedido foi criado ANTES da aprovação",
    ).toBe(pedidosAntes);

    const pendingId = pedido.pending_action_id as string;
    expect(pendingId, "execute() não devolveu o id da pendência").toBeTruthy();

    // Act — o atendente aprova no inbox.
    const aprovacao = await confirm(ctx, pendingId, "approved", humanoDe("confirmacao"), deps());

    // Assert 2 — executou, fechou a linha e moveu a conversa, nessa ordem.
    expect(aprovacao.status, `a aprovação não executou: ${aprovacao.reason ?? "-"}`).toBe(
      "executed",
    );
    expect(await statusDaPendencia(pendingId)).toBe("approved");
    expect(await estadoDa(conversa), "a conversa não voltou para ai_handling").toBe("ai_handling");
    const pedidosDepois = await contar(
      `select count(*)::int as v from public.crm_orders where organization_id = $1`,
      [cenario.org],
    );
    expect(pedidosDepois, "a aprovação não criou o pedido").toBe(pedidosAntes + 1);
    const criado = await umValor<string>(
      `select status as v from public.crm_orders where id = $1`,
      [String(aprovacao.output?.["order_id"])],
    );
    expect(criado, "o pedido criado pela IA deveria nascer draft (D34)").toBe("draft");

    console.info(
      `f04-t02-aprovar: pendente=1/1 pedido_antes=${pedidosAntes} pedido_depois=${pedidosDepois} estado=ai_handling`,
    );
  });

  it("recusar: a conversa vai para human_handling com o assignee de quem recusou", async () => {
    // Arrange
    const cenario = CENARIOS.confirmacao;
    const ctx = ctxDe("confirmacao");
    const conversa = conversaDe(cenario.org, 2);

    const pedido = await execute(
      ctx,
      IA,
      "update_order_quantity",
      {
        conversation_id: conversa,
        order_id: PEDIDO.confirmacao.id,
        item_id: PEDIDO.confirmacao.item,
        quantity: "5",
        expected_revision: 1,
        idempotency_key: "f04-confirmacao-recusar",
      },
      deps(),
    );
    expect(pedido.status, "update_order_quantity pela IA não virou pendência").toBe("pending");
    const pendingId = pedido.pending_action_id as string;
    const revisaoAntes = await umValor<number>(
      `select revision as v from public.crm_orders where id = $1`,
      [PEDIDO.confirmacao.id],
    );

    // Act
    const recusa = await confirm(ctx, pendingId, "rejected", humanoDe("confirmacao"), deps());

    // Assert — recusa é desfecho NORMAL: a conversa vai para a pessoa, e o
    // domínio NÃO foi tocado.
    expect(recusa.status).toBe("denied");
    expect(recusa.reason).toBe("confirmation_rejected");
    expect(await statusDaPendencia(pendingId)).toBe("rejected");
    expect(await estadoDa(conversa), "a conversa não foi para human_handling").toBe(
      "human_handling",
    );
    expect(await assigneeDa(conversa), "o assignee não é quem recusou").toBe(
      usuarioDe(cenario.org),
    );
    const revisaoDepois = await umValor<number>(
      `select revision as v from public.crm_orders where id = $1`,
      [PEDIDO.confirmacao.id],
    );
    expect(revisaoDepois, "a recusa mexeu no pedido").toBe(revisaoAntes);

    console.info(
      `f04-t02-recusar: pendente=1/1 estado=human_handling assignee=presente revisao_intocada=${revisaoAntes}=${revisaoDepois}`,
    );
  });

  it("vencer: o Job leva a conversa para waiting_human e fecha a pendência", async () => {
    // Arrange — a pendência nasce com o relógio DUAS HORAS atrás, então o prazo
    // (60 min, §5.2) já venceu quando o Job roda com a hora de verdade.
    const cenario = CENARIOS.confirmacao;
    const ctx = ctxDe("confirmacao");
    const conversa = conversaDe(cenario.org, 3);
    const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const pedido = await execute(
      ctx,
      IA,
      "create_order",
      {
        conversation_id: conversa,
        customer_id: contatoDe(cenario.org, 3),
        idempotency_key: "f04-confirmacao-timeout",
        items: [
          { requested_text: "1kg de café", product_id: produtoDe(cenario.org, 1), quantity: "1" },
        ],
      },
      { ...deps(), agora: () => duasHorasAtras },
    );
    expect(pedido.status).toBe("pending");
    const pendingId = pedido.pending_action_id as string;
    const pedidosAntes = await contar(
      `select count(*)::int as v from public.crm_orders where organization_id = $1`,
      [cenario.org],
    );

    // Act — o Job de §5.13 varre as vencidas do tenant.
    const varredura = await expirarConfirmacoes(ctx, deps());

    // Assert
    expect(varredura.vencidas, "o Job não achou a pendência vencida").toBe(1);
    expect(varredura.movidas, "o Job não moveu a conversa").toBe(1);
    expect(await statusDaPendencia(pendingId)).toBe("timeout");
    expect(await estadoDa(conversa), "a conversa não foi para waiting_human").toBe(
      "waiting_human",
    );
    expect(
      await contar(`select count(*)::int as v from public.crm_orders where organization_id = $1`, [
        cenario.org,
      ]),
      "o timeout executou a ação que ninguém aprovou",
    ).toBe(pedidosAntes);

    // Uma pendência NO PRAZO não é tocada pela mesma varredura — sem isto,
    // "expirou tudo" passaria por "expirou a vencida".
    const noPrazo = await execute(
      ctx,
      IA,
      "create_order",
      {
        conversation_id: conversaDe(cenario.org, 1),
        customer_id: contatoDe(cenario.org, 1),
        idempotency_key: "f04-confirmacao-no-prazo",
        items: [
          { requested_text: "1kg de café", product_id: produtoDe(cenario.org, 1), quantity: "1" },
        ],
      },
      deps(),
    );
    expect(noPrazo.status).toBe("pending");
    const segundaVarredura = await expirarConfirmacoes(ctx, deps());
    expect(segundaVarredura.vencidas, "o Job levou uma pendência no prazo").toBe(0);
    expect(await statusDaPendencia(noPrazo.pending_action_id as string)).toBe("pending");

    // A linha do VERIFY SUMMARY de F04-T02 (§7.5). `audit_rows=3` = as três
    // decisões (aprovar, recusar, vencer) deste cenário.
    const decisoes = await contar(
      `select count(*)::int as v from public.audit_events
        where organization_id = $1 and payload ? 'decision'`,
      [cenario.org],
    );
    expect(decisoes, "as três decisões deviam ter deixado uma linha cada").toBe(3);
    const linha = `confirmation: paths=3 pass=3/3 audit_rows=${decisoes}`;
    console.info(linha);
    gravarLinhaDoVerify("confirmation", linha);
    expect(linha).toBe("confirmation: paths=3 pass=3/3 audit_rows=3");
  });
});
