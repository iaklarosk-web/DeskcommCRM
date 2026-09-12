/**
 * As LEITURAS de domínio que as três tools de leitura de D18 consomem
 * (`get_customer`, `search_products`, `get_orders`).
 *
 * Moram no DOMÍNIO e não em `src/actions/tools/` por dois motivos, e o segundo
 * é o que importa:
 *
 * 1. §5.5 diz que o CRM Core "recebe escritas por Actions" — e as leituras
 *    também são dele: quem sabe o que é um cliente é o CRM, não a Action.
 * 2. D18 exige que a IA não tenha SQL livre. A prova é
 *    `grep -rn "fetch(\|\.rpc(\|sql\`" src/actions/tools | wc -l` = 0: a tool
 *    monta o argumento e lê o resultado, e o SQL — parametrizado e sob
 *    `withTenant` — fica aqui, onde o resto do domínio já está.
 *
 * Todo `select` filtra por `organization_id` do `ctx` ALÉM da RLS: id de outro
 * tenant devolve zero linhas em vez de erro, que é o comportamento que
 * F04-T06 cobra.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import { readOrder } from "./orders/repository";
import type { OrderView } from "./orders/types";

export interface LeituraDeps {
  pool?: ServicePool;
}

/**
 * O pedido inteiro, na forma que o COMANDO de edição consome.
 *
 * Existe porque `update_order_quantity` muda UM item e `edit_order` recebe a
 * lista completa: sem esta leitura a tool teria de remontar os outros itens a
 * partir do que a IA lembrar, e o que ela não lembrasse seria apagado.
 * Reusa `readOrder` — o mesmo leitor do serviço de pedidos, não um segundo.
 */
export async function getOrderView(
  ctx: TenantCtx,
  orderId: string,
  deps: LeituraDeps = {},
): Promise<OrderView | null> {
  return withTenant(ctx, async (db) => readOrder(db, ctx.organization_id, orderId), {
    pool: deps.pool,
  });
}

export interface CustomerCard {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  company_id: string | null;
  company_name: string | null;
  orders_count: number;
  last_order_at: string | null;
}

/**
 * O cartão do cliente. Contato anonimizado ou fundido devolve `null`: para o
 * atendimento ele não existe mais, e devolver a casca faria a IA falar de
 * alguém que a LGPD já apagou.
 */
export async function getCustomerCard(
  ctx: TenantCtx,
  customerId: string,
  deps: LeituraDeps = {},
): Promise<CustomerCard | null> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<CustomerCard & { last_order_at: Date | string | null }>(
        `select c.id,
                c.display_name,
                c.phone_number,
                c.company_id,
                emp.legal_name as company_name,
                coalesce(p.total, 0)::int as orders_count,
                p.ultimo as last_order_at
           from public.contacts c
           left join public.crm_companies emp
             on emp.id = c.company_id and emp.organization_id = c.organization_id
           left join lateral (
             select count(*) as total, max(o.created_at) as ultimo
               from public.crm_orders o
              where o.organization_id = c.organization_id and o.contact_id = c.id
           ) p on true
          where c.id = $1 and c.organization_id = $2
            and not c.is_anonymized and c.is_merged_into is null`,
        [customerId, ctx.organization_id],
      );
      const linha = r.rows[0];
      if (linha === undefined) return null;
      return {
        ...linha,
        last_order_at:
          linha.last_order_at === null ? null : new Date(linha.last_order_at).toISOString(),
      };
    },
    { pool: deps.pool },
  );
}

export interface ProductCard {
  id: string;
  nome: string;
  sale_unit: string | null;
  price_cents: number | null;
  currency: string | null;
  ativo: boolean;
}

/**
 * Busca por nome, código ou marca. `ilike` com o termo ESCAPADO: `%` e `_`
 * vindos do cliente são literais, não coringa — sem o escape, a pergunta
 * "tem 100%?" varreria o catálogo inteiro.
 *
 * Produto inativo VOLTA, com a bandeira: esconder faria a IA dizer "não temos"
 * de algo que a loja tem e só está fora de linha, e o item inativo é recusado
 * mais adiante, pelo domínio do pedido (`validateReferences`).
 */
export async function searchProductCards(
  ctx: TenantCtx,
  termo: string,
  limite: number,
  deps: LeituraDeps = {},
): Promise<readonly ProductCard[]> {
  const padrao = `%${termo.replace(/([\\%_])/g, "\\$1")}%`;
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<ProductCard & { price_cents: string | number | null }>(
        `select p.id, p.nome, p.sale_unit,
                p.preco_cents as price_cents, p.moeda as currency, p.ativo
           from public.catalog_products p
          where p.organization_id = $1
            and (p.nome ilike $2 or p.codigo ilike $2 or coalesce(p.marca,'') ilike $2)
          order by p.ativo desc, p.nome
          limit $3`,
        [ctx.organization_id, padrao, limite],
      );
      return r.rows.map((linha) => ({
        ...linha,
        price_cents: linha.price_cents === null ? null : Number(linha.price_cents),
      }));
    },
    { pool: deps.pool },
  );
}

export interface OrderCard {
  id: string;
  status: string;
  revision: number;
  delivery_date: string | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
  items: { id: string; product_name: string | null; quantity: string | null; sale_unit: string | null }[];
}

/**
 * Os pedidos do cliente, do mais novo para o mais velho, com os itens.
 *
 * `revision` VOLTA de propósito: é ela que `update_order_quantity` exige como
 * `expected_revision`. Sem ela na leitura, a IA teria de adivinhar — ou a
 * escrita teria de ler a revisão atual e mandar ela mesma, o que transformaria
 * "alguém editou no meio" em sobrescrita silenciosa.
 */
export async function listOrderCards(
  ctx: TenantCtx,
  customerId: string,
  limite: number,
  deps: LeituraDeps = {},
): Promise<readonly OrderCard[]> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<
        Omit<OrderCard, "created_at" | "total_cents"> & {
          created_at: Date | string;
          total_cents: string | number | null;
        }
      >(
        `select o.id, o.status, o.revision, o.delivery_date::text as delivery_date,
                o.total_cents, o.currency, o.created_at,
                coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', i.id,
                    'product_name', i.product_name_snapshot,
                    'quantity', i.quantity::text,
                    'sale_unit', i.sale_unit_snapshot
                  ) order by i.position, i.id)
                    from public.crm_order_items i
                   where i.organization_id = o.organization_id and i.order_id = o.id
                ), '[]'::jsonb) as items
           from public.crm_orders o
          where o.organization_id = $1 and o.contact_id = $2
          order by o.created_at desc, o.id
          limit $3`,
        [ctx.organization_id, customerId, limite],
      );
      return r.rows.map((linha) => ({
        ...linha,
        created_at: new Date(linha.created_at).toISOString(),
        total_cents: linha.total_cents === null ? null : Number(linha.total_cents),
      }));
    },
    { pool: deps.pool },
  );
}
