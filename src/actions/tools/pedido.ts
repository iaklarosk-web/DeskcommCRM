/**
 * As três tools que ESCREVEM no CRM: `create_order`, `update_order_quantity` e
 * `create_task`.
 *
 * As três delegam aos serviços transacionais da F02 — `executeOrderCommand` e
 * `executeLinkedTaskCommand` — e não reimplementam nada: recibo idempotente,
 * concorrência otimista por revisão, trava de contato, evento de domínio e
 * auditoria já são de lá (§5.5). A tool monta o comando e traduz a recusa.
 *
 * ─── LIMITE DECLARADO: executor não-humano ────────────────────────────────
 *
 * Os serviços da F02 exigem executor HUMANO com sessão
 * (`authorizeCrmCommand`: `ctx.source === "session"` e
 * `executor.user_id === ctx.user_id`). Com o default D33
 * (`actions.confirm_from_risk = "medium"`), `create_order` e
 * `update_order_quantity` pedidos pela IA NUNCA chegam aqui como IA: viram
 * pendência e são executados na aprovação, pelo `attendant` — que é humano e
 * tem sessão. É o desenho de D33 funcionando.
 *
 * Sobram dois caminhos em que um executor não-humano alcançaria o domínio:
 * `create_task` (confirmação `none`) e as duas de pedido num tenant que tenha
 * relaxado `confirm_from_risk` para `high`. Nos dois, o domínio recusa e a tool
 * devolve `{ok:false, reason:"domain_rejected"}` com o código do domínio na
 * auditoria. NÃO é um caminho maquiado de verde: é a regra da F02 valendo, e
 * abrir a escrita a executor não-humano é decisão de §5.5, não desta task.
 */
import { randomUUID } from "node:crypto";

import { CrmAuthorizationError } from "@/src/crm/authorization";
import { getOrderView } from "@/src/crm/reads";
import { OrderServiceError, executeOrderCommand } from "@/src/crm/orders/service";
import { OrderQuantityError } from "@/src/crm/orders/quantities";
import { OrderCommandError } from "@/src/crm/orders/state";
import { CrmWorkServiceError, executeLinkedTaskCommand } from "@/src/crm/work/service";
import type { TrustedCrmExecutor } from "@/src/crm/authorization";

import {
  createOrderInputSchema,
  createTaskInputSchema,
  updateOrderQuantityInputSchema,
} from "../schemas";
import { bind, exigirUsuario, type ActionActor, type ToolOutcome, type ToolRunner } from "./contrato";

/**
 * O executor confiável que os serviços da F02 aceitam.
 *
 * `null` quando o ator não é um humano identificado — e o chamador devolve
 * `domain_rejected` ANTES de abrir transação, em vez de deixar o serviço subir
 * `CrmAuthorizationError` no meio dela.
 */
function executorDeDominio(actor: ActionActor): TrustedCrmExecutor | null {
  const userId = exigirUsuario(actor);
  return userId === null ? null : { type: "human", user_id: userId };
}

/**
 * As quatro exceções que o domínio de pedido/tarefa usa para dizer "não".
 * Qualquer outra SOBE: banco fora do ar não é recusa de política, e engoli-la
 * aqui transformaria defeito em `denied` contado como comportamento normal.
 */
function recusaDoDominio(erro: unknown, resourceId: string | null): ToolOutcome {
  if (
    erro instanceof OrderServiceError ||
    erro instanceof OrderCommandError ||
    erro instanceof OrderQuantityError ||
    erro instanceof CrmWorkServiceError ||
    erro instanceof CrmAuthorizationError
  ) {
    return { ok: false, reason: "domain_rejected", resourceId, detalhe: erro.code };
  }
  throw erro;
}

export const createOrder: ToolRunner = bind(
  createOrderInputSchema,
  async ({ ctx, actor, deps, requestId }, input) => {
    const executor = executorDeDominio(actor);
    if (executor === null) {
      return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: "non_human_executor_denied" };
    }
    try {
      // Os ids e as posições dos itens são NOSSOS, não da IA (regra 2 de
      // `schemas.ts`): um uuid inventado pelo modelo colidiria com item real.
      const { order, replayed } = await executeOrderCommand(
        ctx,
        executor,
        {
          command: "create_draft",
          idempotency_key: input.idempotency_key,
          contact_id: input.customer_id,
          company_id: null,
          company_name: null,
          channel: "whatsapp",
          delivery_date: input.delivery_date,
          currency: input.currency,
          items: input.items.map((item, indice) => ({
            id: randomUUID(),
            position: indice + 1,
            requested_text: item.requested_text,
            product_id: item.product_id,
            product_name: item.product_name,
            sale_unit: item.sale_unit,
            quantity: item.quantity,
            unit_price_cents: item.unit_price_cents,
            currency: input.currency,
          })),
        },
        { pool: deps.pool, requestId },
      );
      return {
        ok: true,
        output: {
          order_id: order.id,
          status: order.status,
          revision: order.revision,
          total_cents: order.total_cents,
          replayed,
        },
        resourceId: order.id,
      };
    } catch (erro) {
      return recusaDoDominio(erro, null);
    }
  },
);

export const updateOrderQuantity: ToolRunner = bind(
  updateOrderQuantityInputSchema,
  async ({ ctx, actor, deps, requestId }, input) => {
    const executor = executorDeDominio(actor);
    if (executor === null) {
      return {
        ok: false,
        reason: "domain_rejected",
        resourceId: input.order_id,
        detalhe: "non_human_executor_denied",
      };
    }

    // `edit_order` recebe a lista COMPLETA de itens. Ler antes é o que impede
    // que trocar a quantidade de um item apague os outros.
    const antes = await getOrderView(ctx, input.order_id, { pool: deps.pool });
    if (antes === null) {
      return { ok: false, reason: "domain_rejected", resourceId: input.order_id, detalhe: "order_not_found" };
    }
    if (!antes.items.some((item) => item.id === input.item_id)) {
      return { ok: false, reason: "domain_rejected", resourceId: input.order_id, detalhe: "item_not_found" };
    }

    try {
      const { order, replayed } = await executeOrderCommand(
        ctx,
        executor,
        {
          command: "edit_order",
          idempotency_key: input.idempotency_key,
          order_id: input.order_id,
          expected_revision: input.expected_revision,
          items: antes.items.map(({ line_total_cents: _total, ...item }) =>
            item.id === input.item_id ? { ...item, quantity: input.quantity } : item,
          ),
        },
        { pool: deps.pool, requestId },
      );
      const item = order.items.find((linha) => linha.id === input.item_id);
      return {
        ok: true,
        output: {
          order_id: order.id,
          item_id: input.item_id,
          quantity: item?.quantity ?? null,
          revision: order.revision,
          replayed,
        },
        resourceId: order.id,
      };
    } catch (erro) {
      return recusaDoDominio(erro, input.order_id);
    }
  },
);

export const createTask: ToolRunner = bind(
  createTaskInputSchema,
  async ({ ctx, actor, deps, requestId }, input) => {
    const executor = executorDeDominio(actor);
    if (executor === null) {
      return {
        ok: false,
        reason: "domain_rejected",
        resourceId: null,
        detalhe: "non_human_executor_denied",
      };
    }
    try {
      const { result, replayed } = await executeLinkedTaskCommand(
        ctx,
        executor,
        {
          command: "create_linked_task",
          command_id: input.idempotency_key,
          order_id: input.order_id,
          title: input.title,
          description: input.description,
          due_date: input.due_date,
          priority: input.priority,
          assigned_to: input.assigned_to,
        },
        { pool: deps.pool, requestId },
      );
      return {
        ok: true,
        output: {
          task_id: result.task_id,
          status: result.status,
          revision: result.task_revision,
          replayed,
        },
        resourceId: result.task_id,
      };
    } catch (erro) {
      return recusaDoDominio(erro, null);
    }
  },
);
