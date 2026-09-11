/**
 * O TURNO do agente SaaS (§5.9; F04-T04/T05/T06/T09; ADR-021).
 *
 * §5.9: "Sabe: montar contexto, chamar o provedor, interpretar a saída
 * estruturada e decidir entre responder, executar Action ou pedir handoff. NÃO
 * EXECUTA NADA: só chama `Action Policy.execute`." Este arquivo é literalmente
 * isso — não há uma escrita de domínio aqui, nem um `adapter.send`, nem um
 * `update` de `conversations`. Todo efeito sai por `execute()` (§5.8) ou por
 * `transition()` (§5.6).
 *
 * ═══ A ORDEM das decisões, e por que ela é esta ═══
 *
 *  0. SILÊNCIO. Estado fora de `ESTADOS_EM_QUE_A_IA_FALA` encerra o turno ANTES
 *     de qualquer leitura de contexto e sem uma linha de conversa com o
 *     provedor. É a regra 19 do AGENTS.md (`ai_messages_after_handoff = 0`): a
 *     conversa já é de uma pessoa, e nem custo nem texto podem aparecer nela.
 *  1. INJEÇÃO. Pedido proibido vira handoff `forbidden_request` sem montar
 *     contexto — o dado do tenant nem chega a ser lido, que é a forma mais
 *     forte de "sem dado do tenant" (§5.9).
 *  2. CONTEXTO (F04-T04) e UMA chamada ao provedor, pela porta de `chamada.ts`.
 *  3. FORA DA BASE antes do LIMIAR. A ordem importa: uma resposta de "não sei"
 *     costuma vir com confiança baixa, e testar o limiar primeiro faria a
 *     PRIMEIRA pergunta fora da base virar handoff — quando D19 manda responder
 *     `ai.unknown_answer` e só chamar humano na SEGUNDA.
 *  4. LIMIAR (D19, G-77), depois o handoff que o próprio modelo pediu, e só
 *     então as tools — uma resposta em que não se confia não executa ação.
 *
 * ═══ Erro do provedor NÃO tem laço (F04-T09) ═══
 *
 * `chamarModelo` é invocado no máximo UMA vez por turno; não há `for`, `while`
 * nem `catch` que volte ao provedor. Erro vira handoff `provider_error` com a
 * conversa em `waiting_human`. Reentrar seria dobrar o custo no minuto em que o
 * provedor está pior, e a segunda tentativa raramente responde outra coisa —
 * quem decide tentar de novo é a fila, com o seu backoff, num turno novo.
 */
import type pg from "pg";

import {
  execute,
  type ActionResult,
  type ExecuteDeps,
  type HANDOFF_REASONS,
} from "@/src/actions";
import { IllegalTransition, transition } from "@/src/conversation";
import { EntitlementDenied } from "@/src/entitlement";
import type { Embutidor } from "@/src/knowledge";
import { incrementCounter } from "@/src/obs/counters";
import type { TenantCtx } from "@/src/tenant-context";
import type { LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/run-model-call";
import type { ProviderRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";

import { chamarModelo, type DepsDaChamada } from "./chamada";
import { lerSaidaEstruturada, type SaidaEstruturada } from "./contrato";
import {
  contextoComoTexto,
  instrucoesDoSistema,
  montarContexto,
  type ContextoDoTurno,
} from "./contexto";
import {
  abaixoDoLimiar,
  estaForaDaBase,
  iaPodeFalar,
  limiarDoTenant,
  pedidoProibido,
  textoDeDesconhecido,
  triarToolCalls,
} from "./guardrails";
import { lerConversaDoTurno, vezesQueRespondeuDesconhecido } from "./historico";
import { modeloDeclarado, registroDoProvedor, type Ambiente, type Roteiro } from "./provedor";

export type MotivoDoSilencio =
  | "conversa_fora_do_tenant"
  | "estado_nao_e_da_ia"
  | "ia_desligada";

export type MotivoDoHandoff = (typeof HANDOFF_REASONS)[number];

export interface ToolExecutada {
  readonly name: string;
  readonly status: ActionResult["status"];
  readonly reason?: string;
}

export interface ResultadoDoTurno {
  readonly status: "respondido" | "silenciado" | "handoff";
  /** Etiqueta de contador, nunca frase (G-78). */
  readonly motivo: MotivoDoSilencio | MotivoDoHandoff | "resposta" | "fora_da_base";
  readonly estado_inicial: string | null;
  /**
   * Quantas vezes ESTE turno invocou `chamarModelo`. Por construção, 0 ou 1:
   * é o número que F04-T09 cobra (`provider_calls=1`, nunca 2).
   */
  readonly chamadas_ao_modelo: number;
  readonly confidence: number;
  readonly tools_executadas: readonly ToolExecutada[];
  /** §5.9: "tool_call fora da lista é descartado e contado". */
  readonly tools_descartadas: readonly string[];
  readonly mensagens_enviadas: number;
}

export interface PedidoDoTurno {
  readonly conversation_id: string;
  /** O texto do cliente. DADO, nunca instrução (D18, AGENTS.md regra 4). */
  readonly mensagem_do_cliente: string;
}

export interface DepsDoTurno {
  /** `pg.Pool` e não `ServicePool`: é o que `runModelCall` exige do seam. */
  readonly pool: pg.Pool;
  readonly cfg: LlmEdgeConfig;
  readonly env?: Ambiente;
  /** Roteiro do mock (§5.9, D12). Ignorado fora de `AI_PROVIDER=mock`. */
  readonly roteiro?: Roteiro;
  /** Registro já pronto — a prova de F04-T09 injeta o que CONTA e falha. */
  readonly registry?: ProviderRegistry;
  readonly log?: Logger;
  /** Seam do entitlement (D14). A prova de D36 injeta o dublê que nega. */
  readonly resolver?: DepsDaChamada["resolver"];
  readonly embutir?: Embutidor;
  readonly requestId?: string;
  /** Seams de canal de `execute()` — a prova injeta o adapter mock. */
  readonly adapters?: ExecuteDeps["adapters"];
  readonly modo?: string;
}

const IA = { kind: "ai" } as const;

/**
 * O resumo do handoff da F04 é TEMPLATE, sempre — inclusive fora do
 * `provider_error`.
 *
 * §5.11 exige o resumo de sete campos e permite uma chamada `ai.summary` para
 * gerá-lo; isso é F05-T02. Aqui o resumo é determinístico porque os dois motivos
 * mais prováveis de handoff nesta fase — provedor fora do ar e injeção — são
 * exatamente aqueles em que pedir texto ao modelo seria pedir ao componente que
 * falhou, ou ao texto que se está tentando conter.
 */
function resumoDeterministico(motivo: MotivoDoHandoff, intent: string): string {
  const porque: Record<MotivoDoHandoff, string> = {
    customer_request: "O cliente pediu para falar com uma pessoa.",
    high_risk_action: "A ação pedida exige autorização humana.",
    low_confidence: "A IA não teve confiança suficiente na própria resposta.",
    out_of_knowledge: "A pergunta não é coberta pela base de conhecimento do tenant.",
    complaint: "O cliente demonstrou insatisfação.",
    provider_error: "O provedor de IA falhou nesta conversa; nenhuma nova tentativa foi feita.",
    tenant_rule: "Uma regra do tenant interrompeu o atendimento automático.",
    forbidden_request:
      "O texto recebido pediu configuração, dado de outro cliente ou quebra de regra.",
  };
  return `${porque[motivo]} Intenção lida: ${intent}.`;
}

interface EstadoDoTurno {
  chamadas: number;
  confidence: number;
  tools: ToolExecutada[];
  descartadas: string[];
  enviadas: number;
}

function depsDeAcao(deps: DepsDoTurno): ExecuteDeps {
  return {
    pool: deps.pool,
    ...(deps.requestId === undefined ? {} : { requestId: deps.requestId }),
    ...(deps.adapters === undefined ? {} : { adapters: deps.adapters }),
    ...(deps.modo === undefined ? {} : { modo: deps.modo }),
  };
}

/** O handoff, pela ÚNICA porta que existe: a tool `transfer_to_human` (§5.8). */
async function pedirHandoff(
  ctx: TenantCtx,
  pedido: PedidoDoTurno,
  motivo: MotivoDoHandoff,
  intent: string,
  estado: EstadoDoTurno,
  estadoInicial: string | null,
  deps: DepsDoTurno,
): Promise<ResultadoDoTurno> {
  const resultado = await execute(
    ctx,
    IA,
    "transfer_to_human",
    {
      conversation_id: pedido.conversation_id,
      reason: motivo,
      summary: resumoDeterministico(motivo, intent),
    },
    depsDeAcao(deps),
  );
  estado.tools.push({
    name: "transfer_to_human",
    status: resultado.status,
    ...(resultado.reason === undefined ? {} : { reason: resultado.reason }),
  });
  incrementCounter("ai_turno_handoff", { reason: motivo });
  return {
    status: "handoff",
    motivo,
    estado_inicial: estadoInicial,
    chamadas_ao_modelo: estado.chamadas,
    confidence: estado.confidence,
    tools_executadas: estado.tools,
    tools_descartadas: estado.descartadas,
    mensagens_enviadas: estado.enviadas,
  };
}

/**
 * Põe um texto no fio pela tool `send_message` e, se a conversa continuar sendo
 * da IA, emite `ai.reply_sent`.
 *
 * A transição vem DEPOIS do envio e é tolerante a recusa: uma tool anterior pode
 * ter levado a conversa para `waiting_confirmation` (D33) ou `waiting_human`, e
 * nesses casos `ai_handling -ai.reply_sent->` não existe na tabela D16. Recusa
 * ali não desfaz o envio — só registra que quem move a conversa é a máquina.
 */
async function responderAoCliente(
  ctx: TenantCtx,
  pedido: PedidoDoTurno,
  texto: string,
  estado: EstadoDoTurno,
  deps: DepsDoTurno,
): Promise<void> {
  const envio = await execute(
    ctx,
    IA,
    "send_message",
    { conversation_id: pedido.conversation_id, body: texto },
    depsDeAcao(deps),
  );
  estado.tools.push({
    name: "send_message",
    status: envio.status,
    ...(envio.reason === undefined ? {} : { reason: envio.reason }),
  });
  if (envio.status !== "executed") return;
  estado.enviadas += 1;

  try {
    await transition(ctx, pedido.conversation_id, "ai.reply_sent", { kind: "ai" }, {
      pool: deps.pool,
    });
  } catch (erro) {
    if (!(erro instanceof IllegalTransition)) throw erro;
    incrementCounter("ai_turno_sem_movimento", { from: erro.from, event: erro.event });
  }
}

function silenciar(
  motivo: MotivoDoSilencio,
  estadoInicial: string | null,
): ResultadoDoTurno {
  incrementCounter("ai_turno_silenciado", { motivo });
  return {
    status: "silenciado",
    motivo,
    estado_inicial: estadoInicial,
    chamadas_ao_modelo: 0,
    confidence: 0,
    tools_executadas: [],
    tools_descartadas: [],
    mensagens_enviadas: 0,
  };
}

/**
 * Um turno do agente SaaS. Nunca lança por causa do provedor: erro dele é
 * handoff, que é um desfecho de negócio.
 */
export async function responderTurno(
  ctx: TenantCtx,
  pedido: PedidoDoTurno,
  deps: DepsDoTurno,
): Promise<ResultadoDoTurno> {
  const estado: EstadoDoTurno = {
    chamadas: 0,
    confidence: 0,
    tools: [],
    descartadas: [],
    enviadas: 0,
  };

  // 0. SILÊNCIO — antes de ler contexto, antes de gastar um token.
  const conversa = await lerConversaDoTurno(ctx, pedido.conversation_id, { pool: deps.pool });
  if (conversa === null) return silenciar("conversa_fora_do_tenant", null);
  if (!iaPodeFalar(conversa.estado)) return silenciar("estado_nao_e_da_ia", conversa.estado);

  // 1. INJEÇÃO — o contexto do tenant nem chega a ser lido.
  if (pedidoProibido(pedido.mensagem_do_cliente)) {
    incrementCounter("ai_pedido_proibido");
    return pedirHandoff(
      ctx,
      pedido,
      "forbidden_request",
      "pedido_proibido",
      estado,
      conversa.estado,
      deps,
    );
  }

  // 2. CONTEXTO (F04-T04).
  const contexto: ContextoDoTurno = await montarContexto(
    ctx,
    {
      conversation_id: pedido.conversation_id,
      mensagem_do_cliente: pedido.mensagem_do_cliente,
    },
    {
      pool: deps.pool,
      ...(deps.embutir === undefined ? {} : { embutir: deps.embutir }),
    },
  );
  if (contexto.settings["ai.enabled"] === false) {
    return silenciar("ia_desligada", conversa.estado);
  }

  // 2b. UMA chamada ao provedor. Sem laço, sem segunda tentativa (F04-T09).
  const modelo = modeloDeclarado(deps.env);
  let texto: string;
  try {
    estado.chamadas = 1;
    const resposta = await chamarModelo(
      ctx,
      "ai.reply",
      {
        system: instrucoesDoSistema(contexto),
        messages: [{ role: "user", content: contextoComoTexto(contexto) }],
        conversationId: pedido.conversation_id,
        ...(modelo === undefined ? {} : { model: modelo }),
      },
      {
        pool: deps.pool,
        cfg: deps.cfg,
        registry: registroDoProvedor({
          ...(deps.env === undefined ? {} : { env: deps.env }),
          ...(deps.roteiro === undefined ? {} : { roteiro: deps.roteiro }),
          ...(deps.registry === undefined ? {} : { registry: deps.registry }),
        }),
        ...(deps.log === undefined ? {} : { log: deps.log }),
        ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
      },
    );
    texto = resposta.result.text;
  } catch (erro) {
    // Saldo negado (D36) não é falha do provedor: nenhum byte saiu, e o motivo
    // honesto é uma regra do tenant — não "o provedor caiu".
    const motivo: MotivoDoHandoff =
      erro instanceof EntitlementDenied ? "tenant_rule" : "provider_error";
    if (erro instanceof EntitlementDenied) estado.chamadas = 0;
    incrementCounter("ai_turno_erro_do_provedor", { motivo });
    deps.log?.warn("ai: turno terminou em handoff por falha antes da resposta", {
      organization_id: ctx.organization_id,
      conversation_id: pedido.conversation_id,
      motivo,
    });
    return pedirHandoff(
      ctx,
      pedido,
      motivo,
      "erro_antes_da_resposta",
      estado,
      conversa.estado,
      deps,
    );
  }

  const { saida, malformada } = lerSaidaEstruturada(texto);
  estado.confidence = saida.confidence;
  if (malformada) incrementCounter("ai_saida_malformada");

  return decidir(ctx, pedido, contexto, saida, estado, conversa.estado, deps);
}

/**
 * O que fazer com uma saída já lida. Separado de `responderTurno` para que a
 * ordem das decisões caiba numa tela — e para que ela seja a única coisa que
 * este trecho faz.
 */
async function decidir(
  ctx: TenantCtx,
  pedido: PedidoDoTurno,
  contexto: ContextoDoTurno,
  saida: SaidaEstruturada,
  estado: EstadoDoTurno,
  estadoInicial: string,
  deps: DepsDoTurno,
): Promise<ResultadoDoTurno> {
  const handoff = (motivo: MotivoDoHandoff): Promise<ResultadoDoTurno> =>
    pedirHandoff(ctx, pedido, motivo, saida.intent, estado, estadoInicial, deps);

  // 3a. O modelo reconheceu um pedido proibido que a barreira determinística
  //     não pegou. Vale como gatilho de segurança, nunca como permissão.
  if (saida.handoff.wanted && saida.handoff.reason === "forbidden_request") {
    incrementCounter("ai_pedido_proibido");
    return handoff("forbidden_request");
  }

  // 3b. FORA DA BASE — antes do limiar, por causa de D19 ("após 1 tentativa").
  if (estaForaDaBase(saida, contexto.acervo.trechos.length)) {
    const texto = textoDeDesconhecido(contexto.settings["ai.unknown_answer"]);
    // Tenant sem `ai.unknown_answer` não tem o que responder: chamar humano na
    // primeira é melhor que inventar um "não sei" que não é dele.
    if (texto === null) return handoff("out_of_knowledge");

    const vezes = await vezesQueRespondeuDesconhecido(ctx, pedido.conversation_id, texto, {
      pool: deps.pool,
    });
    if (vezes >= 1) return handoff("out_of_knowledge");

    incrementCounter("ai_resposta_desconhecida");
    await responderAoCliente(ctx, pedido, texto, estado, deps);
    return {
      status: "respondido",
      motivo: "fora_da_base",
      estado_inicial: estadoInicial,
      chamadas_ao_modelo: estado.chamadas,
      confidence: estado.confidence,
      tools_executadas: estado.tools,
      tools_descartadas: estado.descartadas,
      mensagens_enviadas: estado.enviadas,
    };
  }

  // 4. LIMIAR (§5.9, G-77) — resposta em que não se confia não age nem fala.
  const limiar = limiarDoTenant(contexto.settings["ai.confidence_threshold"]);
  if (abaixoDoLimiar(saida.confidence, limiar)) {
    return handoff("low_confidence");
  }

  // 5. O handoff que o próprio modelo pediu, com o motivo que ele deu.
  if (saida.handoff.wanted) {
    return handoff(saida.handoff.reason ?? "customer_request");
  }

  // 6. TOOLS — só as de `toolsFor(ctx,"ai")`; o resto é descartado e contado.
  const triagem = triarToolCalls(saida.tool_calls, contexto.tools);
  estado.descartadas = [...triagem.descartadas];
  for (const descartada of triagem.descartadas) {
    incrementCounter("ai_tool_call_descartada", { name: descartada });
  }

  let enviouPelaTool = false;
  for (const chamada of triagem.aceitas) {
    const resultado = await execute(ctx, IA, chamada.name, chamada.input, depsDeAcao(deps));
    estado.tools.push({
      name: chamada.name,
      status: resultado.status,
      ...(resultado.reason === undefined ? {} : { reason: resultado.reason }),
    });
    if (chamada.name === "send_message" && resultado.status === "executed") {
      enviouPelaTool = true;
      estado.enviadas += 1;
    }
  }

  // 7. A RESPOSTA. Não duplica o que a tool já enviou: `reply` e um
  //    `send_message` pedido pelo modelo são o mesmo texto pedido duas vezes.
  const reply = saida.reply.trim();
  if (reply.length > 0 && !enviouPelaTool) {
    await responderAoCliente(ctx, pedido, reply, estado, deps);
  }

  return {
    status: "respondido",
    motivo: "resposta",
    estado_inicial: estadoInicial,
    chamadas_ao_modelo: estado.chamadas,
    confidence: estado.confidence,
    tools_executadas: estado.tools,
    tools_descartadas: estado.descartadas,
    mensagens_enviadas: estado.enviadas,
  };
}
