/**
 * GET/PATCH /api/v1/settings/webchat — o chat do site da organização (F14,
 * ADR-038 §2 T02; D55 c). Leitura para todo membro (o atendente precisa saber
 * se o canal existe); escrita `settings.manage` (tenant_admin e manager, como
 * a autonomia da F15). O que se configura: ligado/desligado e as origens que
 * podem embutir (`frame-ancestors`); o código de embed e a URL da página são
 * derivados daqui, para copiar.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";
import { getSetting, InvalidSettingError, setSetting } from "@/src/tenant-config/settings";
import { getServicePool } from "@/src/tenant-context/db";

export const dynamic = "force-dynamic";

const ORIGEM = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;

const patchSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    allowed_origins: z.array(z.string().trim().regex(ORIGEM, "origem inválida: use https://dominio.com")).max(20).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.allowed_origins !== undefined, { message: "nada a alterar" });

async function slugDa(organizationId: string): Promise<string> {
  const pool = await getServicePool();
  const linha = await pool.query<{ slug: string }>(`select slug::text as slug from public.organizations where id = $1`, [organizationId]);
  return linha.rows[0]?.slug ?? "";
}

async function leitura(ctx: ReturnType<typeof ctxDaRota>, origem: string) {
  const [enabled, origens, slug] = await Promise.all([getSetting(ctx, "webchat.enabled"), getSetting(ctx, "webchat.allowed_origins"), slugDa(ctx.organization_id)]);
  const allowed_origins = Array.isArray(origens) ? origens.filter((o): o is string => typeof o === "string") : [];
  return {
    enabled: enabled === true,
    allowed_origins,
    slug,
    chat_url: `${origem}/chat/${slug}`,
    embed_snippet: `<script src="${origem}/embed/${slug}.js" async></script>`,
  };
}

function origemDa(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", { requestId, resource: "webchat_settings", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  return ok(await leitura(ctxDaRota(authz), origemDa(req)), { requestId });
}

export async function PATCH(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "webchat_settings", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const negado = negarSemPermissao(authz, "settings.manage", requestId);
  if (negado) return negado;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Configuração inválida.", 422, { requestId, details: parsed.error.flatten() });
  const ctx = ctxDaRota(authz);
  try {
    if (parsed.data.enabled !== undefined) await setSetting(ctx, "webchat.enabled", parsed.data.enabled, "tenant_admin");
    if (parsed.data.allowed_origins !== undefined) await setSetting(ctx, "webchat.allowed_origins", parsed.data.allowed_origins, "tenant_admin");
  } catch (error) {
    if (error instanceof InvalidSettingError) return fail("validation_failed", error.message, 422, { requestId });
    throw error;
  }
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "webchat_settings.updated",
    resourceType: "tenant_settings",
    resourceId: null,
    requestId,
    metadata: { enabled: parsed.data.enabled ?? null, allowed_origins: parsed.data.allowed_origins ?? null },
  });
  return ok(await leitura(ctx, origemDa(req)), { requestId });
}
