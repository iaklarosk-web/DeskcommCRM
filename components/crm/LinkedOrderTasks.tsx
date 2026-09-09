"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  displayWorkDate,
  localWorkDate,
  sendWork,
  useIntentIds,
  useWorkList,
  WorkRequestError,
} from "./work-ui";

export type LinkedTaskStatus = "pending" | "in_progress" | "done" | "cancelled";
export interface LinkedTaskRow {
  id: string;
  order_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: LinkedTaskStatus;
  revision: number;
  created_at: string;
}
export interface LinkedOrderTasksProps {
  orderId: string;
  canEdit: boolean;
  onSaved?: () => void;
}
type Draft = { title: string; description: string; due: string };
const emptyDraft = (): Draft => ({ title: "", description: "", due: "" });
type CommandBody = { command: string; [key: string]: unknown };

export function LinkedOrderTasks(props: LinkedOrderTasksProps) {
  return <TasksScope key={props.orderId} {...props} />;
}

function TasksScope({ orderId, canEdit, onSaved }: LinkedOrderTasksProps) {
  const t = useT();
  const locale = useTagDeIdioma();
  const fieldId = useId();
  const list = useWorkList<LinkedTaskRow>(
    `/api/v1/crm-orders/${encodeURIComponent(orderId)}/tasks?limit=25`,
  );
  const intents = useIntentIds();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const dirty = useRef(new Set<keyof Draft>());
  const [editing, setEditing] = useState<LinkedTaskRow | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const accepted = useRef<"form" | "status" | null>(null);
  const [awaitingRead, setAwaitingRead] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusLabels = {
    pending: t("Pendente"),
    in_progress: t("Em andamento"),
    done: t("Concluída"),
    cancelled: t("Cancelada"),
  };

  function clearForm() {
    setDraft(emptyDraft());
    setEditing(null);
    dirty.current.clear();
  }
  function changeDraft(field: keyof Draft, value: string) {
    const previous = editing
      ? {
          title: editing.title,
          description: editing.description ?? "",
          due: localWorkDate(editing.due_date),
        }
      : emptyDraft();
    if (value === previous[field]) dirty.current.delete(field);
    else dirty.current.add(field);
    setDraft((current) => ({ ...current, [field]: value }));
  }
  async function refresh(next?: string) {
    const rows = await list.load(next);
    if (!rows) return false;
    if (accepted.current) {
      if (accepted.current === "form") {
        clearForm();
        intents.clear();
      }
      accepted.current = null;
      setAwaitingRead(false);
      setNeedsReload(false);
      setError(null);
    } else if (needsReload) {
      const current = editing && rows.find((row) => row.id === editing.id);
      if (editing && !current) {
        setError(
          t("A tarefa não está nesta página. Carregue mais ou cancele a edição para continuar."),
        );
        return false;
      }
      if (current) {
        setEditing(current);
        setDraft((previous) => ({
          title: dirty.current.has("title") ? previous.title : current.title,
          description: dirty.current.has("description")
            ? previous.description
            : (current.description ?? ""),
          due: dirty.current.has("due") ? previous.due : localWorkDate(current.due_date),
        }));
      }
      setNeedsReload(false);
      setError(null);
      setNotice(t("Lista atualizada. Confira seu rascunho antes de salvar."));
    }
    return true;
  }

  async function execute(payload: CommandBody, kind: "form" | "status") {
    if (!canEdit || busy.current || needsReload || accepted.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendWork("/api/v1/tasks/commands", {
        command_id: intents.forPayload(payload),
        ...payload,
      });
      accepted.current = kind;
      setAwaitingRead(true);
      setNeedsReload(true);
      onSaved?.();
      setNotice(t(result.replayed ? "Comando já aplicado." : "Tarefa salva."));
      if (!(await refresh()))
        setError(
          t(
            "A tarefa foi salva, mas a lista não pôde ser atualizada. Recarregue antes de continuar.",
          ),
        );
    } catch (failure) {
      if (failure instanceof WorkRequestError && failure.status === 409) {
        setNeedsReload(true);
        setError(
          t("A tarefa mudou. Recarregue a lista e confira seu rascunho antes de salvar novamente."),
        );
      } else {
        setError(
          failure instanceof WorkRequestError && failure.message
            ? t(failure.message)
            : t(
                "Não foi possível confirmar o envio da tarefa. Os dados foram preservados; tente novamente.",
              ),
        );
      }
      // Read back after an uncertain outcome, but never replace the draft's
      // expected revision automatically. A conflict needs an explicit refresh.
      await list.load();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || !canEdit || pending || needsReload) return;
    let due: string | null = null;
    if (draft.due) {
      const date = new Date(draft.due);
      if (Number.isNaN(date.valueOf())) {
        setError(t("Informe um prazo válido."));
        return;
      }
      due = date.toISOString();
    }
    const title = draft.title.trim();
    if (!editing) {
      await execute(
        {
          command: "create_linked_task",
          order_id: orderId,
          title,
          ...(draft.description ? { description: draft.description } : {}),
          ...(due ? { due_date: due } : {}),
        },
        "form",
      );
      return;
    }
    const changed = {
      ...(dirty.current.has("title") && title !== editing.title ? { title } : {}),
      ...(dirty.current.has("description") && draft.description !== (editing.description ?? "")
        ? { description: draft.description || null }
        : {}),
      ...(dirty.current.has("due") && draft.due !== localWorkDate(editing.due_date)
        ? { due_date: due }
        : {}),
    };
    if (Object.keys(changed).length === 0) {
      setNotice(t("Nenhuma alteração para salvar."));
      return;
    }
    await execute(
      {
        command: "edit_linked_task",
        task_id: editing.id,
        expected_revision: editing.revision,
        ...changed,
      },
      "form",
    );
  }

  function edit(row: LinkedTaskRow) {
    if (!canEdit || pending || needsReload) return;
    setEditing(row);
    dirty.current.clear();
    setDraft({
      title: row.title,
      description: row.description ?? "",
      due: localWorkDate(row.due_date),
    });
    setError(null);
    setNotice(null);
  }

  return (
    <Card className="rounded-md">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t("Tarefas do pedido")}</CardTitle>
        <Button
          type="button"
          variant="secondary"
          className="rounded-md"
          disabled={pending || list.loading}
          onClick={() => void refresh()}
        >
          {t("Recarregar tarefas")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {list.error && (
          <p role="alert" className="text-sm text-error">
            {t("Não foi possível carregar as tarefas. A lista anterior foi preservada.")}
          </p>
        )}
        {list.loading && (
          <p role="status" className="text-sm text-text-muted">
            {t("Carregando tarefas…")}
          </p>
        )}
        {!list.loading && !list.error && list.rows.length === 0 && (
          <p className="text-sm text-text-muted">{t("Nenhuma tarefa neste pedido.")}</p>
        )}
        <ul className="space-y-3">
          {list.rows.map((task) => (
            <li key={task.id} className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium break-words">{task.title}</p>
              {task.description && (
                <p className="text-sm break-words whitespace-pre-wrap">{task.description}</p>
              )}
              <p className="text-xs text-text-muted">
                {task.due_date ? (
                  <>
                    {t("Prazo")}
                    {": "}
                    <time dateTime={task.due_date}>
                      {displayWorkDate(task.due_date, locale) ?? t("Data indisponível")}
                    </time>
                  </>
                ) : (
                  t("Sem prazo definido")
                )}
              </p>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm">
                    {t("Situação da tarefa")}
                    <select
                      aria-label={`${t("Situação da tarefa")}: ${task.title}`}
                      className="ml-2 rounded-md border border-border bg-surface p-2"
                      value={task.status}
                      disabled={pending || needsReload || list.loading}
                      onChange={(event) => {
                        if (event.target.value !== task.status)
                          void execute(
                            {
                              command: "set_linked_task_status",
                              task_id: task.id,
                              expected_revision: task.revision,
                              status: event.target.value,
                            },
                            "status",
                          );
                      }}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-md"
                    disabled={pending || needsReload || list.loading}
                    onClick={() => edit(task)}
                  >
                    {t("Editar tarefa")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm">{statusLabels[task.status]}</p>
              )}
            </li>
          ))}
        </ul>
        {list.cursor && (
          <Button
            type="button"
            variant="secondary"
            className="rounded-md"
            disabled={pending || list.loading || awaitingRead}
            onClick={() => void refresh(list.cursor!)}
          >
            {t("Carregar mais tarefas")}
          </Button>
        )}
        {canEdit ? (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm font-medium">{t(editing ? "Editar tarefa" : "Nova tarefa")}</p>
            <div className="space-y-1">
              <label htmlFor={`${fieldId}-title`} className="text-sm">
                {t("Título da tarefa")}
              </label>
              <Input
                id={`${fieldId}-title`}
                className="rounded-md"
                maxLength={255}
                required
                value={draft.title}
                disabled={pending || awaitingRead}
                onChange={(e) => changeDraft("title", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${fieldId}-description`} className="text-sm">
                {t("Descrição da tarefa")}
              </label>
              <Textarea
                id={`${fieldId}-description`}
                className="rounded-md"
                maxLength={5000}
                value={draft.description}
                disabled={pending || awaitingRead}
                onChange={(e) => changeDraft("description", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${fieldId}-due`} className="text-sm">
                {t("Prazo da tarefa")}
              </label>
              <Input
                id={`${fieldId}-due`}
                type="datetime-local"
                className="rounded-md"
                value={draft.due}
                disabled={pending || awaitingRead}
                onChange={(e) => changeDraft("due", e.target.value)}
              />
              <p className="text-xs text-text-muted">
                {t("Os horários usam o fuso deste dispositivo.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                className="rounded-md"
                disabled={pending || needsReload || !draft.title.trim()}
              >
                {t(pending ? "Salvando tarefa…" : "Salvar tarefa")}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-md"
                  disabled={pending || awaitingRead}
                  onClick={() => {
                    clearForm();
                    if (!needsReload) setError(null);
                  }}
                >
                  {t("Cancelar edição")}
                </Button>
              )}
            </div>
          </form>
        ) : (
          <p className="text-sm text-text-muted">{t("Você tem acesso somente de leitura.")}</p>
        )}
      </CardContent>
    </Card>
  );
}
