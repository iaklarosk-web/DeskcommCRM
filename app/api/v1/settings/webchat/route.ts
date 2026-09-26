/**
 * GET/PATCH /api/v1/settings/webchat — o chat do site da organização (F14,
 * ADR-038 §2 T02; D55 c). Leitura para todo membro (o atendente precisa saber
 * se o canal existe); escrita `settings.manage` (tenant_admin e manager, como
 * a autonomia da F15). O que se configura: ligado/desligado, as origens que
 * podem embutir (`frame-ancestors`) e — F24 (Suporte KN, 25/09/2026) — o
 * que o visitante lê quando a conversa espera uma pessoa:
 * `webchat.handoff_mode` (`atendente` = a frase de sempre; `retorno` =
 * "recebemos sua pergunta, {empresa} responde por {contato} em até {prazo}")
 * e `webchat.return_deadline_text` (o `{prazo}`).
 *
 * O código de embed e a URL da página são derivados da ORIGEM PÚBLICA da
 * requisição (`src/http/origem-publica.ts`) — a mesma que o script de embed
 * usa para montar o iframe. Uma origem só, nos dois lugares.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";
import { origemPublica } from "@/src/http/origem-publica";
import { getSetting, InvalidSettingError, setSetting } from "@/src/tenant-config/settings";
import { getServicePool } from "@/src/tenant-context/db";

export const dynamic = "force-dynamic";

const ORIGEM = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;
const MODOS_DA_FILA = ["atendente", "retorno"] as const;

const patchSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    allowed_origins: z.array(z.string().trim().regex(ORIGEM, "origem inválida: use https://dominio.com")).max(20).optional(),
    handoff_mode: z.enum(MODOS_DA_FILA).optional(),
    return_deadline_text: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => Object.values(v).some((campo) => campo !== undefined), { message: "nada a alterar" });

async function slugDa(organizationId: string): Promise<string> {
  const pool = await getServicePool();
  const linha = await pool.query<{ slug: string }>(`select slug::text as slug from public.organizations where id = $1`, [organizationId]);
  return linha.rows[0]?.slug ?? "";
}

async function leitura(ctx: ReturnType<typeof ctxDaRota>, origem: string) {
  const [enabled, origens, modo, prazo, slug] = await Promise.all([
    getSetting(ctx, "webchat.enabled"),
    getSetting(ctx, "webchat.allowed_origins"),
    getSetting(ctx, "webchat.handoff_mode"),
    getSetting(ctx, "webchat.return_deadline_text"),
    slugDa(ctx.organization_id),
  ]);
  const allowed_origins = Array.isArray(origens) ? origens.filter((o): o is string => typeof o === "string") : [];
  return {
    enabled: enabled === true,
    allowed_origins,
    handoff_mode: modo === "retorno" ? "retorno" : "atendente",
    return_deadline_text: typeof prazo === "string" && prazo.length > 0 ? prazo : "1 dia útil",
    slug,
    chat_url: `${origem}/chat/${slug}`,
    embed_snippet: `<script src="${origem}/embed/${slug}.js" async></script>`,
  };
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", { requestId, resource: "webchat_settings", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  return ok(await leitura(ctxDaRota(authz), origemPublica(req, { padrao: env.NEXT_PUBLIC_APP_URL })), { requestId });
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
  const { enabled, allowed_origins, handoff_mode, return_deadline_text } = parsed.data;
  try {
    if (enabled !== undefined) await setSetting(ctx, "webchat.enabled", enabled, "tenant_admin");
    if (allowed_origins !== undefined) await setSetting(ctx, "webchat.allowed_origins", allowed_origins, "tenant_admin");
    if (handoff_mode !== undefined) await setSetting(ctx, "webchat.handoff_mode", handoff_mode, "tenant_admin");
    if (return_deadline_text !== undefined) await setSetting(ctx, "webchat.return_deadline_text", return_deadline_text, "tenant_admin");
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
    metadata: {
      enabled: enabled ?? null,
      allowed_origins: allowed_origins ?? null,
      handoff_mode: handoff_mode ?? null,
      return_deadline_text: return_deadline_text ?? null,
    },
  });
  return ok(await leitura(ctx, origemPublica(req, { padrao: env.NEXT_PUBLIC_APP_URL })), { requestId });
}
