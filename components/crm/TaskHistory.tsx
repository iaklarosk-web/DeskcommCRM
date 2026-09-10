"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { displayWorkDate, useWorkList } from "./work-ui";
import type { LinkedTaskStatus } from "./LinkedOrderTasks";

export interface TaskHistoryEvent {
  id: string;
  task_id: string;
  order_id: string;
  contact_id: string;
  task_revision: number;
  event_type: "created" | "edited" | "status_changed";
  from_status: LinkedTaskStatus | null;
  to_status: LinkedTaskStatus;
  actor_type: string;
  actor_id: string;
  created_at: string;
}
export interface TaskHistoryProps {
  contactId: string;
  orderId?: string;
  authorNames?: Record<string, string>;
  reloadKey?: number;
}

export function TaskHistory(props: TaskHistoryProps) {
  return (
    <HistoryScope
      key={`${props.contactId}:${props.orderId ?? ""}:${props.reloadKey ?? 0}`}
      {...props}
    />
  );
}

function HistoryScope({ contactId, orderId, authorNames = {} }: TaskHistoryProps) {
  const t = useT();
  const locale = useTagDeIdioma();
  const query = new URLSearchParams({ contact_id: contactId, limit: "25" });
  if (orderId) query.set("order_id", orderId);
  const list = useWorkList<TaskHistoryEvent>(`/api/v1/crm-task-events?${query}`);
  const labels = {
    created: t("Tarefa criada"),
    edited: t("Tarefa editada"),
    status_changed: t("Situação da tarefa alterada"),
  };
  const statuses: Record<LinkedTaskStatus, string> = {
    pending: t("Pendente"),
    in_progress: t("Em andamento"),
    done: t("Concluída"),
    cancelled: t("Cancelada"),
  };

  return (
    <Card className="rounded-md">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Histórico de tarefas")}</CardTitle>
        <Button
          variant="outline"
          className="rounded-md"
          disabled={list.loading}
          onClick={() => void list.load()}
        >
          {t("Recarregar histórico de tarefas")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.error && (
          <p role="alert" className="text-sm text-error-fg">
            {t(
              "Não foi possível carregar o histórico de tarefas. Os registros anteriores foram preservados.",
            )}
          </p>
        )}
        {list.loading && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("Carregando histórico de tarefas…")}
          </p>
        )}
        {!list.loading && !list.error && list.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("Nenhum evento de tarefa registrado.")}
          </p>
        )}
        <ul className="space-y-3">
          {list.rows.map((event) => (
            <li key={event.id} className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">{labels[event.event_type]}</p>
              <p className="text-xs text-muted-foreground">
                {t("Tarefa")} {event.task_id.slice(0, 8)} · {t("Revisão da tarefa")}:{" "}
                {event.task_revision}
              </p>
              {event.event_type === "status_changed" && (
                <p className="text-sm">
                  {event.from_status ? statuses[event.from_status] : t("Sem situação")} →{" "}
                  {statuses[event.to_status]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {event.actor_type === "user" && authorNames[event.actor_id]
                  ? authorNames[event.actor_id]
                  : t("Autor registrado")}
                {" · "}
                <time dateTime={event.created_at}>
                  {displayWorkDate(event.created_at, locale) ?? t("Data indisponível")}
                </time>
              </p>
              <Link
                href={`/app/orders/${encodeURIComponent(event.order_id)}#tarefas`}
                className="inline-block rounded-md text-xs text-primary underline underline-offset-4"
              >
                {t("Gerenciar no pedido")}
              </Link>
            </li>
          ))}
        </ul>
        {list.cursor && (
          <Button
            variant="outline"
            className="rounded-md"
            disabled={list.loading}
            onClick={() => void list.load(list.cursor!)}
          >
            {t("Carregar mais eventos de tarefa")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
