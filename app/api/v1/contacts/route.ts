import { requireSupportWrite } from "@/lib/impersonate/support";
import { getRequestId } from "@/lib/api/request-id";
/**
 * GET  /api/v1/contacts — list (handler em ./_handler.ts)
 * POST /api/v1/contacts — create (handler em ./_handler.ts)
 *
 * Thin wrapper: auth + Zod + ok/fail. Lógica em listContactsHandler/createContactHandler.
 */
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  contactCreateSchema,
  contactListQuerySchema,
  validateRequest,
  type ContactCreate,
} from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { validarCamposDa } from "@/src/crm/campos";
import { ctxDaRota } from "@/src/crm/permissao-da-rota";

import { listContactsHandler, createContactHandler } from "./_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = getRequestId(req);
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");

  const url = new URL(req.url);
  const qsParsed = contactListQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    order_by: url.searchParams.get("order_by") ?? undefined,
    order_dir: url.searchParams.get("order_dir") ?? undefined,
  });
  if (!qsParsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      details: qsParsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const orgId = authUser ? (await resolveActiveOrg(authUser))?.orgId : undefined;

  try {
    const { contacts, cursor, has_more } = await listContactsHandler(
      supabase,
      {
        organization_id: orgId ?? "",
        actor: { type: "user", id: user.id },
        requestId,
        idioma: authUser?.idioma,
      },
      qsParsed.data,
    );
    return ok(contacts, { requestId, meta: { cursor, has_more } });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = getRequestId(req);
  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const activeOrg = authz.org;

  let input;
  try {
    input = await validateRequest(contactCreateSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
  // F13-T01 (ADR-034): o valor dos campos configuráveis do contato passa pelo
  // validador único (definições de `crm.fields.contacts`); chave sem definição
  // é preservada — apagar uma definição não apaga o valor gravado.
  if (input.custom_fields !== undefined) {
    const campos = await validarCamposDa(ctxDaRota(authz), "contacts", input.custom_fields);
    if (!campos.ok) {
      return fail("custom_field_invalid", "Campos personalizados inválidos.", 422, { requestId, details: { erros: campos.erros } });
    }
    input = { ...input, custom_fields: campos.valores };
  }

  try {
    const result = await createContactHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
        idioma: user.idioma,
      },
      input as ContactCreate,
    );
    return ok(result, { status: 201, requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
