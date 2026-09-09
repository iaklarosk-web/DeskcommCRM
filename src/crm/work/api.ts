import { z } from "zod";
import { fail } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { CrmAuthorizationError } from "@/src/crm/authorization";
import { CrmWorkServiceError } from "@/src/crm/work/service";

export const workCursorSchema = z.strictObject({
  created_at: z.string().datetime({ offset: true }),
  id: z.uuid().transform((id) => id.toLowerCase()),
});
export type WorkCursor = z.infer<typeof workCursorSchema>;
export function decodeWorkCursor(raw: string): WorkCursor | null {
  if (raw.length > 512) return null;
  try {
    const parsed = workCursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function workPage<T extends { id: string; created_at: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    meta: {
      has_more: hasMore,
      cursor:
        hasMore && last
          ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString(
              "base64url",
            )
          : null,
    },
  };
}
export const workListSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});

const messages: Record<string, string> = {
  idempotency_conflict: "Esta solicitação já foi usada com outros dados. Recarregue e confira.",
  revision_conflict: "Esta tarefa foi alterada. Recarregue antes de tentar novamente.",
  contact_unavailable: "O cliente não está disponível nesta empresa.",
  order_unavailable: "O pedido não está disponível para este cliente.",
  linked_task_not_found: "Tarefa não encontrada neste pedido.",
  assignee_unavailable: "Escolha um responsável com acesso a esta empresa.",
  task_status_unchanged: "A tarefa já está nessa situação.",
  note_redacted: "Esta nota foi anonimizada.",
};
export function workFailure(error: unknown, requestId: string): Response {
  if (error instanceof CrmAuthorizationError)
    return fail("forbidden", "Você não tem permissão para esta operação.", 403, { requestId });
  if (error instanceof CrmWorkServiceError)
    return fail(
      error.code,
      messages[error.code] ?? "Não foi possível concluir esta operação.",
      error.status,
      { requestId },
    );
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["23503", "23505", "23514", "40001", "40P01"].includes(code))
    return fail(
      "conflict",
      "Os dados mudaram. Recarregue e confira antes de repetir a operação.",
      409,
      { requestId },
    );
  logger.error("crm_work_command_failed", { requestId });
  return fail("internal_error", "Não foi possível salvar. Você pode tentar novamente.", 500, {
    requestId,
  });
}
