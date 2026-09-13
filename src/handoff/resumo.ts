/**
 * O RESUMO de sete campos de §5.11/D19 (F05-T02).
 *
 * Os sete: `customer`, `intent`, `summary` (≥1 frase), `last_messages`
 * (exatamente 5), `pending_action`, `reason`, `suggested_next_step`.
 *
 * ═══ De onde ele vem — e de onde NÃO vem ═══════════════════════════════════
 *
 * Do CHECKPOINT e do HISTÓRICO, dentro da mesma transação que move a conversa.
 * Nenhuma chamada ao provedor: §5.11 permitiria uma (`ai.summary`, contada), e
 * a construção da F05 recusa a permissão por três razões medidas:
 *
 *  1. o motivo mais provável de handoff nesta fase é `provider_error` — pedir o
 *     resumo ao componente que acabou de falhar é pedir de novo a mesma falha;
 *  2. o segundo mais provável é `forbidden_request`, e mandar ao modelo o texto
 *     que se está tentando conter para que ele o resuma é dar à injeção uma
 *     segunda passagem pelo prompt;
 *  3. resumo gerado é resumo que muda entre duas execuções com o mesmo dado — e
 *     `fields_present=7/7` deixaria de ser uma prova reproduzível.
 *
 * DIVERGÊNCIA DECLARADA em relação a §5.11: zero chamadas `ai.summary`, não uma.
 * O campo `summary` continua com ≥1 frase e passa a ser sempre determinístico.
 *
 * ═══ `last_messages` tem sempre CINCO posições ════════════════════════════
 *
 * §5.11 diz "exatamente 5". Conversa mais curta preenche as posições ANTIGAS
 * com `null`: a posição existe e declara que não houve mensagem ali. Um array
 * menor faria "a conversa tinha três mensagens" e "o montador leu três"
 * ficarem indistinguíveis — que é justamente o que a contagem de sete campos
 * existe para separar.
 *
 * ═══ `pending_action` é o único que aceita `null` ═════════════════════════
 *
 * E aceita por honestidade: a maior parte das passagens não tem ação pendurada.
 * O campo é sempre DECLARADO (a chave existe, a coluna é sempre escrita); o
 * valor é o que for verdade. Inventar "nenhuma" poria texto falso no dossiê que
 * a pessoa vai ler.
 */
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

import {
  contaFrases,
  INTENT_PADRAO,
  PROXIMO_PASSO_DO_MOTIVO,
  resumoDeterministico,
  type MotivoDeHandoff,
} from "./motivos";

/** §5.11: "`last_messages` exatamente 5". O número é da DIRETRIZ. */
export const ULTIMAS_MENSAGENS_NO_RESUMO = 5;

/** O teto do trecho de conversa que entra no `summary`. */
const TRECHO_NO_RESUMO = 240;

/** Os SETE campos de D19, num lugar só — o denominador da prova sai daqui. */
export const CAMPOS_DO_RESUMO = [
  "customer",
  "intent",
  "summary",
  "last_messages",
  "pending_action",
  "reason",
  "suggested_next_step",
] as const;

export type CampoDoResumo = (typeof CAMPOS_DO_RESUMO)[number];

/** Uma das cinco posições. `null` = não houve mensagem nesta posição. */
export interface MensagemDoResumo {
  readonly direction: "inbound" | "outbound";
  readonly sent_via: string;
  readonly body: string | null;
  readonly created_at: string;
}

export interface ResumoDoHandoff {
  readonly customer: string;
  readonly intent: string;
  readonly summary: string;
  readonly last_messages: readonly (MensagemDoResumo | null)[];
  readonly pending_action: string | null;
  readonly reason: MotivoDeHandoff;
  readonly suggested_next_step: string;
}

export interface PedidoDeResumo {
  readonly conversation_id: string;
  readonly reason: MotivoDeHandoff;
  /** Etiqueta de intenção lida pelo turno; ausente cai no padrão do motivo. */
  readonly intent?: string | undefined;
  /** Texto do chamador. Ausente ou sem frase cai no template determinístico. */
  readonly summary?: string | undefined;
  /** Action do catálogo que ficou pendurada; ausente é procurada no banco. */
  readonly pending_action?: string | null | undefined;
}

interface LinhaDoContato {
  display_name: string | null;
  phone_number: string | null;
}

interface LinhaDaMensagem {
  direction: string;
  sent_via: string | null;
  body: string | null;
  created_at: Date | string;
}

function comoTexto(valor: Date | string): string {
  return valor instanceof Date ? valor.toISOString() : String(valor);
}

/**
 * O nome do cliente para quem vai assumir.
 *
 * Telefone quando não há nome, e uma frase declarada quando não há nem isso:
 * `customer` é `not null` no banco e o campo tem de dizer alguma coisa. "Contato
 * sem nome cadastrado" é informação verdadeira; string vazia não é.
 */
function comoCliente(linha: LinhaDoContato | undefined): string {
  const nome = linha?.display_name?.trim() ?? "";
  if (nome.length > 0) return nome;
  const telefone = linha?.phone_number?.trim() ?? "";
  if (telefone.length > 0) return telefone;
  return "Contato sem nome cadastrado";
}

/** Uma linha só, sem quebras — o dossiê é lido numa lista. */
function trecho(texto: string): string {
  const limpo = texto.replace(/\s+/gu, " ").trim();
  return limpo.length > TRECHO_NO_RESUMO ? `${limpo.slice(0, TRECHO_NO_RESUMO - 1)}…` : limpo;
}

/**
 * O texto do `summary`: o PORQUÊ do motivo mais, quando existe, a última coisa
 * que o cliente escreveu.
 *
 * O texto do chamador tem precedência quando já é uma frase — é o caso do
 * atendente que escreve por que está passando a conversa adiante, e substituí-lo
 * por um template apagaria a única informação que ninguém mais tem.
 */
function textoDoResumo(
  pedido: PedidoDeResumo,
  intent: string,
  ultimaDoCliente: string | null,
): string {
  const doChamador = (pedido.summary ?? "").trim();
  const base =
    contaFrases(doChamador) >= 1 ? doChamador : resumoDeterministico(pedido.reason, intent);
  if (ultimaDoCliente === null) return base;
  return `${base} Última mensagem do cliente: "${trecho(ultimaDoCliente)}".`;
}

/**
 * Monta os sete campos lendo o banco DENTRO da transação que o chamador já
 * abriu (`transition()`).
 *
 * Recebe `db` e não abre `withTenant` por conta própria de propósito: o dossiê e
 * o movimento da conversa têm de ser a mesma escrita. Um resumo montado fora da
 * transação leria um histórico de um instante diferente do da passagem — e uma
 * falha no meio deixaria conversa em `waiting_human` sem dossiê nenhum.
 */
export async function montarResumo(
  db: TenantDb,
  ctx: TenantCtx,
  pedido: PedidoDeResumo,
): Promise<ResumoDoHandoff> {
  const contato = await db.query<LinhaDoContato>(
    `select ct.display_name, ct.phone_number
       from public.conversations c
       join public.contacts ct
         on ct.id = c.contact_id and ct.organization_id = c.organization_id
      where c.id = $1 and c.organization_id = $2`,
    [pedido.conversation_id, ctx.organization_id],
  );

  // `desc` + reversão: as ÚLTIMAS cinco são o recorte; ordenar crescente e
  // cortar com LIMIT devolveria as PRIMEIRAS cinco — o histórico errado com a
  // mesma contagem (mesma escolha de `src/ai/historico.ts`).
  const mensagens = await db.query<LinhaDaMensagem>(
    `select direction, sent_via, body, created_at
       from public.messages
      where conversation_id = $1 and organization_id = $2
      order by created_at desc, id desc
      limit $3`,
    [pedido.conversation_id, ctx.organization_id, ULTIMAS_MENSAGENS_NO_RESUMO],
  );

  const lidas: MensagemDoResumo[] = mensagens.rows
    .map((linha) => ({
      direction: linha.direction === "outbound" ? ("outbound" as const) : ("inbound" as const),
      sent_via: linha.sent_via ?? "desconhecido",
      body: linha.body,
      created_at: comoTexto(linha.created_at),
    }))
    .reverse();

  // O `null` vai na FRENTE: a posição vazia é a mais ANTIGA, e pôr o vazio no
  // fim faria o dossiê sugerir que a conversa terminou em silêncio.
  const last_messages: readonly (MensagemDoResumo | null)[] = [
    ...Array.from<MensagemDoResumo | null>({
      length: Math.max(0, ULTIMAS_MENSAGENS_NO_RESUMO - lidas.length),
    }).fill(null),
    ...lidas,
  ];

  const pendente =
    pedido.pending_action === undefined
      ? await pendenciaAberta(db, ctx, pedido.conversation_id)
      : pedido.pending_action;

  const intent = (pedido.intent ?? "").trim() || INTENT_PADRAO[pedido.reason];
  const ultimaDoCliente =
    [...lidas].reverse().find((m) => m.direction === "inbound" && (m.body ?? "").trim().length > 0)
      ?.body ?? null;

  return {
    customer: comoCliente(contato.rows[0]),
    intent,
    summary: textoDoResumo(pedido, intent, ultimaDoCliente),
    last_messages,
    pending_action: pendente,
    reason: pedido.reason,
    suggested_next_step: PROXIMO_PASSO_DO_MOTIVO[pedido.reason],
  };
}

/** O nome da Action pendurada nesta conversa, quando há uma (§5.8, D33). */
async function pendenciaAberta(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
): Promise<string | null> {
  const linha = await db.query<{ action_name: string }>(
    `select action_name from public.pending_actions
      where organization_id = $1 and conversation_id = $2 and status = 'pending'
      order by requested_at desc
      limit 1`,
    [ctx.organization_id, conversationId],
  );
  return linha.rows[0]?.action_name ?? null;
}

/**
 * Os campos que NÃO estão de pé — lista vazia é o resumo completo.
 *
 * Existe em produção, e não só no teste: um dossiê incompleto gravado é uma
 * pessoa abrindo a fila e não sabendo o que fazer. Aqui a regra de cada campo é
 * declarada uma vez, e o teste de F05-T02 conta `fields_present` com ESTA
 * função — escrever a régua no teste faria o teste aprovar a si mesmo.
 *
 * `pending_action` é o único cuja regra é "a chave existe e é texto ou `null`":
 * ver o cabeçalho deste arquivo.
 */
export function camposAusentes(resumo: ResumoDoHandoff): readonly CampoDoResumo[] {
  const faltando: CampoDoResumo[] = [];
  if (resumo.customer.trim().length === 0) faltando.push("customer");
  if (resumo.intent.trim().length === 0) faltando.push("intent");
  if (contaFrases(resumo.summary) < 1) faltando.push("summary");
  if (resumo.last_messages.length !== ULTIMAS_MENSAGENS_NO_RESUMO) faltando.push("last_messages");
  if (!(resumo.pending_action === null || typeof resumo.pending_action === "string")) {
    faltando.push("pending_action");
  }
  if (resumo.reason.trim().length === 0) faltando.push("reason");
  if (resumo.suggested_next_step.trim().length === 0) faltando.push("suggested_next_step");
  return faltando;
}

export class ResumoIncompleto extends Error {
  constructor(public readonly campos: readonly CampoDoResumo[]) {
    super(`resumo de handoff sem os sete campos de §5.11: faltam ${campos.join(", ")}`);
    this.name = "ResumoIncompleto";
  }
}
