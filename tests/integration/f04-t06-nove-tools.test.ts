/**
 * F04-T06 — as nove tools de D18, três asserções em cada (§5.8/§5.9; §7.5
 * `tools: tools=9 asserts=3 pass=27/27`).
 *
 * As três, e o que cada uma protege:
 *
 *  1. ENTRADA INVÁLIDA é recusada pelo `input_schema` do catálogo — `denied`
 *     com `invalid_input`, nunca exceção (§5.8, invariante 4). Modelo inventa
 *     campo e esquece campo; a régua é o schema, e ela vale para as nove.
 *  2. ID DE OUTRA ORGANIZAÇÃO devolve ZERO linhas. Medido nos dois lados: o que
 *     VOLTA (nenhum id do outro tenant na saída) e o que MUDA (as contagens do
 *     outro tenant, antes e depois, idênticas).
 *  3. NENHUM TEXTO NO FIO fora da conversa ATIVA. A tool é chamada apontando
 *     para uma conversa arquivada quando ela tem conversa, e em todas se conta
 *     `messages` nas OUTRAS conversas: tem de ser zero.
 *
 * Os números saem de `toolsFor(ctx,"ai")` em tempo de teste — `tools=9` é
 * contado, nunca escrito à mão (se o catálogo mudar, a conta muda com ele).
 *
 * ⚠️ `actions.confirm_from_risk` é `high` NESTE tenant de propósito. Com o
 * default `medium` (D33), `create_order` e `update_order_quantity` pedidas pela
 * IA viram PENDÊNCIA e nunca chegam ao domínio — e a asserção 2 mediria a
 * pendência, não o isolamento. Com `high`, as duas chegam ao domínio e são
 * recusadas lá (executor não-humano, limite declarado da F04-T01), que é o
 * caminho em que o id alheio de fato teria chance de ser lido.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execute, toolsFor } from "@/src/actions";
import { criarAdapterMock } from "@/src/channels/mock";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import { semearTenant, uuidsDoObjeto, type ConfigDeTenant } from "./f04-turno-fixtures";

const RAIZ = path.resolve(__dirname, "../..");
const DIR_DAS_TOOLS = "src/actions/tools";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG_A = "f0406666-0000-4000-8000-00000000000a";
const ORG_B = "f0406666-0000-4000-8000-00000000000b";
const ctxA: TenantCtx = { organization_id: ORG_A, source: "job" };

/** Segredo FICTÍCIO do adapter — não é credencial de lugar nenhum. */
const SEGREDO_FICTICIO = "segredo-ficticio-do-turno-f04-t06-0001";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

/** O termo que só existe no catálogo do tenant B. */
const TERMO_DE_B = "guaranazito";

const A: ConfigDeTenant = {
  org: ORG_A,
  slug: "f04-tools-a",
  usuario: "f0406666-1000-4000-8000-00000000000a",
  sessao: "f0406666-3000-4000-8000-00000000000a",
  conta: "f04-tools-conta-a",
  contatos: [
    { id: "f0406666-2001-4000-8000-00000000000a", nome: "Padaria Aurora", telefone: "+5511966000001" },
    { id: "f0406666-2002-4000-8000-00000000000a", nome: "Mercado Bela Vista", telefone: "+5511966000002" },
  ],
  conversas: [
    {
      id: "f0406666-4001-4000-8000-00000000000a",
      contato: "f0406666-2001-4000-8000-00000000000a",
      estado: "ai_handling",
      statusLegado: "ai_handling",
    },
    {
      id: "f0406666-4002-4000-8000-00000000000a",
      contato: "f0406666-2002-4000-8000-00000000000a",
      estado: "archived",
      statusLegado: "archived",
    },
  ],
  produtos: [
    {
      id: "f0406666-5001-4000-8000-00000000000a",
      codigo: "CAFE-01",
      nome: "Café torrado premium",
      preco_cents: 2500,
    },
  ],
  materiais: [],
  pedidos: [
    {
      id: "f0406666-8001-4000-8000-00000000000a",
      item: "f0406666-9001-4000-8000-00000000000a",
      contato: "f0406666-2001-4000-8000-00000000000a",
    },
  ],
  settings: {
    "ai.enabled": true,
    "ai.unknown_answer": "Ainda não tenho essa informação aqui.",
    "ai.confidence_threshold": 0.6,
    // Ver o cabeçalho: sem isto as duas ações de pedido nunca chegam ao domínio.
    "actions.confirm_from_risk": "high",
  },
};

const B: ConfigDeTenant = {
  org: ORG_B,
  slug: "f04-tools-b",
  usuario: "f0406666-1000-4000-8000-00000000000b",
  sessao: "f0406666-3000-4000-8000-00000000000b",
  conta: "f04-tools-conta-b",
  contatos: [
    { id: "f0406666-2001-4000-8000-00000000000b", nome: "Bar do Zé", telefone: "+5511977000001" },
  ],
  conversas: [
    {
      id: "f0406666-4001-4000-8000-00000000000b",
      contato: "f0406666-2001-4000-8000-00000000000b",
      estado: "ai_handling",
      statusLegado: "ai_handling",
    },
  ],
  produtos: [
    {
      id: "f0406666-5001-4000-8000-00000000000b",
      codigo: "REF-09",
      nome: `Refrigerante ${TERMO_DE_B}`,
      preco_cents: 600,
    },
  ],
  materiais: [],
  pedidos: [
    {
      id: "f0406666-8001-4000-8000-00000000000b",
      item: "f0406666-9001-4000-8000-00000000000b",
      contato: "f0406666-2001-4000-8000-00000000000b",
    },
  ],
  settings: { "ai.enabled": true },
};

const CONVERSA_ATIVA = A.conversas[0]!.id;
const CONVERSA_ARQUIVADA = A.conversas[1]!.id;

/** Todo id semeado do tenant B — o conjunto adversário da asserção 2. */
const IDS_DE_B = new Set(
  [
    B.org,
    B.usuario,
    B.sessao,
    ...B.contatos.map((c) => c.id),
    ...B.conversas.map((c) => c.id),
    ...B.produtos.map((p) => p.id),
    ...(B.pedidos ?? []).flatMap((p) => [p.id, p.item]),
  ].map((id) => id.toLowerCase()),
);

const IA = { kind: "ai" } as const;
const deps = () => ({ pool, adapters: { mock: adapterMock }, modo: "mock" });

const contar = async (sql: string, valores: unknown[] = []): Promise<number> => {
  const r = await pool.query<{ v: string | number }>(sql, valores);
  return Number(r.rows[0]?.v ?? 0);
};

/**
 * O estado do tenant B em números. A asserção 2 compara este objeto antes e
 * depois de cada chamada: igualdade é "zero linhas tocadas".
 */
async function retratoDeB(): Promise<Record<string, number | string>> {
  const [mensagens, pedidos, itens, tarefas, inbox, contatos] = await Promise.all([
    contar(`select count(*)::int as v from public.messages where organization_id = $1`, [ORG_B]),
    contar(`select count(*)::int as v from public.crm_orders where organization_id = $1`, [ORG_B]),
    contar(`select count(*)::int as v from public.crm_order_items where organization_id = $1`, [
      ORG_B,
    ]),
    contar(`select count(*)::int as v from public.crm_tasks where organization_id = $1`, [ORG_B]),
    contar(`select count(*)::int as v from public.agent_inbox_items where organization_id = $1`, [
      ORG_B,
    ]),
    contar(`select count(*)::int as v from public.contacts where organization_id = $1`, [ORG_B]),
  ]);
  const estado = await pool.query<{ v: string }>(
    `select saas_state as v from public.conversations where id = $1`,
    [B.conversas[0]!.id],
  );
  const quantidade = await pool.query<{ v: string }>(
    `select quantity::text as v from public.crm_order_items where id = $1`,
    [B.pedidos![0]!.item],
  );
  return {
    mensagens,
    pedidos,
    itens,
    tarefas,
    inbox,
    contatos,
    estado: estado.rows[0]?.v ?? "ausente",
    quantidade: quantidade.rows[0]?.v ?? "ausente",
  };
}

/** A entrada VÁLIDA de cada tool, no tenant A, apontando para a conversa dada. */
function entradaValida(nome: string, conversa: string): Record<string, unknown> {
  switch (nome) {
    case "get_customer":
      return { customer_id: A.contatos[0]!.id };
    case "search_products":
      return { query: "café" };
    case "get_orders":
      return { customer_id: A.contatos[0]!.id };
    case "create_order":
      return {
        conversation_id: conversa,
        customer_id: A.contatos[0]!.id,
        idempotency_key: `f04-t06-create-${conversa}`,
        items: [{ requested_text: "2kg de café", product_id: A.produtos[0]!.id, quantity: "2" }],
      };
    case "update_order_quantity":
      return {
        conversation_id: conversa,
        order_id: A.pedidos![0]!.id,
        item_id: A.pedidos![0]!.item,
        quantity: "3",
        expected_revision: 1,
        idempotency_key: `f04-t06-update-${conversa}`,
      };
    case "create_task":
      return {
        order_id: A.pedidos![0]!.id,
        title: "Conferir a entrega de sexta",
        idempotency_key: randomUUID(),
      };
    case "transfer_to_human":
      return {
        conversation_id: conversa,
        reason: "customer_request",
        summary: "O cliente pediu para falar com uma pessoa.",
      };
    case "request_confirmation":
      return { conversation_id: conversa, question: "Confirma 2kg de café?" };
    case "send_message":
      return { conversation_id: conversa, body: "Bom dia! Já anotei o seu pedido." };
    default:
      throw new Error(`tool sem entrada prevista: ${nome}`);
  }
}

/** A MESMA entrada, com os ids trocados pelos do tenant B. */
function entradaComIdAlheio(nome: string): Record<string, unknown> {
  switch (nome) {
    case "get_customer":
      return { customer_id: B.contatos[0]!.id };
    case "search_products":
      return { query: TERMO_DE_B };
    case "get_orders":
      return { customer_id: B.contatos[0]!.id };
    case "create_order":
      return {
        conversation_id: B.conversas[0]!.id,
        customer_id: B.contatos[0]!.id,
        idempotency_key: "f04-t06-create-alheio",
        items: [
          { requested_text: "2 caixas", product_id: B.produtos[0]!.id, quantity: "2" },
        ],
      };
    case "update_order_quantity":
      return {
        conversation_id: B.conversas[0]!.id,
        order_id: B.pedidos![0]!.id,
        item_id: B.pedidos![0]!.item,
        quantity: "99",
        expected_revision: 1,
        idempotency_key: "f04-t06-update-alheio",
      };
    case "create_task":
      return {
        order_id: B.pedidos![0]!.id,
        title: "Tarefa que não pode existir",
        idempotency_key: randomUUID(),
      };
    case "transfer_to_human":
      return {
        conversation_id: B.conversas[0]!.id,
        reason: "customer_request",
        summary: "Handoff que não pode acontecer.",
      };
    case "request_confirmation":
      return { conversation_id: B.conversas[0]!.id, question: "Confirma?" };
    case "send_message":
      return { conversation_id: B.conversas[0]!.id, body: "Mensagem que não pode sair." };
    default:
      throw new Error(`tool sem entrada alheia prevista: ${nome}`);
  }
}

/**
 * Chama `execute()` e trata exceção como DESFECHO.
 *
 * `transfer_to_human` com conversa de outro tenant sobe `ConversationNotFound`
 * (a tool converte só `IllegalTransition` em recusa) — e, para o que se mede
 * aqui, "lançou" e "negou" são a mesma coisa: nenhuma linha do outro tenant foi
 * lida nem escrita. O desfecho é REGISTRADO, não escondido.
 */
async function executarTolerante(
  nome: string,
  entrada: Record<string, unknown>,
): Promise<{ desfecho: string; output: unknown }> {
  try {
    const resultado = await execute(ctxA, IA, nome, entrada, deps());
    return { desfecho: `${resultado.status}:${resultado.reason ?? "-"}`, output: resultado.output };
  } catch (erro) {
    return { desfecho: `erro:${(erro as Error).name}`, output: null };
  }
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, A);
    await semearTenant(client, B);
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

describe("F04-T06: as nove tools de D18, três asserções cada", () => {
  it("tools: tools=9 asserts=3 pass=27/27", async () => {
    // Arrange — as nove saem do CATÁLOGO em tempo de teste.
    const tools = toolsFor(ctxA, "ai");
    expect(tools.length, "o catálogo deixou de devolver nove tools de IA").toBe(9);

    let invalidas = 0;
    let isoladas = 0;
    let mudas = 0;
    const desfechos: Record<string, string> = {};

    for (const tool of tools) {
      // ── Asserção 1: entrada inválida é recusada pelo schema ───────────────
      const vazia = await execute(ctxA, IA, tool.name, {}, deps());
      expect(
        `${tool.name}:${vazia.status}:${vazia.reason ?? "-"}`,
        `${tool.name}: entrada inválida não foi recusada pelo schema`,
      ).toBe(`${tool.name}:denied:invalid_input`);
      expect(vazia.audit_id, `${tool.name}: recusa sem auditoria`).toBeTruthy();
      invalidas += 1;

      // ── Asserção 2: id de OUTRA organização → zero linhas ─────────────────
      const antes = await retratoDeB();
      const alheia = await executarTolerante(tool.name, entradaComIdAlheio(tool.name));
      const depois = await retratoDeB();
      desfechos[tool.name] = alheia.desfecho;

      expect(depois, `${tool.name}: a chamada com id alheio MUDOU o outro tenant`).toEqual(antes);
      const idsNaSaida = [...uuidsDoObjeto(alheia.output)].filter((id) => IDS_DE_B.has(id));
      expect(idsNaSaida, `${tool.name}: id do outro tenant voltou na saída`).toEqual([]);
      isoladas += 1;

      // ── Asserção 3: nenhum texto no fio fora da conversa ATIVA ────────────
      // Quem tem conversa é chamada contra a ARQUIVADA; quem não tem, com a
      // entrada normal. Nos dois casos, o que se conta é o mesmo.
      await executarTolerante(tool.name, entradaValida(tool.name, CONVERSA_ARQUIVADA));
      const foraDaAtiva = await contar(
        `select count(*)::int as v from public.messages
          where direction = 'outbound' and conversation_id <> $1`,
        [CONVERSA_ATIVA],
      );
      expect(
        foraDaAtiva,
        `${tool.name}: texto no fio fora da conversa ativa`,
      ).toBe(0);
      mudas += 1;
    }

    // Assert final — 9 × 3, com denominador em cada bloco.
    const passaram = invalidas + isoladas + mudas;
    const esperadas = tools.length * 3;
    expect(invalidas).toBe(tools.length);
    expect(isoladas).toBe(tools.length);
    expect(mudas).toBe(tools.length);
    expect(passaram).toBe(esperadas);

    const linha = `tools: tools=${tools.length} asserts=3 pass=${passaram}/${esperadas}`;
    console.info(linha);
    console.info(`f04-t06-desfechos-cross-tenant: ${JSON.stringify(desfechos)}`);
    gravarLinhaDoVerify("tools", linha);
  });

  it("controle: na conversa ATIVA o `send_message` de fato põe texto no fio", async () => {
    // Arrange — sem este caso, `pass=27/27` poderia ser um catálogo que nunca
    // funciona: zero mensagens fora da ativa e zero dentro dela (G-03).
    const antes = await contar(
      `select count(*)::int as v from public.messages
        where conversation_id = $1 and direction = 'outbound' and sent_via = 'ai'`,
      [CONVERSA_ATIVA],
    );

    // Act
    const resultado = await execute(
      ctxA,
      IA,
      "send_message",
      entradaValida("send_message", CONVERSA_ATIVA),
      deps(),
    );

    // Assert
    expect(resultado.status).toBe("executed");
    const depois = await contar(
      `select count(*)::int as v from public.messages
        where conversation_id = $1 and direction = 'outbound' and sent_via = 'ai'`,
      [CONVERSA_ATIVA],
    );
    expect(depois - antes, "o envio na conversa ativa não gravou mensagem").toBe(1);
    console.info(`f04-t06-controle: mensagens_na_ativa=${depois - antes}/1`);
  });

  it("reforço: nem o executor HUMANO do tenant A alcança linha do tenant B", async () => {
    // Arrange — as duas ações de pedido, pela IA, são recusadas pelo EXECUTOR
    // antes do domínio (limite declarado da F04-T01). Com um humano de sessão do
    // tenant A elas chegam ao domínio — e é aí que o isolamento é medido de
    // verdade, não pela recusa que vem antes.
    const ctxHumano: TenantCtx = {
      organization_id: ORG_A,
      user_id: A.usuario,
      role: "agent",
      source: "session",
    };
    const humano = { kind: "human", user_id: A.usuario } as const;
    const antes = await retratoDeB();
    let recusadas = 0;

    // Act + Assert
    for (const nome of ["create_order", "update_order_quantity", "create_task"]) {
      let desfecho: string;
      try {
        const resultado = await execute(
          ctxHumano,
          humano,
          nome,
          entradaComIdAlheio(nome),
          deps(),
        );
        desfecho = `${resultado.status}:${resultado.reason ?? "-"}`;
      } catch (erro) {
        desfecho = `erro:${(erro as Error).name}`;
      }
      expect(desfecho, `${nome}: o humano do tenant A não foi recusado`).not.toMatch(
        /^executed/,
      );
      recusadas += 1;
    }

    const depois = await retratoDeB();
    expect(depois, "o executor humano do tenant A mudou linha do tenant B").toEqual(antes);
    expect(recusadas).toBe(3);
    console.info(`f04-t06-reforco-humano: recusadas=${recusadas}/3 linhas_de_b_alteradas=0`);
  });
});

describe("F04-T06: sem SQL livre e sem HTTP arbitrário nas tools (D18)", () => {
  it("a varredura do diretório das tools devolve ZERO, com denominador", () => {
    // Arrange — o denominador: os arquivos que existem para serem varridos.
    const arquivos = readdirSync(path.join(RAIZ, DIR_DAS_TOOLS)).filter((n) => n.endsWith(".ts"));
    expect(arquivos.length, "o diretório das tools está vazio").toBeGreaterThanOrEqual(4);

    // Act — o comando LITERAL que §7.5 cobra.
    const padrao = "fetch(\\|\\.rpc(\\|sql`";
    const achados = execFileSync(
      "bash",
      ["-c", `grep -rn '${padrao}' ${DIR_DAS_TOOLS} | wc -l`],
      { cwd: RAIZ, encoding: "utf8" },
    ).trim();

    // Assert
    expect(achados, "há chamada de rede, RPC ou SQL literal em src/actions/tools").toBe("0");

    // FIXTURE NEGATIVA (G-51): o instrumento tem de PEGAR quando há o que pegar.
    const isca = execFileSync(
      "bash",
      ["-c", `printf 'a fetch(1)\nb .rpc(2)\nc sql\`3\`\n' | grep -c '${padrao}'`],
      { cwd: RAIZ, encoding: "utf8" },
    ).trim();
    expect(isca, "o padrão da varredura não pega nem os três tokens que ele nomeia").toBe("3");

    const linha = `tools-sql: hits=${achados}/0 arquivos_varridos=${arquivos.length} fixture_negativa=${isca}/3`;
    console.info(linha);
    gravarLinhaDoVerify("tools-sql", linha);
  });
});
