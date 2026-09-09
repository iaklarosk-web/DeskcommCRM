"use client";

import { randomId } from "@/lib/random-id";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { EditOrderCommand } from "@/src/crm/orders/commands";

import { OrderForm, type DraftItem } from "../_form";
import { OrderHistory } from "../_history";
import type { OrderView } from "../_types";
import {
  displayDateOnly,
  displayMoney,
  pendingLabel,
  quantityInput,
  statusLabel,
} from "../_presentation";

function commandFingerprint(command: Record<string, unknown>) {
  return JSON.stringify(command);
}

function asDraftItems(order: OrderView): DraftItem[] {
  return order.items.map(({ line_total_cents: _lineTotal, ...item }) => ({
    ...item,
    quantity_input: quantityInput(item.quantity),
  }));
}

function commandItems(items: DraftItem[]) {
  return items
    .filter((item) => item.requested_text.trim().length > 0)
    .map(({ quantity_input: _quantityInput, ...item }) => item);
}

function statusCode(cause: unknown) {
  return typeof cause === "object" && cause !== null && "status" in cause ? cause.status : null;
}

export function OrderDetailClient({
  orderId,
  podeEditar,
}: {
  orderId: string;
  podeEditar: boolean;
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [order, setOrder] = React.useState<OrderView | null>(null);
  const [error, setError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [contactId, setContactId] = React.useState("");
  const [items, setItems] = React.useState<DraftItem[]>([]);
  const [currency, setCurrency] = React.useState("");
  const [needsReload, setNeedsReload] = React.useState(false);
  const [deliveryDate, setDeliveryDate] = React.useState("");
  const keys = React.useRef(new Map<string, string>());
  const loadController = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setError(false);
    try {
      const response = await apiClient.get<{ data: OrderView }>(`/api/v1/crm-orders/${orderId}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setOrder(response.data);
      setContactId(response.data.contact_id);
      setItems(asDraftItems(response.data));
      setDeliveryDate(response.data.delivery_date ?? "");
      setCurrency(response.data.currency ?? "");
      setNeedsReload(false);
      setEditing(false);
    } catch {
      if (controller.signal.aborted) return;
      setError(true);
    }
  }, [orderId]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  React.useEffect(() => () => loadController.current?.abort(), []);

  async function send(payload: Record<string, unknown>) {
    if (needsReload || saving) return;
    const fingerprint = commandFingerprint(payload);
    const idempotency_key = keys.current.get(fingerprint) ?? randomId();
    keys.current.set(fingerprint, idempotency_key);
    setSaving(true);
    setMessage(null);
    try {
      const response = await apiClient.post<{
        data: OrderView;
        meta: { replayed: boolean };
      }>(
        "/api/v1/crm-orders/commands",
        { ...payload, idempotency_key },
        { idempotencyKey: idempotency_key },
      );
      keys.current.delete(fingerprint);
      setOrder(response.data);
      setContactId(response.data.contact_id);
      setItems(asDraftItems(response.data));
      setEditing(false);
      setMessage(response.meta.replayed ? t("Comando já aplicado.") : t("Pedido atualizado."));
      try {
        // A resposta de replay é um recibo, não necessariamente a visão mais nova.
        // Releia antes de permitir outra edição com `expected_revision`.
        const fresh = await apiClient.get<{ data: OrderView }>(`/api/v1/crm-orders/${orderId}`);
        setOrder(fresh.data);
        setContactId(fresh.data.contact_id);
        setItems(asDraftItems(fresh.data));
        setDeliveryDate(fresh.data.delivery_date ?? "");
        setCurrency(fresh.data.currency ?? "");
        setNeedsReload(false);
      } catch {
        setNeedsReload(true);
        setMessage(
          response.meta.replayed
            ? t("Comando já aplicado. Recarregue para obter a revisão atual antes de editar.")
            : t("Pedido atualizado. Recarregue para obter a revisão atual antes de editar."),
        );
      }
    } catch (cause: unknown) {
      if (statusCode(cause) === 409) setNeedsReload(true);
      setMessage(
        statusCode(cause) === 409
          ? t("O pedido mudou em outra tela. Recarregue antes de tentar novamente.")
          : t("Não foi possível salvar. Seus dados continuam no formulário para tentar novamente."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function edit() {
    if (!order || !contactId) {
      setMessage(t("Escolha um contato antes de salvar o pedido."));
      return;
    }
    const payload: Omit<EditOrderCommand, "idempotency_key"> = {
      command: "edit_order",
      order_id: order.id,
      expected_revision: order.revision,
      contact_id: contactId,
      delivery_date: deliveryDate || null,
      currency: currency || null,
      items: commandItems(items),
    };
    await send(payload);
  }

  async function transition(next: "confirm_order" | "advance_order" | "cancel_order") {
    if (!order) return;
    const payload: Record<string, unknown> =
      next === "advance_order"
        ? {
            command: next,
            order_id: order.id,
            expected_revision: order.revision,
            next_status: order.status === "confirmed" ? "in_production" : "delivered",
          }
        : {
            command: next,
            order_id: order.id,
            expected_revision: order.revision,
          };
    await send(payload);
  }

  if (error) {
    return (
      <main className="p-6">
        <p role="alert">{t("Não foi possível carregar pedido.")}</p>
        <Button onClick={() => void load()}>{t("Tentar novamente")}</Button>
      </main>
    );
  }
  if (!order) return <main className="p-6">{t("Carregando pedido…")}</main>;

  const canOperate = podeEditar && order.status !== "delivered" && order.status !== "cancelled";
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6" data-testid="pedido-detalhe">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("Pedido")}</h1>
          <p>
            {order.company_name ?? t("Sem empresa")} · {statusLabel(order.status, t)}
          </p>
        </div>
        {canOperate && !editing && (
          <Button disabled={saving || needsReload} onClick={() => setEditing(true)}>
            {t("Editar pedido")}
          </Button>
        )}
      </header>
      {order.pending.length > 0 && (
        <section className="rounded-md border p-3">
          <h2 className="font-medium">{t("Revisão humana necessária")}</h2>
          <ul>
            {order.pending.map((pending, index) => (
              <li key={`${pending.code}-${pending.item_id ?? index}`}>
                {pending.item_id
                  ? `${t("Item")} ${order.items.find((item) => item.id === pending.item_id)?.position ?? ""}: `
                  : ""}
                {pendingLabel(pending.code, t)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing ? (
        <section className="space-y-3 rounded-md border p-4" aria-label={t("Editar pedido")}>
          <OrderForm
            contactId={contactId}
            onContactChange={setContactId}
            items={items}
            onItemsChange={setItems}
            disabled={saving || needsReload}
            contactLocked
          />
          <label className="grid gap-1 text-sm">
            {t("Entrega em")}
            <input
              type="date"
              value={deliveryDate}
              disabled={saving || needsReload}
              onChange={(event) => setDeliveryDate(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t("Moeda do pedido")}
            <input
              value={currency}
              maxLength={3}
              placeholder={t("Ex.: BRL")}
              disabled={saving || needsReload}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={saving || needsReload} onClick={() => void edit()}>
              {saving ? t("Salvando…") : t("Salvar alterações")}
            </Button>
            <Button
              variant="outline"
              disabled={saving || needsReload}
              onClick={() => {
                setContactId(order.contact_id);
                setItems(asDraftItems(order));
                setDeliveryDate(order.delivery_date ?? "");
                setCurrency(order.currency ?? "");
                setEditing(false);
              }}
            >
              {t("Cancelar edição")}
            </Button>
          </div>
        </section>
      ) : (
        <ul className="space-y-1">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.product_name ?? item.requested_text} ·{" "}
              {item.quantity ?? t("quantidade pendente")} {item.sale_unit ?? ""} ·{" "}
              {displayMoney(item.line_total_cents, item.currency, t)}
            </li>
          ))}
        </ul>
      )}
      {canOperate && !editing && (
        <div className="flex flex-wrap gap-2">
          {order.status === "draft" && (
            <Button
              disabled={saving || needsReload || order.pending.length > 0}
              onClick={() => void transition("confirm_order")}
            >
              {t("Confirmar")}
            </Button>
          )}
          {order.status === "confirmed" && (
            <Button
              disabled={saving || needsReload}
              onClick={() => void transition("advance_order")}
            >
              {t("Iniciar produção")}
            </Button>
          )}
          {order.status === "in_production" && (
            <Button
              disabled={saving || needsReload}
              onClick={() => void transition("advance_order")}
            >
              {t("Marcar como entregue")}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={saving || needsReload}
            onClick={() => void transition("cancel_order")}
          >
            {t("Cancelar pedido")}
          </Button>
        </div>
      )}
      <p>
        {t("Entrega em")}: {displayDateOnly(order.delivery_date, locale) ?? t("A definir")} ·{" "}
        {t("Total")}: {displayMoney(order.total_cents, order.currency, t)}
      </p>
      <OrderHistory orderId={order.id} revision={order.revision} />
      {needsReload && (
        <Button disabled={saving} onClick={() => void load()}>
          {t("Recarregar pedido")}
        </Button>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
