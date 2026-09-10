import { fail, ok } from "@/lib/api/wrappers";
import { getRequestId } from "@/lib/api/request-id";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { workFailure } from "@/src/crm/work/api";
import { linkedTaskCommandSchema } from "@/src/crm/work/contracts";
import { executeLinkedTaskCommand } from "@/src/crm/work/service";

export const dynamic = "force-dynamic";
export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const parsed = linkedTaskCommandSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Revise os dados da tarefa.", 422, {
      requestId,
    });
  const authz = await requireRole("agent", {
    requestId,
    resource: "crm_tasks",
  });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  if (authz.user.support)
    return fail(
      "forbidden",
      "Tarefas não podem ser alteradas durante acompanhamento de suporte.",
      403,
      { requestId },
    );
  try {
    const saved = await executeLinkedTaskCommand(
      {
        organization_id: authz.org.orgId,
        user_id: authz.user.id,
        role: authz.org.role,
        source: "session",
      },
      { type: "human", user_id: authz.user.id },
      parsed.data,
      { requestId },
    );
    return ok(saved.result, {
      requestId,
      status: parsed.data.command === "create_linked_task" && !saved.replayed ? 201 : 200,
      meta: { replayed: saved.replayed },
    });
  } catch (error) {
    return workFailure(error, requestId);
  }
}
