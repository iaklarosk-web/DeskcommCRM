"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import {
  displayDateOnly,
  displayMoney,
  statusLabel,
} from "@/app/app/orders/_presentation";
import type { ApiList, OrderSummary } from "@/app/app/orders/_types";

interface Props {
  contactId: string;
  canCreate: boolean;
}

/** A chave descarta página/resposta anterior ao trocar o contato. */
export function ContactOrders(props: Props) {
  return <ContactOrdersContent key={props.contactId} {...props} />;
}

function ContactOrdersContent({ contactId, canCreate }: Props) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [page, setPage] = React.useState(1);
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<{
    page: number;
    attempt: number;
    response: ApiList<OrderSummary> | null;
    error: boolean;
  } | null>(null);
  const current =
    result?.page === page && result.attempt === attempt ? result : null;
  const response = current?.response ?? null;
  const error = current?.error ?? false;

  React.useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      contact_id: contactId,
      page: String(page),
      limit: "25",
    });
    void apiClient
      .get<ApiList<OrderSummary>>(`/api/v1/crm-orders?${query}`, {
        signal: controller.signal,
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ page, attempt, response: data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ page, attempt, response: null, error: true });
      });
    return () => controller.abort();
  }, [contactId, page, attempt]);

  return (
    <Card
      className="space-y-3 rounded-md p-4"
      aria-label={t("Pedidos do contato")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("Pedidos do contato")}</h2>
        {canCreate && (
          <Button asChild>
            <Link
              href={`/app/orders?new=1&contact_id=${encodeURIComponent(contactId)}`}
            >
              {t("Novo pedido para este contato")}
            </Link>
          </Button>
        )}
      </div>
      {error ? (
        <div className="space-y-2">
          <p role="alert">{t("Não foi possível carregar pedidos.")}</p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : !response ? (
        <p role="status">{t("Carregando pedidos…")}</p>
      ) : response.data.length === 0 ? (
        <p>{t("Nenhum pedido encontrado.")}</p>
      ) : (
        <ul className="space-y-2">
          {response.data.map((order) => (
            <li key={order.id} className="rounded-md border p-3">
              <Link className="underline" href={`/app/orders/${order.id}`}>
                {t("Pedido")} {order.id.slice(0, 8)} ·{" "}
                {statusLabel(order.status, t)}
              </Link>
              <p className="text-sm text-muted-foreground">
                {displayDateOnly(order.delivery_date, locale) ??
                  t("Entrega não definida")}{" "}
                · {displayMoney(order.total_cents, order.currency, t)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-2" aria-label={t("Paginação de pedidos")}>
        {page > 1 && (
          <Button
            variant="outline"
            onClick={() => setPage((value) => value - 1)}
          >
            {t("Anterior")}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!response?.meta.has_more || error}
          onClick={() => setPage((value) => value + 1)}
        >
          {t("Próxima")}
        </Button>
      </nav>
    </Card>
  );
}
