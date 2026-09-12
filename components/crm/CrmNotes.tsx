"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { displayWorkDate, sendWork, useIntentIds, useWorkList, WorkRequestError } from "./work-ui";

export interface CrmNoteRow {
  id: string;
  contact_id: string;
  order_id: string | null;
  body: string | null;
  actor_user_id: string | null;
  created_at: string;
  redacted_at: string | null;
}
export interface CrmNotesProps {
  contactId: string;
  orderId?: string;
  canEdit: boolean;
  authorNames?: Record<string, string>;
}

export function CrmNotes(props: CrmNotesProps) {
  return <NotesScope key={`${props.contactId}:${props.orderId ?? ""}`} {...props} />;
}

function NotesScope({ contactId, orderId, canEdit, authorNames = {} }: CrmNotesProps) {
  const t = useT();
  const locale = useTagDeIdioma();
  const fieldId = useId();
  const url = `/api/v1/crm-notes?contact_id=${encodeURIComponent(contactId)}${orderId ? `&order_id=${encodeURIComponent(orderId)}` : ""}&limit=25`;
  const list = useWorkList<CrmNoteRow>(url);
  const intents = useIntentIds();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const accepted = useRef(false);
  const [needsRead, setNeedsRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(next?: string) {
    const rows = await list.load(next);
    if (rows && accepted.current) {
      accepted.current = false;
      setNeedsRead(false);
      setBody("");
      intents.clear();
      setError(null);
    }
    return rows;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || busy.current || accepted.current || !body.trim()) return;
    const payload = {
      contact_id: contactId,
      ...(orderId ? { order_id: orderId } : {}),
      body: body.trim(),
    };
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendWork("/api/v1/crm-notes", {
        id: intents.forPayload(payload),
        ...payload,
      });
      accepted.current = true;
      setNeedsRead(true);
      setNotice(t(result.replayed ? "Nota já registrada." : "Nota registrada."));
      if (!(await refresh()))
        setError(
          t(
            "A nota foi registrada, mas a lista não pôde ser atualizada. Recarregue antes de escrever outra.",
          ),
        );
    } catch (failure) {
      setError(
        failure instanceof WorkRequestError && failure.message
          ? t(failure.message)
          : t(
              "Não foi possível confirmar o envio da nota. O texto foi preservado; tente novamente.",
            ),
      );
      await list.load();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Card className="rounded-md">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t("Notas")}</CardTitle>
        <Button
          type="button"
          variant="secondary"
          className="rounded-md"
          disabled={pending || list.loading}
          onClick={() => void refresh()}
        >
          {t("Recarregar notas")}
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
            {t("Não foi possível carregar as notas. A lista anterior foi preservada.")}
          </p>
        )}
        {list.loading && (
          <p role="status" className="text-sm text-text-muted">
            {t("Carregando notas…")}
          </p>
        )}
        {!list.loading && !list.error && list.rows.length === 0 && (
          <p className="text-sm text-text-muted">{t("Nenhuma nota registrada.")}</p>
        )}
        <ul className="space-y-3">
          {list.rows.map((note) => (
            <li key={note.id} className="rounded-md border border-border p-3">
              <p className="text-sm break-words whitespace-pre-wrap">
                {note.redacted_at ? t("Nota anonimizada.") : note.body}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                {note.actor_user_id && authorNames[note.actor_user_id]
                  ? authorNames[note.actor_user_id]
                  : t("Autor registrado")}
                {" · "}
                <time dateTime={note.created_at}>
                  {displayWorkDate(note.created_at, locale) ?? t("Data indisponível")}
                </time>
              </p>
            </li>
          ))}
        </ul>
        {list.cursor && (
          <Button
            type="button"
            variant="secondary"
            className="rounded-md"
            disabled={pending || list.loading || needsRead}
            onClick={() => void refresh(list.cursor!)}
          >
            {t("Carregar mais notas")}
          </Button>
        )}
        {canEdit ? (
          <form onSubmit={submit} className="space-y-2">
            <label htmlFor={fieldId} className="block text-sm font-medium">
              {t("Nova nota")}
            </label>
            <Textarea
              id={fieldId}
              value={body}
              maxLength={4096}
              required
              disabled={pending || needsRead}
              onChange={(event) => setBody(event.target.value)}
              className="rounded-md"
            />
            <Button
              type="submit"
              className="rounded-md"
              disabled={pending || needsRead || !body.trim()}
            >
              {t(pending ? "Salvando nota…" : "Salvar nota")}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-text-muted">{t("Você tem acesso somente de leitura.")}</p>
        )}
      </CardContent>
    </Card>
  );
}
