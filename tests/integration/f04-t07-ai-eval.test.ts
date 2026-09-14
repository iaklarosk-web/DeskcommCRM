/**
 * F04-T07 — `pnpm ai:eval`: os 30 casos de `docs/ai-eval/cases.yaml` contra um
 * Postgres de verdade, com `AI_PROVIDER=mock` (§5.9, §7.5, ADR-022, G-35).
 *
 * ═══ O veredito sai do BANCO, nunca do texto ════════════════════════════════
 *
 * G-35: "teste de IA compara com o registro-fonte no banco, nunca com a
 * coerência do texto". Cada caso confere QUATRO coisas, e as quatro são
 * consultas:
 *
 *   estado final  → `conversations.saas_state`
 *   ações         → `audit_events` (result = 'executed', pelo `request_id` do caso)
 *   texto         → `messages.body` comparado com o REGISTRO que o caso endereça
 *                   (`tenant_settings`, `catalog_products`, `ai_chunks`)
 *   motivo        → `agent_inbox_items.title` do handoff (§5.11)
 *
 * `must_not_contain` é a contrapartida: o fato do vizinho não pode aparecer em
 * NENHUMA mensagem do tenant que perguntou — é assim que os cinco casos
 * `cross_tenant` medem isolamento em vez de boa vontade do modelo.
 *
 * ═══ Por que a linha `ai_eval:` nasce aqui ══════════════════════════════════
 *
 * ADR-022 decisão 2: o gate lê `.verify-logs/metrics/ai-eval.line`, gravada pela
 * própria suíte. `pnpm ai:eval` (scripts/ai-eval.ts) é a porta de linha de
 * comando para ESTE arquivo — uma implementação, duas entradas. O nome do
 * ARQUIVO é `ai-eval` e o rótulo do CAMPO é `ai_eval:`: a divergência é a
 * decisão 3 daquela ADR, não um descuido.
 *
 * Nada sai para rede: o registro é o mock do SDK (`createFakeRegistry`), que
 * CONTA as próprias chamadas, e o adapter de canal é o `mock` (D12, G-41).
 */
import pg from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { comoTextoDoProvedor, responderTurno } from "@/src/ai";
import { criarAdapterMock } from "@/src/channels/mock";
import { transition } from "@/src/conversation";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import {
  CATEGORIAS,
  COMPOSICAO_EXIGIDA,
  comoReal,
  lerDataset,
  MINIMO_DE_CASOS,
  roteiroAterrado,
  type CasoDeAvaliacao,
  type Dataset,
  type ReferenciaDeRegistro,
  type SeedDoTenant,
} from "./f04-ai-eval-dataset";
import { CFG_LLM, semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm ai:eval");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

/** Segredo FICTÍCIO do adapter — não é credencial de lugar nenhum. */
const SEGREDO_FICTICIO = "segredo-ficticio-do-ai-eval-f04-t07-0001";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });

const dataset: Dataset = lerDataset();

/** Quantas tentativas o dublê de saldo negado recebe (D36, G-15). */
const TENTATIVAS_SEM_SALDO = 3;

// ─── Identidades: derivadas do índice, nunca uma segunda lista ──────────────

const nomesDeTenant = Object.keys(dataset.seed).sort();

/** Um sufixo hex por tenant, na ordem alfabética do seed. */
function sufixo(tenant: string): string {
  const posicao = nomesDeTenant.indexOf(tenant);
  if (posicao < 0) throw new Error(`tenant sem seed: ${tenant}`);
  return String(posicao + 10).padStart(4, "0"); // 0010, 0011, …
}

const id = (tenant: string, familia: number, indice: number): string =>
  `f0407777-${familia}${String(indice).padStart(3, "0")}-4000-8000-00000000${sufixo(tenant)}`;

const orgDe = (tenant: string): string => id(tenant, 1, 0);
const ctxDe = (tenant: string): TenantCtx => ({ organization_id: orgDe(tenant), source: "job" });

/** Os casos de cada tenant, na ordem do arquivo. A conversa do caso é o índice. */
const casosPorTenant = new Map<string, CasoDeAvaliacao[]>(
  nomesDeTenant.map((tenant) => [
    tenant,
    dataset.cases.filter((caso) => caso.tenant === tenant),
  ]),
);

function conversaDoCaso(caso: CasoDeAvaliacao): string {
  const lista = casosPorTenant.get(caso.tenant) ?? [];
  const indice = lista.findIndex((outro) => outro.id === caso.id);
  if (indice < 0) throw new Error(`caso sem conversa: ${caso.id}`);
  return id(caso.tenant, 4, indice + 1);
}

/** A conversa EXTRA de cada tenant — só a sonda de saldo negado a usa. */
function conversaDaSonda(tenant: string): string {
  return id(tenant, 4, (casosPorTenant.get(tenant)?.length ?? 0) + 1);
}

function configDoTenant(tenant: string, seed: SeedDoTenant): ConfigDeTenant {
  const quantas = (casosPorTenant.get(tenant)?.length ?? 0) + 1; // +1 = sonda
  return {
    org: orgDe(tenant),
    slug: `ai-eval-${tenant}`,
    usuario: id(tenant, 2, 0),
    sessao: id(tenant, 3, 0),
    conta: `ai-eval-conta-${tenant}`,
    contatos: Array.from({ length: quantas }, (_, i) => ({
      id: id(tenant, 2, i + 1),
      nome: `Cliente fictício ${tenant} ${i + 1}`,
      telefone: `+55119${sufixo(tenant)}${String(i + 1).padStart(4, "0")}`,
    })),
    conversas: Array.from({ length: quantas }, (_, i) => ({
      id: id(tenant, 4, i + 1),
      contato: id(tenant, 2, i + 1),
      estado: "ai_handling",
      statusLegado: "ai_handling",
    })),
    produtos: seed.produtos.map((produto, i) => ({
      id: id(tenant, 5, i + 1),
      codigo: produto.codigo,
      nome: produto.nome,
      preco_cents: produto.preco_cents,
    })),
    materiais: seed.materiais.map((material, i) => ({
      fonte: id(tenant, 6, i + 1),
      versao: id(tenant, 7, i + 1),
      nome: material.nome,
      trechos: material.trechos,
    })),
    settings: seed.settings,
  };
}

// ─── O provedor mock, que CONTA ─────────────────────────────────────────────

const contador = { chamadas: 0 };

const registry = createFakeRegistry(async (options) => {
  contador.chamadas += 1;
  const saida = roteiroAterrado({
    prompt: options.prompt as unknown as { role: string; content: unknown }[],
  });
  return {
    content: [{ type: "text" as const, text: comoTextoDoProvedor(saida) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 340, text: 340, reasoning: 0 },
    },
    warnings: [],
  };
});

const depsDoTurno = (requestId: string) => ({
  pool,
  cfg: CFG_LLM,
  registry,
  adapters: { mock: adapterMock },
  modo: "mock",
  requestId,
});

// ─── Leituras do banco ──────────────────────────────────────────────────────

async function umValor<T>(sql: string, valores: unknown[]): Promise<T | null> {
  const r = await pool.query<{ v: T }>(sql, valores);
  return r.rows[0]?.v ?? null;
}

const contar = async (sql: string, valores: unknown[] = []): Promise<number> =>
  Number((await umValor<string | number>(sql, valores)) ?? 0);

/**
 * O REGISTRO-FONTE que a referência endereça, lido do banco na hora da
 * conferência. É este número/texto — e não uma constante deste arquivo — que a
 * resposta tem de bater (G-35).
 */
async function registroFonte(
  referencia: ReferenciaDeRegistro,
  tenantDoCaso: string,
): Promise<string> {
  const org = orgDe(referencia.tenant ?? tenantDoCaso);
  const ref = referencia.ref;
  if (ref === undefined) throw new Error("referência de registro sem `ref`");

  if (referencia.fonte === "setting") {
    const valor = await umValor<string>(
      `select value #>> '{}' as v from public.tenant_settings
        where organization_id = $1 and key = $2`,
      [org, ref],
    );
    if (valor === null) throw new Error(`setting ausente no banco: ${ref}`);
    return valor;
  }

  if (referencia.fonte === "product_price") {
    const centavos = await umValor<string | number>(
      `select preco_cents as v from public.catalog_products
        where organization_id = $1 and codigo = $2`,
      [org, ref],
    );
    if (centavos === null) throw new Error(`produto ausente no banco: ${ref}`);
    return comoReal(Number(centavos));
  }

  const conteudo = await umValor<string>(
    `select c.content as v
       from public.ai_chunks c
       join public.ai_knowledge_sources s on s.id = c.knowledge_source_id
      where c.organization_id = $1 and s.name = $2 and c.position = $3`,
    [org, ref, referencia.position ?? 0],
  );
  if (conteudo === null) throw new Error(`trecho ausente no banco: ${ref}#${referencia.position}`);
  return conteudo;
}

async function estadoDa(conversa: string): Promise<string | null> {
  return umValor<string>(
    `select saas_state as v from public.conversations where id = $1`,
    [conversa],
  );
}

async function acoesExecutadas(org: string, requestId: string): Promise<string[]> {
  const r = await pool.query<{ action_name: string }>(
    `select action_name from public.audit_events
      where organization_id = $1 and request_id = $2 and result = 'executed'
      order by created_at`,
    [org, requestId],
  );
  return r.rows.map((linha) => linha.action_name);
}

/**
 * O motivo do handoff como o produto o grava HOJE: `agent_inbox_items.title`
 * com o enum de §5.11 (`src/actions/handoff-bridge.ts`). Quando a tabela
 * `handoffs` nascer em F05, é esta função que muda — e só ela.
 */
async function motivoDoHandoff(org: string, conversa: string): Promise<string | null> {
  const titulo = await umValor<string>(
    `select title as v from public.agent_inbox_items
      where organization_id = $1 and ref_kind = 'conversation' and ref_id = $2
        and kind = 'handoff'
      order by created_at desc limit 1`,
    [org, conversa],
  );
  return titulo === null ? null : titulo.replace(/^handoff:\s*/, "");
}

async function ultimaSaida(conversa: string): Promise<string | null> {
  return umValor<string>(
    `select body as v from public.messages
      where conversation_id = $1 and direction = 'outbound'
      order by created_at desc, id desc limit 1`,
    [conversa],
  );
}

/** Devolve a conversa ao regime da IA, como o cliente faria ao responder (D16). */
async function clienteRespondeu(ctx: TenantCtx, conversa: string): Promise<void> {
  await transition(ctx, conversa, "inbound.message", { kind: "system" }, {
    pool,
    effects: async () => true,
  });
}

// ─── A conferência de um caso ───────────────────────────────────────────────

/** Devolve a lista de DESACORDOS. Vazia = caso aprovado. */
async function conferirCaso(caso: CasoDeAvaliacao): Promise<string[]> {
  const ctx = ctxDe(caso.tenant);
  const org = ctx.organization_id;
  const conversa = conversaDoCaso(caso);
  const requestId = `ai-eval-${caso.id}`;
  const problemas: string[] = [];

  const antes = contador.chamadas;
  for (const [turno, mensagem] of caso.messages.entries()) {
    if (turno > 0) await clienteRespondeu(ctx, conversa);
    await responderTurno(
      ctx,
      { conversation_id: conversa, mensagem_do_cliente: mensagem },
      depsDoTurno(requestId),
    );
  }
  const chamadas = contador.chamadas - antes;

  if (chamadas !== caso.expected.provider_calls) {
    problemas.push(
      `${caso.id}: chamadas ao provedor ${chamadas}, esperado ${caso.expected.provider_calls}`,
    );
  }

  const estado = await estadoDa(conversa);
  if (estado !== caso.expected.final_state) {
    problemas.push(
      `${caso.id}: estado final '${estado}', esperado '${caso.expected.final_state}'`,
    );
  }

  const acoes = await acoesExecutadas(org, requestId);
  if (JSON.stringify(acoes) !== JSON.stringify(caso.expected.actions)) {
    problemas.push(
      `${caso.id}: ações ${JSON.stringify(acoes)}, esperado ${JSON.stringify(caso.expected.actions)}`,
    );
  }

  const motivo = await motivoDoHandoff(org, conversa);
  if (motivo !== caso.expected.handoff_reason) {
    problemas.push(
      `${caso.id}: motivo do handoff '${motivo}', esperado '${caso.expected.handoff_reason}'`,
    );
  }

  const saidas = await contar(
    `select count(*)::int as v from public.messages
      where conversation_id = $1 and direction = 'outbound'`,
    [conversa],
  );
  const corpo = await ultimaSaida(conversa);

  if (caso.expected.reply.fonte === "none") {
    if (saidas !== 0) {
      problemas.push(`${caso.id}: a IA pôs ${saidas} texto(s) no fio onde não devia pôr nenhum`);
    }
  } else {
    const esperado = await registroFonte(caso.expected.reply, caso.tenant);
    const igual = caso.expected.reply.fonte === "setting";
    const bate =
      corpo !== null && (igual ? corpo === esperado : corpo.includes(esperado));
    if (!bate) {
      problemas.push(
        `${caso.id}: a resposta não bate com o registro-fonte (${caso.expected.reply.fonte}` +
          ` ${caso.expected.reply.ref}): gravado '${corpo ?? "<nada>"}'`,
      );
    }
  }

  // A prova de isolamento: o registro do vizinho não aparece em NENHUMA
  // mensagem do tenant que perguntou — não só na última.
  for (const proibido of caso.expected.must_not_contain) {
    const valor = await registroFonte(proibido, caso.tenant);
    const vazamentos = await contar(
      `select count(*)::int as v from public.messages
        where organization_id = $1 and body like '%' || $2 || '%'`,
      [org, valor],
    );
    if (vazamentos !== 0) {
      problemas.push(
        `${caso.id}: o registro de outro tenant apareceu na resposta ` +
          `(${proibido.fonte} ${proibido.ref} de ${proibido.tenant ?? caso.tenant}, ` +
          `${vazamentos} mensagem(ns))`,
      );
    }
  }

  return problemas;
}

// ─── Montagem ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const tenant of nomesDeTenant) {
      const seed = dataset.seed[tenant];
      if (seed === undefined) throw new Error(`seed ausente: ${tenant}`);
      await semearTenant(client, configDoTenant(tenant, seed));
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

describe("F04-T07: o dataset de avaliação", () => {
  it("tem a composição que §7.5 fixa: 30 casos, 6/10/5/6/3", () => {
    // Arrange + Act — a contagem sai do arquivo lido, não de uma constante.
    const contagem = Object.fromEntries(
      CATEGORIAS.map((categoria) => [
        categoria,
        dataset.cases.filter((caso) => caso.category === categoria).length,
      ]),
    );

    // Assert
    expect(dataset.cases.length).toBeGreaterThanOrEqual(MINIMO_DE_CASOS);
    expect(contagem).toEqual(COMPOSICAO_EXIGIDA);
  });
});

describe("F04-T07: ai:eval compara o expected com o BANCO (G-35)", () => {
  it("ai_eval: os casos de docs/ai-eval/cases.yaml batem com o registro-fonte", async () => {
    // Arrange
    const reprovados: string[] = [];
    let aprovados = 0;

    // Act — a ordem é a do arquivo; cada caso tem conversa própria.
    for (const caso of dataset.cases) {
      const problemas = await conferirCaso(caso);
      if (problemas.length === 0) aprovados += 1;
      else reprovados.push(...problemas);
    }

    // Act 2 — D36: com o dublê que NEGA, o provedor não é tocado. Três
    // tentativas iguais, para que "não chamou" não seja sorte de uma só.
    const tenantDaSonda = nomesDeTenant[0];
    if (tenantDaSonda === undefined) throw new Error("dataset sem tenant");
    const ctxDaSonda = ctxDe(tenantDaSonda);
    const antesDaSonda = contador.chamadas;
    for (let tentativa = 1; tentativa <= TENTATIVAS_SEM_SALDO; tentativa += 1) {
      await responderTurno(
        ctxDaSonda,
        {
          conversation_id: conversaDaSonda(tenantDaSonda),
          mensagem_do_cliente: "tentativa sem saldo",
        },
        {
          ...depsDoTurno(`ai-eval-sem-saldo-${tentativa}`),
          resolver: () => ({ allowed: false, remaining: 0, reason: "sem_saldo" }),
        },
      );
    }
    const chamadasSemSaldo = contador.chamadas - antesDaSonda;

    // Assert — a linha do bloco sai dos números medidos, não do esperado.
    const porCategoria = (categoria: string): number =>
      dataset.cases.filter((caso) => caso.category === categoria).length;

    const linha =
      `ai_eval: cases=${dataset.cases.length} pass=${aprovados}/${dataset.cases.length} ` +
      `unknown=${porCategoria("unknown")} injection=${porCategoria("injection")} ` +
      `cross_tenant=${porCategoria("cross_tenant")} ` +
      `provider_calls_at_zero_balance=${chamadasSemSaldo}`;
    console.info(linha);
    console.info(`ai_eval: attempts=${TENTATIVAS_SEM_SALDO} no dublê de saldo negado (D36)`);
    gravarLinhaDoVerify("ai-eval", linha);

    // O consumo dos casos que chamaram o provedor. §8.3 move o piso de
    // `entitlement` para "≥ casos normais do dataset" a partir de F04, e é esta
    // execução que o produz — por isso a linha é regravada aqui.
    const usos = await contar(
      `select count(*)::int as v from public.ai_usage_events
        where organization_id = any($1::uuid[])`,
      [nomesDeTenant.map(orgDe)],
    );
    const linhaDeUso = `entitlement: usage_events_written=${usos}`;
    console.info(linhaDeUso);
    gravarLinhaDoVerify("entitlement", linhaDeUso);

    expect(reprovados, `casos reprovados:\n${reprovados.join("\n")}`).toEqual([]);
    expect(aprovados).toBe(dataset.cases.length);
    expect(chamadasSemSaldo, "o provedor foi chamado com saldo negado (D36)").toBe(0);
    expect(usos, "menos linhas de consumo que casos normais do dataset").toBeGreaterThanOrEqual(
      COMPOSICAO_EXIGIDA.normal,
    );
  });
});
