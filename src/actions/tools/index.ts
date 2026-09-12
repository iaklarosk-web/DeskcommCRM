/**
 * O mapa nome → função de domínio (§5.8, "Esconde: … o mapeamento tool →
 * função de domínio").
 *
 * É registro TOTAL sobre os nomes do catálogo: `Record<string, ToolRunner>`
 * mais a conferência abaixo. Entrada nova em `catalog.ts` sem handler aqui
 * quebra no CARREGAMENTO do módulo — não na primeira vez que alguém chamar a
 * tool em produção.
 */
import { ACTION_CATALOG } from "../catalog";

import { getCustomer, getOrders, searchProducts } from "./leitura";
import { createOrder, createTask, updateOrderQuantity } from "./pedido";
import { requestConfirmation, resumeAi, sendMessage, transferToHuman } from "./conversa";
import { deleteCustomerData, exportCustomerData } from "./lgpd";
import type { ToolRunner } from "./contrato";

const HANDLERS: Readonly<Record<string, ToolRunner>> = {
  get_customer: getCustomer,
  search_products: searchProducts,
  get_orders: getOrders,
  create_order: createOrder,
  update_order_quantity: updateOrderQuantity,
  create_task: createTask,
  transfer_to_human: transferToHuman,
  request_confirmation: requestConfirmation,
  send_message: sendMessage,
  resume_ai: resumeAi,
  export_customer_data: exportCustomerData,
  delete_customer_data: deleteCustomerData,
};

const SEM_HANDLER = ACTION_CATALOG.filter((entrada) => !(entrada.name in HANDLERS));
if (SEM_HANDLER.length > 0) {
  throw new Error(
    `entrada do catálogo sem função de domínio: ${SEM_HANDLER.map((e) => e.name).join(", ")}`,
  );
}

const SEM_ENTRADA = Object.keys(HANDLERS).filter(
  (nome) => !ACTION_CATALOG.some((entrada) => entrada.name === nome),
);
if (SEM_ENTRADA.length > 0) {
  // O lado que ninguém lembra: handler órfão é efeito colateral que existe no
  // código sem linha de política dizendo quem pode executá-lo.
  throw new Error(`função de domínio sem entrada no catálogo: ${SEM_ENTRADA.join(", ")}`);
}

/** `null` quando o nome não tem handler — nunca exceção (§5.8, inv. 4). */
export function findHandler(name: string): ToolRunner | null {
  return HANDLERS[name] ?? null;
}

/** Os nomes que TÊM handler, em ordem estável. Nunca escritos à mão. */
export const ACTION_HANDLER_NAMES: readonly string[] = Object.freeze(Object.keys(HANDLERS));

export {
  bind,
  exigirUsuario,
  type ActionActor,
  type ActionDenyReason,
  type ExecuteDeps,
  type ToolCtx,
  type ToolOutcome,
  type ToolRunner,
} from "./contrato";
