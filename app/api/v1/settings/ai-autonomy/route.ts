/**
 * F15-T01 (ADR-036 §2 T01, D54 b) — a autonomia da IA por AÇÃO.
 *
 * GET   /api/v1/settings/ai-autonomy → { policy, confirm_from_risk, table[], limits }
 * PATCH /api/v1/settings/ai-autonomy ← { policy?: {<ação>: allow|approve|block|transfer|null}, daily_turns?: int }
 *
 * `policy` é a chave `actions.policy` de `tenant_settings` (só as entradas
 * que a organização sobrescreveu); `table` é o modo EFETIVO de cada ação do
 * catálogo para o executor `ai` (entrada da organização ou D33), com a origem
 * — é o que a tela mostra. `null` numa entrada do PATCH apaga a sobrescrita
 * (volta ao padrão). `limits` (F15-T02) é o limite diário de turnos com o uso
 * do dia no fuso da organização e `paused` (uso ≥ limite); `daily_turns` no
 * PATCH grava `ai.limits.daily_turns` (0 = sem teto). Permissão:
 * `settings.manage` (`tenant_admin` e `manager`).
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ACTION_CATALOG } from "@/src/actions/catalog";
import { estadoDoLimite } from "@/src/ai/limite";
import { MODOS_DA_POLITICA, POLITICA_PADRAO, politicaValida, tabelaDaPolitica, type Politica } from "@/src/actions/politica";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";
import { getSetting, InvalidSettingError, setSetting } from "@/src/tenant-config/settings";

export const dynamic = "force-dynamic";

const patchSchema = z
  .strictObject({
    policy: z.record(z.string().max(60), z.enum(MODOS_DA_POLITICA).nullable()).refine((p) => Object.keys(p).length > 0, { message: "nada a alterar" }).optional(),
    daily_turns: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((v) => v.policy !== undefined || v.daily_turns !== undefined, { message: "nada a alterar" });

async function leitura(ctx: ReturnType<typeof ctxDaRota>) {
  const [bruta, confirm_from_risk, limite] = await Promise.all([
    getSetting(ctx, "actions.policy"),
    getSetting(ctx, "actions.confirm_from_risk"),
    estadoDoLimite(ctx),
  ]);
  const policy: Politica = politicaValida(bruta) ? bruta : POLITICA_PADRAO;
  return {
    policy,
    confirm_from_risk,
    table: tabelaDaPolitica("ai", policy, confirm_from_risk),
    limits: { daily_turns: limite.limit, used_today: limite.used, remaining: limite.remaining, day: limite.day, timezone: limite.timezone, paused: !limite.allowed },
  };
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", { requestId, resource: "ai_autonomy", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  return ok(await leitura(ctxDaRota(authz)), { requestId });
}

export async function PATCH(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "ai_autonomy", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const negado = negarSemPermissao(authz, "settings.manage", requestId);
  if (negado) return negado;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Política inválida.", 422, { requestId, details: parsed.error.flatten() });
  const ctx = ctxDaRota(authz);
  const atual = await leitura(ctx);
  try {
    if (parsed.data.policy !== undefined) {
      // Só ações que o catálogo dá à IA podem ser sobrescritas; o resto é recusado
      // com o nome — a política não abre o que o catálogo fecha (ADR-036 §1).
      const configuraveis = new Set(atual.table.filter((m) => m.configurable).map((m) => m.action));
      const nomes = new Set(ACTION_CATALOG.map((e) => e.name));
      for (const nome of Object.keys(parsed.data.policy)) {
        if (!nomes.has(nome)) return fail("validation_failed", `Ação fora do catálogo: ${nome}.`, 422, { requestId });
        if (!configuraveis.has(nome)) return fail("validation_failed", `A ação ${nome} não é da IA; a política não a abre.`, 422, { requestId });
      }
      const nova: Record<string, (typeof MODOS_DA_POLITICA)[number]> = { ...atual.policy };
      for (const [nome, modo] of Object.entries(parsed.data.policy)) {
        if (modo === null) delete nova[nome];
        else nova[nome] = modo;
      }
      await setSetting(ctx, "actions.policy", nova, "tenant_admin");
      // `resource_id` é uuid: a chave natural (`actions.policy`) vai no metadata.
      await audit({ organizationId: authz.org.orgId, actorUserId: authz.user.id, action: "ai_autonomy.updated", resourceType: "tenant_settings", resourceId: null, requestId, metadata: { key: "actions.policy", changes: parsed.data.policy } });
    }
    if (parsed.data.daily_turns !== undefined) {
      await setSetting(ctx, "ai.limits.daily_turns", parsed.data.daily_turns, "tenant_admin");
      await audit({ organizationId: authz.org.orgId, actorUserId: authz.user.id, action: "ai_limits.updated", resourceType: "tenant_settings", resourceId: null, requestId, metadata: { key: "ai.limits.daily_turns", daily_turns: parsed.data.daily_turns, before: atual.limits.daily_turns } });
    }
  } catch (error) {
    if (error instanceof InvalidSettingError) return fail("validation_failed", error.message, 422, { requestId });
    throw error;
  }
  return ok(await leitura(ctx), { requestId });
}
