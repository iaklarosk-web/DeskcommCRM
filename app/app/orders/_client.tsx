"use client";

import { randomId } from "@/lib/random-id";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { CreateDraftCommand } from "@/src/crm/orders/commands";

import { newItem, OrderForm, type DraftItem } from "./_form";
import { displayDateOnly, displayMoney, statusLabel } from "./_presentation";
import type { ApiList, OrderSummary, OrderView } from "./_types";

const LIMIT = 50;

function fingerprint(command: Omit<CreateDraftCommand, "idempotency_key">) {
  return JSON.stringify(command);
}

function commandItems(items: DraftItem[]) {
  return items.map(({ quantity_input: _quantityInput, ...item }) => item);
}

export function OrdersClient({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [status, setStatus] = React.useState("");
  const [deliveryDate, setDeliveryDate] = React.useState("");
  const [data, setData] = React.useState<OrderSummary[] | null>(null);
  const [error, setError] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [more, setMore] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [contactId, setContactId] = React.useState("");
  const [items, setItems] = React.useState<DraftItem[]>([newItem()]);
  const [currency, setCurrency] = React.useState("");
  const [draftDeliveryDate, setDraftDeliveryDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const idempotencyKeys = React.useRef(new Map<string, string>());
  const loadController = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setError(false);
    setData(null);
    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (status) query.set("status", status);
      if (deliveryDate) query.set("delivery_date", deliveryDate);
      const response = await apiClient.get<ApiList<OrderSummary>>(`/api/v1/crm-orders?${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setData(response.data);
      setMore(response.meta.has_more);
    } catch {
      if (controller.signal.aborted) return;
      setError(true);
      setData([]);
    }
  }, [deliveryDate, page, status]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  React.useEffect(() => () => loadController.current?.abort(), []);

  async function createDraft() {
    if (!contactId) {
      setSaveMessage(t("Escolha um contato antes de salvar o pedido."));
      return;
    }
    if (items.some((item) => !item.requested_text.trim())) {
      setSaveMessage(t("Descreva os itens ou remova as linhas vazias antes de salvar."));
      return;
    }
    const draft: Omit<CreateDraftCommand, "idempotency_key"> = {
      command: "create_draft",
      contact_id: contactId,
      company_id: null,
      company_name: null,
      channel: null,
      delivery_date: draftDeliveryDate || null,
      currency: currency || null,
      items: commandItems(items),
    };
    const key = fingerprint(draft);
    const idempotency_key = idempotencyKeys.current.get(key) ?? randomId();
    idempotencyKeys.current.set(key, idempotency_key);
    setSaving(true);
    setSaveMessage(null);
    try {
      const response = await apiClient.post<{
        data: OrderView;
        meta: { replayed: boolean };
      }>(
        "/api/v1/crm-orders/commands",
        { ...draft, idempotency_key },
        { idempotencyKey: idempotency_key },
      );
      idempotencyKeys.current.delete(key);
      setSaveMessage(response.meta.replayed ? t("Pedido já salvo.") : t("Pedido salvo."));
      setCreateOpen(false);
      setContactId("");
      setItems([newItem()]);
      setDraftDeliveryDate("");
      setCurrency("");
      await load();
    } catch (cause: unknown) {
      const statusCode =
        typeof cause === "object" && cause !== null && "status" in cause ? cause.status : null;
      setSaveMessage(
        statusCode === 409
          ? t("O pedido mudou em outra tela. Recarregue antes de tentar novamente.")
          : t("Não foi possível salvar. Seus dados continuam no formulário para tentar novamente."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6" data-testid="tela-pedidos">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("Pedidos")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Acompanhe o que foi combinado e a entrega.")}
          </p>
        </div>
        {podeEditar && (
          <Button onClick={() => setCreateOpen((open) => !open)}>
            {createOpen ? t("Fechar formulário") : t("Novo pedido")}
          </Button>
        )}
      </header>
      {podeEditar && createOpen && (
        <section className="space-y-3 rounded-md border p-4" aria-label={t("Novo pedido")}>
          <h2 className="font-medium">{t("Novo pedido")}</h2>
          <OrderForm
            contactId={contactId}
            onContactChange={setContactId}
            items={items}
            onItemsChange={setItems}
            disabled={saving}
          />
          <label className="grid gap-1 text-sm">
            {t("Entrega em")}
            <input
              type="date"
              value={draftDeliveryDate}
              disabled={saving}
              onChange={(event) => setDraftDeliveryDate(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t("Moeda do pedido")}
            <input
              value={currency}
              maxLength={3}
              placeholder={t("Ex.: BRL")}
              disabled={saving}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <Button disabled={saving} onClick={() => void createDraft()}>
            {saving ? t("Salvando…") : t("Salvar rascunho")}
          </Button>
          {saveMessage && <p role="status">{saveMessage}</p>}
        </section>
      )}
      <div className="flex flex-wrap gap-2 rounded-md border p-2">
        <label>
          {t("Status")}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("Todos os status")}</option>
            <option value="draft">{t("Rascunho")}</option>
            <option value="confirmed">{t("Confirmado")}</option>
            <option value="in_production">{t("Em produção")}</option>
            <option value="delivered">{t("Entregue")}</option>
            <option value="cancelled">{t("Cancelado")}</option>
          </select>
        </label>
        <label>
          {t("Entrega em")}
          <input
            type="date"
            value={deliveryDate}
            onChange={(event) => {
              setDeliveryDate(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {data === null ? (
        <p>{t("Carregando pedidos…")}</p>
      ) : error ? (
        <section>
          <p role="alert">{t("Não foi possível carregar pedidos.")}</p>
          <Button onClick={() => void load()}>{t("Tentar novamente")}</Button>
        </section>
      ) : data.length === 0 ? (
        <p>{t("Nenhum pedido encontrado.")}</p>
      ) : (
        <ul className="space-y-2">
          {data.map((order) => (
            <li key={order.id} className="rounded-md border p-3">
              <Link href={`/app/orders/${order.id}`}>
                {order.contact_name ?? t("Contato sem nome")} · {statusLabel(order.status, t)} ·{" "}
                {displayDateOnly(order.delivery_date, locale) ?? t("Entrega não definida")} ·{" "}
                {displayMoney(order.total_cents, order.currency, t)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-2" aria-label={t("Paginação de pedidos")}>
        {page > 1 && (
          <Button onClick={() => setPage((current) => current - 1)}>{t("Anterior")}</Button>
        )}
        <Button disabled={!more} onClick={() => setPage((current) => current + 1)}>
          {t("Próxima")}
        </Button>
      </nav>
    </main>
  );
}
