/**
 * Os `input_schema` e `output_schema` das dez entradas do catálogo (§5.8, D18).
 *
 * Moram FORA de `catalog.ts` de propósito: aquele arquivo é a POLÍTICA (quem
 * pode, com que risco, com que confirmação) e precisa caber numa tela para que
 * "mudar o risco de uma Action = 1 linha" (§5.19) continue verdadeiro. Schema é
 * contrato de dados, cresce com o domínio e não tem nada a decidir.
 *
 * Três regras que valem para todos:
 *
 * 1. `strictObject` — campo desconhecido REPROVA. A entrada de uma tool vem do
 *    modelo, e modelo inventa campo; aceitar em silêncio faria o argumento
 *    extra viajar até o domínio sem ninguém ter decidido que ele existe.
 * 2. Nenhum schema aceita id gerado pelo chamador quando o domínio gera o id
 *    (item de pedido, por exemplo). A IA não inventa UUID.
 * 3. `idempotency_key` é obrigatória em toda ação que ESCREVE: repetir a mesma
 *    chamada por timeout de rede não pode virar um segundo pedido.
 */
import { z } from "zod";

/** Minúsculo por construção: o banco compara uuid, não texto. */
const uuid = z.uuid().transform((id) => id.toLowerCase());
const idempotencyKey = z.string().trim().min(1).max(200);
const texto = (max: number) => z.string().trim().min(1).max(max);

/**
 * Os oito motivos de handoff de §5.11 (os 7 gatilhos de D19 mais
 * `forbidden_request`). Enum e nunca texto livre (G-78): motivo em prosa não
 * vira etiqueta de contador nem filtro de fila.
 */
export const HANDOFF_REASONS = [
  "customer_request",
  "high_risk_action",
  "low_confidence",
  "out_of_knowledge",
  "complaint",
  "provider_error",
  "tenant_rule",
  "forbidden_request",
] as const;

// ─── Leitura ────────────────────────────────────────────────────────────────

export const getCustomerInputSchema = z.strictObject({ customer_id: uuid });

export const getCustomerOutputSchema = z.strictObject({
  /** `null` e não erro: "não achei" é resposta, e a IA sabe o que fazer com ela. */
  customer: z
    .strictObject({
      id: z.string(),
      display_name: z.string().nullable(),
      phone_number: z.string().nullable(),
      company_id: z.string().nullable(),
      company_name: z.string().nullable(),
      orders_count: z.number().int(),
      last_order_at: z.string().nullable(),
    })
    .nullable(),
});

export const searchProductsInputSchema = z.strictObject({
  query: texto(200),
  limit: z.number().int().min(1).max(20).default(10),
});

export const searchProductsOutputSchema = z.strictObject({
  products: z.array(
    z.strictObject({
      id: z.string(),
      nome: z.string(),
      sale_unit: z.string().nullable(),
      price_cents: z.number().int().nullable(),
      currency: z.string().nullable(),
      ativo: z.boolean(),
    }),
  ),
  /** Quantos VOLTARAM, não quantos existem: o teto é do `limit`, e devolver o
   *  total do catálogo faria a IA afirmar um número que ela não viu. */
  returned: z.number().int(),
});

export const getOrdersInputSchema = z.strictObject({
  customer_id: uuid,
  limit: z.number().int().min(1).max(20).default(10),
});

export const getOrdersOutputSchema = z.strictObject({
  orders: z.array(
    z.strictObject({
      id: z.string(),
      status: z.string(),
      revision: z.number().int(),
      delivery_date: z.string().nullable(),
      total_cents: z.number().int().nullable(),
      currency: z.string().nullable(),
      created_at: z.string(),
      items: z.array(
        z.strictObject({
          id: z.string(),
          product_name: z.string().nullable(),
          quantity: z.string().nullable(),
          sale_unit: z.string().nullable(),
        }),
      ),
    }),
  ),
  returned: z.number().int(),
});

// ─── Pedido ─────────────────────────────────────────────────────────────────

/**
 * `conversation_id` é OBRIGATÓRIO nas duas ações de pedido, inclusive para o
 * executor humano. É o que D33 exige: a confirmação acontece movendo a CONVERSA
 * para `waiting_confirmation`, e uma pendência sem conversa seria uma pendência
 * que nenhum atendente veria no Inbox.
 */
export const createOrderInputSchema = z.strictObject({
  conversation_id: uuid,
  customer_id: uuid,
  idempotency_key: idempotencyKey,
  delivery_date: z.iso.date().nullable().default(null),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  items: z
    .array(
      z.strictObject({
        /** O que o cliente escreveu. É o registro-fonte do item (G-35). */
        requested_text: texto(1000),
        product_id: uuid.nullable().default(null),
        product_name: z.string().trim().min(1).max(200).nullable().default(null),
        sale_unit: z.string().trim().min(1).max(32).nullable().default(null),
        /** Decimal de transporte, sem unidade; o domínio canoniza (quantities.ts). */
        quantity: z.string().trim().min(1).max(20).nullable().default(null),
        unit_price_cents: z.number().int().min(0).nullable().default(null),
      }),
    )
    .min(1)
    .max(200),
});

export const createOrderOutputSchema = z.strictObject({
  order_id: z.string(),
  status: z.string(),
  revision: z.number().int(),
  total_cents: z.number().int().nullable(),
  /** `true` quando a mesma `idempotency_key` já tinha criado este pedido. */
  replayed: z.boolean(),
});

export const updateOrderQuantityInputSchema = z.strictObject({
  conversation_id: uuid,
  order_id: uuid,
  item_id: uuid,
  quantity: texto(20),
  /**
   * A revisão esperada NÃO é escondida da IA. Concorrência otimista é regra do
   * domínio (`assertOrderRevision`), e resolvê-la por dentro — lendo a revisão
   * atual e mandando ela mesma — transformaria "alguém editou no meio" em
   * sobrescrita silenciosa. A IA recebe a revisão em `get_orders`.
   */
  expected_revision: z.number().int().min(1),
  idempotency_key: idempotencyKey,
});

export const updateOrderQuantityOutputSchema = z.strictObject({
  order_id: z.string(),
  item_id: z.string(),
  quantity: z.string(),
  revision: z.number().int(),
  replayed: z.boolean(),
});

// ─── Tarefa ─────────────────────────────────────────────────────────────────

export const createTaskInputSchema = z.strictObject({
  /** A tarefa da Fase 1 é VINCULADA a um pedido (`src/crm/work/service.ts`). */
  order_id: uuid,
  title: texto(255),
  description: z.string().trim().max(5000).nullable().default(null),
  due_date: z.string().datetime({ offset: true }).nullable().default(null),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigned_to: uuid.nullable().default(null),
  /** Vira o `command_id` do comando de domínio, que é a chave do recibo. */
  idempotency_key: uuid,
});

export const createTaskOutputSchema = z.strictObject({
  task_id: z.string(),
  status: z.string(),
  revision: z.number().int(),
  replayed: z.boolean(),
});

// ─── Conversa ───────────────────────────────────────────────────────────────

export const transferToHumanInputSchema = z.strictObject({
  conversation_id: uuid,
  reason: z.enum(HANDOFF_REASONS),
  /** §5.11 pede ≥1 frase. O resumo de sete campos é de F05; aqui é o texto. */
  summary: texto(2000),
});

export const transferToHumanOutputSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  inbox_item_id: z.string(),
});

export const requestConfirmationInputSchema = z.strictObject({
  conversation_id: uuid,
  question: texto(4096),
  idempotency_key: idempotencyKey.optional(),
});

export const sendMessageInputSchema = z.strictObject({
  conversation_id: uuid,
  body: texto(4096),
  /**
   * Opcional: sem ela, `execute()` usa o id da mensagem recém-gravada. É o que
   * faz "enviar duas vezes o mesmo texto" continuar sendo DOIS envios (duas
   * mensagens, dois ids) e "reprocessar o mesmo envio" continuar sendo um.
   */
  idempotency_key: idempotencyKey.optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const sendMessageOutputSchema = z.strictObject({
  message_id: z.uuid(),
  job_id: z.uuid(),
  /** `false` quando a fila já tinha o job desta mensagem (idempotência). */
  enqueued: z.boolean(),
});

export type SendMessageOutput = z.infer<typeof sendMessageOutputSchema>;

export const resumeAiInputSchema = z.strictObject({ conversation_id: uuid });

/** `from`/`to` porque `transition()` devolve o par — e o par é a prova. */
export const transitionOutputSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type UpdateOrderQuantityInput = z.infer<typeof updateOrderQuantityInputSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type TransferToHumanInput = z.infer<typeof transferToHumanInputSchema>;
export type RequestConfirmationInput = z.infer<typeof requestConfirmationInputSchema>;
export type ResumeAiInput = z.infer<typeof resumeAiInputSchema>;
export type GetCustomerInput = z.infer<typeof getCustomerInputSchema>;
export type SearchProductsInput = z.infer<typeof searchProductsInputSchema>;
export type GetOrdersInput = z.infer<typeof getOrdersInputSchema>;
