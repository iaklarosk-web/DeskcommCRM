"use client";

import Link from "next/link";
import * as React from "react";
import { pendingLabel, statusLabel } from "@/app/app/orders/_presentation";
import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { DailyOrderBasis, DailyOrderReport } from "@/src/crm/orders/daily";

function formatQuantity(value: string, locale: string) {
  const [whole, fraction = ""] = value.split(".");
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ",";
  const significantFraction = fraction.replace(/0+$/, "");
  return `${BigInt(whole ?? "0").toLocaleString(locale)}${significantFraction ? `${decimal}${significantFraction}` : ""}`;
}
function formatCents(value: string, currency: string, locale: string) {
  const cents = BigInt(value),
    whole = cents / 100n,
    fraction = (cents % 100n).toString().padStart(2, "0");
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ",";
  return `${whole.toLocaleString(locale)}${decimal}${fraction} ${currency}`;
}

export function DailyOrdersClient() {
  const t = useT(),
    locale = useTagDeIdioma();
  const [date, setDate] = React.useState(""),
    [basis, setBasis] = React.useState<DailyOrderBasis | "">("");
  const [report, setReport] = React.useState<DailyOrderReport | null>(null),
    [error, setError] = React.useState(false),
    [loading, setLoading] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  const load = React.useCallback(async () => {
    if (!date || !basis) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(false);
    try {
      const response = await apiClient.get<{ data: DailyOrderReport }>(
        `/api/v1/crm-orders/daily?${new URLSearchParams({ date, basis })}`,
        { signal: current.signal },
      );
      if (!current.signal.aborted) setReport(response.data);
    } catch {
      if (!current.signal.aborted) {
        setReport(null);
        setError(true);
      }
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [basis, date]);
  React.useEffect(() => () => controller.current?.abort(), []);
  return (
    <main className="daily-print-root mx-auto max-w-5xl space-y-4 p-6" data-testid="pedidos-do-dia">
      <header className="daily-print-chrome flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("Pedidos do dia")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Escolha o recorte antes de consultar. A lista não define produção ou rota.")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/orders">{t("Voltar aos pedidos")}</Link>
        </Button>
      </header>
      <section
        className="daily-print-chrome flex flex-wrap items-end gap-3 rounded-md border p-3"
        aria-label={t("Recorte da lista")}
      >
        <label className="grid gap-1 text-sm">
          {t("Data")}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          {t("Critério obrigatório")}
          <select
            aria-label={t("Critério obrigatório")}
            value={basis}
            onChange={(event) => setBasis(event.target.value as DailyOrderBasis | "")}
          >
            <option value="">{t("Escolha o critério")}</option>
            <option value="delivery_date">{t("Data de entrega")}</option>
            <option value="created_at">{t("Data de criação")}</option>
          </select>
        </label>
        <Button disabled={!date || !basis || loading} onClick={() => void load()}>
          {loading ? t("Carregando…") : t("Consultar")}
        </Button>
      </section>
      {!date || !basis ? (
        <p role="status">{t("Informe data e critério para ver o relatório.")}</p>
      ) : null}
      {loading ? <p role="status">{t("Carregando relatório…")}</p> : null}
      {error ? (
        <section>
          <p role="alert">{t("Não foi possível carregar a lista do dia.")}</p>
          <Button onClick={() => void load()}>{t("Tentar novamente")}</Button>
        </section>
      ) : null}
      {report ? (
        <DailyReportView report={report} locale={locale} t={t} onPrint={() => window.print()} />
      ) : null}
    </main>
  );
}
function DailyReportView({
  report,
  locale,
  t,
  onPrint,
}: {
  report: DailyOrderReport;
  locale: string;
  t: (text: string) => string;
  onPrint: () => void;
}) {
  const criterion =
    report.criteria.basis === "delivery_date" ? t("data de entrega") : t("data de criação");
  return (
    <section className="daily-print-content space-y-4" aria-label={t("Relatório diário")}>
      <div className="rounded-md border p-3">
        <h2 className="font-semibold">
          {t("Pedidos do dia")} · {report.criteria.organization.name}
        </h2>
        <p>
          {t("Recorte")}: {report.criteria.date} · {criterion} · {report.criteria.timezone}
        </p>
        <p>
          {t("Status incluídos")}:{" "}
          {report.criteria.statuses_included.map((status) => statusLabel(status, t)).join(", ")}
        </p>
        <p>
          {t("Excluídos")}: {t("Rascunho")} {report.denominators.excluded_status_orders.draft} ·{" "}
          {t("Cancelado")} {report.denominators.excluded_status_orders.cancelled}
        </p>
        <p>
          {t("Gerado em")}:{" "}
          {new Date(report.generated_at).toLocaleString(locale, {
            timeZone: report.criteria.timezone,
          })}
        </p>
        <p>
          {t("Pedidos incluídos")}: {report.denominators.included_orders}/
          {report.denominators.eligible_orders} · {t("Itens")}: {report.denominators.included_items}{" "}
          · {t("Pendências")}: {report.denominators.pending_orders}
        </p>
        <Button className="daily-print-chrome mt-2" variant="outline" onClick={onPrint}>
          {t("Imprimir")}
        </Button>
      </div>
      <section>
        <h2 className="font-medium">{t("Por produto")}</h2>
        {report.groups.length === 0 ? (
          <p>{t("Nenhum item elegível neste recorte.")}</p>
        ) : (
          <ul className="space-y-2">
            {report.groups.map((group, index) => (
              <li
                className="break-inside-avoid rounded-md border p-3"
                key={`${group.kind}-${group.product_id ?? group.description}-${index}`}
              >
                <p>
                  {group.description} · {formatQuantity(group.quantity, locale)} {group.sale_unit}
                </p>
                <p>{formatCents(group.total_cents, group.currency, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="font-medium">{t("Totais por moeda")}</h2>
        <ul>
          {report.currency_totals.map((total) => (
            <li key={total.currency}>{formatCents(total.total_cents, total.currency, locale)}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium">{t("Por pedido")}</h2>
        {report.orders.length === 0 ? (
          <p>{t("Nenhum pedido encontrado neste recorte.")}</p>
        ) : (
          <ul className="space-y-2">
            {report.orders.map((order) => (
              <li className="break-inside-avoid rounded-md border p-3" key={order.order_id}>
                <Link className="underline" href={`/app/orders/${order.order_id}`}>
                  {order.contact.current_name ?? t("Contato sem nome")} · {t("Pedido")}{" "}
                  {order.order_id}
                </Link>
                <p>
                  {order.company.name_snapshot ?? t("Sem empresa")} · {statusLabel(order.status, t)}{" "}
                  · {t("Revisão")} {order.revision}
                </p>
                <p>
                  {t("Entrega em")}: {order.delivery_date ?? t("A definir")} · {t("Criado em")}:{" "}
                  {new Date(order.created_at).toLocaleString(locale, {
                    timeZone: report.criteria.timezone,
                  })}
                </p>
                {!order.included_in_totals && (
                  <p role="status">{t("Pendente: fora dos totais até revisão humana.")}</p>
                )}
                {order.pending.length > 0 && (
                  <ul>
                    {order.pending.map((pending, index) => (
                      <li key={`${pending.code}-${pending.item_id ?? index}`}>
                        {pendingLabel(pending.code, t)}
                      </li>
                    ))}
                  </ul>
                )}
                <ul>
                  {order.items.map((item) => (
                    <li key={item.id}>
                      {item.position}. {item.product_name_snapshot ?? item.requested_text} ·{" "}
                      {item.quantity === null
                        ? t("quantidade pendente")
                        : formatQuantity(item.quantity, locale)}{" "}
                      {item.sale_unit_snapshot ?? ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
