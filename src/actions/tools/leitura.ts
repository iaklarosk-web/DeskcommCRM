/**
 * As três tools de LEITURA de D18: `get_customer`, `search_products`,
 * `get_orders`.
 *
 * Nenhuma escreve, nenhuma monta consulta: a leitura é do domínio
 * (`src/crm/reads.ts`), que filtra por `organization_id` do `ctx` além da RLS.
 * Id de outro tenant devolve ZERO linhas — não erro: "não achei" é resposta, e
 * um erro diria à IA que o id existe em algum lugar.
 */
import { getCustomerCard, listOrderCards, searchProductCards } from "@/src/crm/reads";

import {
  getCustomerInputSchema,
  getOrdersInputSchema,
  searchProductsInputSchema,
} from "../schemas";
import { bind, type ToolRunner } from "./contrato";

export const getCustomer: ToolRunner = bind(
  getCustomerInputSchema,
  async ({ ctx, deps }, input) => {
    const cliente = await getCustomerCard(ctx, input.customer_id, { pool: deps.pool });
    return {
      ok: true,
      output: { customer: cliente },
      // O recurso auditado é o id PEDIDO, mesmo quando não existe: auditoria
      // registra a tentativa, e "perguntou por um id de outro tenant" é
      // exatamente o que se quer poder contar depois.
      resourceId: input.customer_id,
    };
  },
);

export const searchProducts: ToolRunner = bind(
  searchProductsInputSchema,
  async ({ ctx, deps }, input) => {
    const produtos = await searchProductCards(ctx, input.query, input.limit, {
      pool: deps.pool,
    });
    return {
      ok: true,
      output: { products: [...produtos], returned: produtos.length },
      // Busca não tem recurso: o termo do cliente NÃO entra na auditoria (é
      // texto dele), e um id inventado seria pior que nenhum.
      resourceId: null,
    };
  },
);

export const getOrders: ToolRunner = bind(
  getOrdersInputSchema,
  async ({ ctx, deps }, input) => {
    const pedidos = await listOrderCards(ctx, input.customer_id, input.limit, {
      pool: deps.pool,
    });
    return {
      ok: true,
      output: { orders: [...pedidos], returned: pedidos.length },
      resourceId: input.customer_id,
    };
  },
);
