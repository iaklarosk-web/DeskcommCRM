import { ZodError } from "zod";
import { getRequestId } from "@/lib/api/request-id";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  CommercialSettingsError,
  getCommercialProfile,
  patchCommercialProfile,
} from "@/src/tenant-config/commercial-service";

export const dynamic = "force-dynamic";

function context(authz: Awaited<ReturnType<typeof requireRole>>) {
  if (!authz.ok) throw new Error("authz_required");
  return {
    tenant: {
      organization_id: authz.org.orgId,
      user_id: authz.user.id,
      role: authz.org.role,
      source: "session" as const,
    },
    access: { support_session_id: authz.user.support?.id },
  };
}

function failure(error: unknown, requestId: string): Response {
  if (error instanceof ZodError) {
    return fail("validation_failed", "Revise os dados comerciais.", 422, {
      requestId,
      details: error.flatten(),
    });
  }
  if (error instanceof CommercialSettingsError) {
    return fail(error.code, "Esta configuração não pôde ser processada.", error.status, {
      requestId,
    });
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "40001" || code === "40P01") {
    return fail(
      "retryable_conflict",
      "A configuração mudou ao mesmo tempo. Tente novamente.",
      409,
      {
        requestId,
      },
    );
  }
  return fail("internal_error", "Não foi possível carregar as configurações comerciais.", 500, {
    requestId,
  });
}

export async function GET(req?: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", {
    requestId,
    resource: "commercial_settings",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  const { tenant, access } = context(authz);
  try {
    return ok(await getCommercialProfile(tenant, access), { requestId });
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", {
    requestId,
    resource: "commercial_settings",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  const { tenant, access } = context(authz);
  try {
    const body = await req.json().catch(() => null);
    return ok(await patchCommercialProfile(tenant, access, body, { requestId }), { requestId });
  } catch (error) {
    return failure(error, requestId);
  }
}
