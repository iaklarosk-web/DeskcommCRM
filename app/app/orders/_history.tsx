"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import { displayMoney, statusLabel, type Translate } from "./_presentation";

type State = Record<string, unknown>;
type Event = {
  id: string;
  order_revision: number;
  event_type: string;
  changes: { redacted?: boolean; reason?: string; before?: State; after?: State };
  actor_type: string;
  created_at: string;
};

function eventLabel(type: string, t: Translate): string {
  switch (type) {
    case "draft_created":
      return t("Rascunho criado");
    case "order_edited":
      return t("Pedido alterado");
    case "order_confirmed":
      return t("Pedido confirmado");
    case "order_advanced":
      return t("Situação atualizada");
    case "order_cancelled":
      return t("Pedido cancelado");
    default:
      return t("Pedido atualizado");
  }
}

function fieldLabel(field: string, t: Translate): string {
  switch (field) {
    case "delivery_date":
      return t("Entrega");
    case "total_cents":
      return t("Total");
    case "status":
      return t("Situação");
    case "items":
      return t("Itens");
    default:
      return field;
  }
}

function summary(state: State, field: string, t: Translate): string {
  const value = state[field];
  if (field === "items") {
    if (!Array.isArray(value)) return t("Sem itens");
    return `${value.length} ${value.length === 1 ? t("item") : t("itens")}`;
  }
  if (field === "status") {
    return typeof value === "string" ? statusLabel(value, t) : t("Sem situação");
  }
  if (field === "total_cents") {
    return displayMoney(
      typeof value === "number" ? value : null,
      typeof state.currency === "string" ? state.currency : null,
      t,
    );
  }
  return typeof value === "string" && value ? value : t("A definir");
}

function cancellationReason(reason: string, t: Translate): string {
  return reason === "Cancelado pela equipe." ? t("Cancelado pela equipe.") : reason;
}

function changed(event: Event, t: Translate): string {
  if (event.changes.redacted) return t("Detalhes indisponíveis após anonimização.");
  const before = event.changes.before ?? {};
  const after = event.changes.after ?? {};
  const descriptions = ["delivery_date", "total_cents", "status", "items"]
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]) && field in after,
    )
    .map(
      (field) =>
        `${fieldLabel(field, t)}: ${summary(before, field, t)} → ${summary(after, field, t)}.`,
    );
  if (event.changes.reason) descriptions.push(cancellationReason(event.changes.reason, t));
  return descriptions.join(" ");
}

export function OrderHistory({ orderId, revision }: { orderId: string; revision: number }) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [events, setEvents] = React.useState<Event[]>([]);
  const [more, setMore] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const cursor = React.useRef<number | undefined>(undefined);
  const controller = React.useRef<AbortController | null>(null);
  const load = React.useCallback(
    async (reset: boolean) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      if (reset) {
        cursor.current = undefined;
        setEvents([]);
        setMore(false);
      }
      setLoading(true);
      setError(false);
      try {
        const query = new URLSearchParams({ limit: "25" });
        if (!reset && cursor.current) query.set("before_revision", String(cursor.current));
        const response = await apiClient.get<{
          data: Event[];
          meta: { has_more: boolean; before_revision: number | null };
        }>(`/api/v1/crm-orders/${orderId}/events?${query}`, { signal: current.signal });
        if (current.signal.aborted) return;
        setEvents((value) =>
          reset
            ? response.data
            : [
                ...value,
                ...response.data.filter(
                  (item) => !value.some((existing) => existing.id === item.id),
                ),
              ],
        );
        setMore(response.meta.has_more);
        cursor.current = response.meta.before_revision ?? undefined;
      } catch {
        if (!current.signal.aborted) setError(true);
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    },
    [orderId],
  );

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [load, revision]);

  return (
    <section className="space-y-2" aria-label={t("Histórico do pedido")}>
      <h2 className="font-medium">{t("Histórico")}</h2>
      {error ? (
        <>
          <p role="alert">{t("Não foi possível carregar o histórico.")}</p>
          <Button onClick={() => void load(true)}>{t("Tentar novamente")}</Button>
        </>
      ) : (
        events.map((event) => {
          const description = changed(event, t);
          return (
            <article key={event.id} className="rounded-md border p-2">
              <p>
                {eventLabel(event.event_type, t)} · {t("revisão")} {event.order_revision}
              </p>
              <p className="text-sm">
                {event.actor_type === "user" ? t("Equipe") : t("Automação")} ·{" "}
                {new Date(event.created_at).toLocaleString(locale)}
              </p>
              {description && <p>{description}</p>}
            </article>
          );
        })
      )}
      {loading ? (
        <p>{t("Carregando histórico…")}</p>
      ) : more ? (
        <Button onClick={() => void load(false)}>{t("Carregar mais")}</Button>
      ) : null}
    </section>
  );
}
