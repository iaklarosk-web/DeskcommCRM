"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "@/lib/random-id";

export class WorkRequestError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message);
  }
}

export async function sendWork(url: string, payload: unknown): Promise<{ replayed: boolean }> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new WorkRequestError(response.status, json?.error?.message);
  if (!json || typeof json !== "object" || !("data" in json)) throw new WorkRequestError(0);
  return { replayed: json.meta?.replayed === true };
}

/** A pending intent keeps its UUID even after A → B → A edits or a lost response. */
export function useIntentIds() {
  const ids = useRef(new Map<string, string>());
  return {
    forPayload(payload: unknown): string {
      const key = JSON.stringify(payload);
      const existing = ids.current.get(key);
      if (existing) return existing;
      const id = randomId();
      ids.current.set(key, id);
      return id;
    },
    clear() {
      ids.current.clear();
    },
  };
}

export function useWorkList<Row extends { id: string }>(url: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const currentRows = useRef<Row[]>([]);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);

  const read = useCallback(
    async (next?: string): Promise<Row[] | null> => {
      const request = ++sequence.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      try {
        const response = await fetch(next ? `${url}&cursor=${encodeURIComponent(next)}` : url, {
          cache: "no-store",
          credentials: "same-origin",
          signal: abort.signal,
        });
        const json = await response.json();
        if (
          !response.ok ||
          !Array.isArray(json?.data) ||
          json.data.some(
            (row: unknown) =>
              !row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string",
          ) ||
          (json.meta?.has_more && (typeof json.meta.cursor !== "string" || !json.meta.cursor))
        )
          throw new Error("invalid_list");
        if (!active.current || request !== sequence.current) return null;
        const combined = next ? [...currentRows.current, ...json.data] : json.data;
        const unique = [...new Map(combined.map((row: Row) => [row.id, row])).values()] as Row[];
        currentRows.current = unique;
        setRows(unique);
        setCursor(json.meta?.has_more ? json.meta.cursor : null);
        return unique;
      } catch {
        if (active.current && request === sequence.current && !abort.signal.aborted) setError(true);
        return null;
      } finally {
        if (active.current && request === sequence.current) setLoading(false);
      }
    },
    [url],
  );

  const load = useCallback(
    (next?: string) => {
      setLoading(true);
      setError(false);
      return read(next);
    },
    [read],
  );

  useEffect(() => {
    active.current = true;
    void read();
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, [read]);
  return { rows, cursor, loading, error, load };
}

export function displayWorkDate(value: string, locale: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? null
    : date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

/** datetime-local intentionally uses the device timezone, stated next to the field. */
export function localWorkDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
