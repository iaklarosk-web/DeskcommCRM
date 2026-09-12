# F02-T10 — relatório diário de pedidos

`GET /api/v1/crm-orders/daily` exige os dois parâmetros, sem valores padrão:

- `date=YYYY-MM-DD`;
- `basis=delivery_date|created_at`.

`delivery_date` compara a coluna `date` literalmente. `created_at` calcula o
intervalo civil no timezone IANA da organização, incluindo transições de horário
de verão. A resposta sempre declara data, critério, timezone e os status
incluídos: `confirmed`, `in_production` e `delivered`. `draft` e `cancelled` são
contados separadamente e não aparecem nos detalhes elegíveis.

O serviço usa `withTenant` e uma única consulta SQL para autorização, detalhes e
itens. Membro ativo `viewer+` pode ler; platform admin direto é negado; suporte
somente lê a organização da sessão acompanhada enquanto suporte, autoridade de
plataforma, organização e sessão Auth permanecem ativos. Todas as relações usam
`organization_id` explícito.

A consulta não pagina nem limita. A UI e a impressão consomem o mesmo DTO já
carregado. Cada pedido elegível informa revisão, contato atual, snapshots de
empresa/produto/unidade/moeda e todos os itens. O relatório revalida quantidade,
preço, total de linha, moeda e total do pedido pelas regras exatas dos pedidos.
Pedido inconsistente permanece visível com `included_in_totals:false` e códigos
em `pending`, sem contaminar grupos ou totais.

Grupos distinguem item de catálogo e item sem vínculo, além de `product_id`,
descrição snapshot, unidade e moeda. Quantidade agregada usa milésimos e o
formato canônico; centavos agregados são strings decimais para não perder
precisão nem impor teto artificial ao relatório.

## DTO

```ts
type DailyOrderReport = {
  criteria: {
    date: string;
    basis: "delivery_date" | "created_at";
    timezone: string;
    statuses_included: readonly ["confirmed", "in_production", "delivered"];
  };
  generated_at: string;
  denominators: {
    matching_orders: number;
    eligible_orders: number;
    included_orders: number;
    pending_orders: number;
    excluded_status_orders: { draft: number; cancelled: number };
    included_items: number;
    groups: number;
  };
  orders: DailyOrderDetail[];
  groups: Array<{
    kind: "catalog" | "unlinked";
    product_id: string | null;
    description: string;
    sale_unit: string;
    currency: string;
    quantity: string;
    total_cents: string;
    items: number;
    orders: number;
  }>;
  currency_totals: Array<{ currency: string; total_cents: string }>;
};
```

Não há mutation, endpoint separado de impressão, critério implícito, conversão
de unidade, agrupamento entre moedas nem consulta ao estado atual do catálogo.

O recorte inclui `organization: { id, name }`, lido da identidade canônica na mesma consulta. Tela e cabeçalho impresso usam esse snapshot da empresa, evitando vias sem identificação.
