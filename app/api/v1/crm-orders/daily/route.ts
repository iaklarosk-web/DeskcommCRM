import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import {
  dailyOrderQuerySchema,
  DailyOrderReportError,
  getDailyOrderReport,
} from "@/src/crm/orders/daily";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const parsed = dailyOrderQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return fail("validation_failed", "Informe a data e o critério do relatório.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });

  const authz = await requireRole("viewer", {
    requestId,
    resource: "crm_orders_daily",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;

  try {
    return ok(
      await getDailyOrderReport(
        {
          organization_id: authz.org.orgId,
          user_id: authz.user.id,
          role: authz.org.role,
          source: "session",
        },
        { support_session_id: authz.user.support?.id },
        parsed.data,
      ),
      { requestId },
    );
  } catch (error) {
    if (error instanceof ZodError)
      return fail("internal_error", "O relatório contém dados inválidos.", 500, {
        requestId,
      });
    if (error instanceof DailyOrderReportError)
      return fail(
        error.code,
        "Você não pode consultar este relatório nesta empresa.",
        error.status,
        { requestId },
      );
    logger.error("crm_orders_daily_failed", { requestId });
    return fail("internal_error", "Não foi possível gerar o relatório diário.", 500, {
      requestId,
    });
  }
}
