import { requireSupportWrite } from "@/lib/impersonate/support";
import { getRequestId } from "@/lib/api/request-id";
/**
 * PATCH  /api/v1/tasks/[id] — edita uma tarefa.
 * DELETE /api/v1/tasks/[id] — apaga uma tarefa.
 *
 * Extraído do PR #418 (@clinicacentrodosorrisosc-code), sem o fallback para
 * `custom_fields.tasks` — o motivo inteiro está no cabeçalho de
 * `app/api/v1/tasks/route.ts`.
 *
 * ⚠️ O `.eq("organization_id", ...)` não é decoração: sem ele o PATCH casaria
 * 0 linhas numa tarefa de outra organização e o PostgREST devolveria `PGRST116`
 * — que esta rota já traduz para 404, o desfecho certo. Mantê-lo explícito é a
 * regra do CLAUDE.md e o que segura o dia em que alguém trocar o client.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { PRIORIDADES_DA_TAREFA, SITUACOES_DA_TAREFA, type Tarefa } from "@/lib/tarefas/tipos";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, order_id, revision, assigned_to, created_by, created_at, updated_at";

const edicaoSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    due_date: z.string().datetime({ offset: true }).nullable().optional(),
    priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
    status: z.enum(SITUACOES_DA_TAREFA).optional(),
    lead_id: z.string().uuid().nullable().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  // PATCH vazio gravaria só o `updated_at` e devolveria 200: a tela diria
  // "salvo" sobre uma edição que não existiu.
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = getRequestId(req);
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = edicaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();

  // A situação ANTES da edição decide se esta é a vez em que a tarefa fechou.
  // Sem ler antes, marcar "concluída" duas vezes emitiria duas linhas na
  // timeline do negócio — e a segunda seria mentira.
  const { data: antes, error: erroAntes } = await supabase
    .from("crm_tasks")
    .select("status,order_id,contact_id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (erroAntes) {
    if (erroAntes.code === "PGRST116") {
      return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
    }
    return fail("internal_error", t("Erro ao salvar a tarefa."), 500, { requestId });
  }
  if (!antes) {
    return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
  }
  if ((antes as { order_id?: string | null }).order_id) {
    return fail(
      "state_conflict",
      t("Esta tarefa pertence a um pedido. Use o pedido para alterá-la."),
      409,
      { requestId },
    );
  }

  const contatoParaValidar =
    typeof parsed.data.contact_id === "string"
      ? parsed.data.contact_id
      : parsed.data.title !== undefined || parsed.data.description !== undefined
        ? ((antes as { contact_id?: string | null }).contact_id ?? null)
        : null;
  if (contatoParaValidar) {
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id,is_anonymized,is_merged_into")
      .eq("organization_id", authz.org.orgId)
      .eq("id", contatoParaValidar)
      .maybeSingle();
    if (contactError) {
      return fail("internal_error", t("Erro ao salvar a tarefa."), 500, { requestId });
    }
    if (!contact) {
      return fail("not_found", t("Contato não encontrado."), 404, { requestId });
    }
    if (contact.is_anonymized || contact.is_merged_into) {
      return fail(
        "contact_unavailable",
        t(
          "O contato principal não está disponível — ele pode ter sido anonimizado ou já mesclado em outro.",
        ),
        422,
        { requestId },
      );
    }
  }

  const { data, error } = await supabase
    .from("crm_tasks")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS)
    .single();

  if (error) {
    if (error.code === "40P01") {
      return fail(
        "state_conflict",
        t("Outra operação ocorreu ao mesmo tempo. Tente novamente."),
        409,
        { requestId },
      );
    }
    if (
      error.code === "23514" ||
      (error.code === "23503" && /crm_tasks_contact/i.test(error.message))
    ) {
      return fail(
        "contact_unavailable",
        t(
          "O contato principal não está disponível — ele pode ter sido anonimizado ou já mesclado em outro.",
        ),
        422,
        { requestId },
      );
    }
    if (error.code === "PGRST116") {
      return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
    }
    if (error.code === "23503") {
      return fail("validation_failed", t("O negócio ou contato vinculado não existe."), 422, {
        requestId,
      });
    }
    return fail("internal_error", t("Erro ao salvar a tarefa."), 500, { requestId });
  }

  const tarefa = data as unknown as Tarefa;

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_task.updated",
    resourceType: "crm_tasks",
    resourceId: tarefa.id,
    requestId,
    metadata: { campos: Object.keys(parsed.data) },
  });

  const fechouAgora =
    tarefa.status === "done" && (antes as { status?: string } | null)?.status !== "done";
  if (fechouAgora) {
    await registraAtividadeDaTarefa(supabase, {
      organizationId: authz.org.orgId,
      tarefa,
      tipo: "task_completed",
      actorUserId: authz.user.id,
    });
  }

  return ok({ task: tarefa }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = getRequestId(_req);
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const supabase = await createClient();
  const { data: existente, error: erroExistente } = await supabase
    .from("crm_tasks")
    .select("order_id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (erroExistente) {
    if (erroExistente.code === "PGRST116") {
      return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
    }
    return fail("internal_error", t("Erro ao apagar a tarefa."), 500, { requestId });
  }
  if (!existente) {
    return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
  }
  if ((existente as { order_id?: string | null }).order_id) {
    return fail(
      "state_conflict",
      t("Esta tarefa pertence a um pedido. Use o pedido para alterá-la."),
      409,
      { requestId },
    );
  }

  // `.select()` no delete para saber se ALGUMA linha saiu. Sem isso, apagar uma
  // tarefa de outra organização devolveria 200 — e a tela sumiria com a linha
  // do próprio usuário na próxima recarga, sem que nada tivesse sido apagado.
  const { data, error } = await supabase
    .from("crm_tasks")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id");

  if (error) {
    return fail("internal_error", t("Erro ao apagar a tarefa."), 500, { requestId });
  }
  if (!data || data.length === 0) {
    return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_task.deleted",
    resourceType: "crm_tasks",
    resourceId: id,
    requestId,
  });

  return ok({ deleted: true }, { requestId });
}
