"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { randomId } from "@/lib/random-id";
import { assertMatchingSaleUnit, parseBrazilianQuantity } from "@/src/crm/orders/quantities";
import type { OrderCheckResult, OrderChecksView } from "@/src/crm/orders/checks-contracts";

type CurrentCheck = OrderChecksView["items"][number];
type Item = {
  id: string;
  product_name: string | null;
  requested_text: string;
  quantity: string | null;
  sale_unit: string | null;
};
function checkLabel(state: CurrentCheck["state"], t: (text: string) => string) {
  return state === "checked" ? t("Completo") : state === "partial" ? t("Parcial") : t("Pendente");
}
function displayQuantity(value: string | null) {
  return value?.replace(".", ",") ?? "—";
}
function normalize(input: string, unit: string | null) {
  if (/^0(?:[,.]0{1,3})?$/.test(input.trim())) return "0.000";
  const parsed = parseBrazilianQuantity(input);
  if (unit === null) throw new Error("sale_unit_required");
  assertMatchingSaleUnit(parsed.requested_unit, unit);
  return parsed.quantity;
}

export function OrderChecks({
  orderId,
  revision,
  canEdit,
  items,
}: {
  orderId: string;
  revision: number;
  canEdit: boolean;
  items: Item[];
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [view, setView] = React.useState<OrderChecksView | null>(null);
  const [history, setHistory] = React.useState<OrderCheckResult[]>([]);
  const [error, setError] = React.useState(false),
    [loading, setLoading] = React.useState(true),
    [saving, setSaving] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false),
    [next, setNext] = React.useState<string | null>(null);
  const request = React.useRef<AbortController | null>(null),
    keys = React.useRef(new Map<string, string>());
  const load = React.useCallback(
    async (before?: string) => {
      request.current?.abort();
      const current = new AbortController();
      request.current = current;
      setError(false);
      if (!before) setLoading(true);
      try {
        const query = before ? `?before_sequence=${encodeURIComponent(before)}` : "";
        const response = await apiClient.get<{ data: OrderChecksView }>(
          `/api/v1/crm-orders/${orderId}/checks${query}`,
          { signal: current.signal },
        );
        if (current.signal.aborted) return;
        setView(response.data);
        setStale(response.data.order_revision !== revision);
        setNext(response.data.next_before_sequence);
        setHistory((previous) =>
          before
            ? [
                ...previous,
                ...response.data.history.filter(
                  (event) => !previous.some((known) => known.event_id === event.event_id),
                ),
              ]
            : response.data.history,
        );
      } catch {
        if (!current.signal.aborted) setError(true);
      } finally {
        if (!current.signal.aborted && !before) setLoading(false);
      }
    },
    [orderId, revision],
  );
  React.useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  async function save(itemId: string, input: string, unit: string | null) {
    if (!canEdit || saving || stale) return;
    let checkedQuantity: string;
    try {
      checkedQuantity = normalize(input, unit);
    } catch {
      setError(true);
      return;
    }
    const fingerprint = `${revision}:${itemId}:${checkedQuantity}`,
      idempotency_key = keys.current.get(fingerprint) ?? randomId();
    keys.current.set(fingerprint, idempotency_key);
    setSaving(itemId);
    setError(false);
    try {
      await apiClient.post(
        `/api/v1/crm-orders/${orderId}/checks`,
        {
          idempotency_key,
          expected_revision: revision,
          item_id: itemId,
          checked_quantity: checkedQuantity,
        },
        { idempotencyKey: idempotency_key },
      );
      keys.current.delete(fingerprint);
      await load();
    } catch (cause: unknown) {
      if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 409)
        setStale(true);
      else setError(true);
    } finally {
      setSaving(null);
    }
  }
  const itemNames = new Map(
    items.map((item) => [item.id, item.product_name ?? item.requested_text]),
  );
  return (
    <section className="space-y-3 rounded-md border p-3" aria-label={t("Conferência")}>
      <h2 className="font-medium">{t("Conferência")}</h2>
      {loading ? <p role="status">{t("Carregando conferência…")}</p> : null}
      {error ? (
        <div>
          <p role="alert">
            {t(
              "Não foi possível carregar ou salvar a conferência. Confira a quantidade e tente novamente.",
            )}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : null}
      {stale ? (
        <div>
          <p role="alert">{t("O pedido mudou. Recarregue antes de conferir.")}</p>
          <Button onClick={() => window.location.reload()}>{t("Recarregar pedido")}</Button>
        </div>
      ) : null}
      {!loading && !error && view?.items.length === 0 ? (
        <p>{t("Não há itens para conferir nesta revisão.")}</p>
      ) : null}
      {!loading && view ? (
        <ul className="space-y-2">
          {view.items.map((check) => (
            <CheckRow
              key={check.item_id}
              itemName={itemNames.get(check.item_id) ?? t("Item")}
              check={check}
              revision={revision}
              canEdit={canEdit && !stale && !error}
              busy={saving === check.item_id}
              onSave={save}
              t={t}
            />
          ))}
        </ul>
      ) : null}
      {!loading && view && (
        <section>
          <h3 className="font-medium">{t("Histórico de conferência")}</h3>
          {history.length === 0 ? (
            <p>{t("Nenhuma conferência registrada.")}</p>
          ) : (
            <ul>
              {history.map((event) => (
                <li key={event.event_id}>
                  {itemNames.get(event.item_id) ?? t("Item")} · {checkLabel(event.state, t)} ·{" "}
                  {displayQuantity(event.checked_quantity)} {event.sale_unit ?? ""} · {t("Revisão")}{" "}
                  {event.order_revision}
                  {" · "}<time dateTime={event.checked_at}>{new Date(event.checked_at).toLocaleString(locale)}</time>
                </li>
              ))}
            </ul>
          )}
          {next && (
            <Button variant="outline" onClick={() => void load(next)}>
              {t("Carregar histórico anterior")}
            </Button>
          )}
        </section>
      )}
    </section>
  );
}
function CheckRow({
  itemName,
  check,
  revision,
  canEdit,
  busy,
  onSave,
  t,
}: {
  itemName: string;
  check: CurrentCheck;
  revision: number;
  canEdit: boolean;
  busy: boolean;
  onSave: (id: string, input: string, unit: string | null) => Promise<void>;
  t: (text: string) => string;
}) {
  const signature = `${revision}:${check.event_sequence ?? "none"}:${check.checked_quantity}`;
  const [value, setValue] = React.useState(displayQuantity(check.checked_quantity));
  const previous = React.useRef(signature);
  React.useEffect(() => {
    if (previous.current !== signature) {
      previous.current = signature;
      setValue(displayQuantity(check.checked_quantity));
    }
  }, [check.checked_quantity, signature]);
  return (
    <li className="flex flex-wrap items-end gap-2">
      <p className="min-w-48">
        {itemName} · {displayQuantity(check.ordered_quantity)} {check.sale_unit ?? ""} ·{" "}
        {checkLabel(check.state, t)}
      </p>
      {canEdit && (
        <>
          <label className="grid gap-1 text-sm">
            {t("Quantidade conferida")}
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <Button
            disabled={busy}
            onClick={() => void onSave(check.item_id, value, check.sale_unit)}
          >
            {busy ? t("Salvando…") : t("Registrar conferência")}
          </Button>
        </>
      )}
    </li>
  );
}
