/**
 * A porta HTTP da tela de IA do `tenant_admin` (F04-T10, §5.2, D15/D21).
 *
 * ─── Por que uma rota nova e não uma server action ────────────────────────
 *
 * `requireRole` é o gate de rota deste produto e é ele que carrega o MFA de
 * SESSÃO (`lib/auth/require-role.ts`): uma server action escreveria as mesmas
 * Settings sem passar por ele. Para configuração de IA — persona, texto de "não
 * sei" e limiar de confiança, que mudam o que o agente diz ao cliente — esse é o
 * degrau que não se pula.
 *
 * ─── Quem escreve ────────────────────────────────────────────────────────
 *
 * `setSetting` do TenantConfiguration, sempre, com `source: "tenant_admin"`
 * (§5.2 invariante 4: ninguém mais lê ou escreve `tenant_settings`). Não há um
 * `insert` nesta rota, e é deliberado: validação, default, alias canônico e
 * merge de origem moram num lugar só.
 */
import { ZodError, z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { CHAVES_DA_TELA_DE_IA, lerConfiguracaoDeIa } from "@/lib/settings/ia-do-tenant";
import { InvalidSettingError, setSetting, UnknownSettingError } from "@/src/tenant-config";
import type { TenantCtx } from "@/src/tenant-context";

export const dynamic = "force-dynamic";

/*
 * A lista de chaves e a leitura moram em `lib/settings/ia-do-tenant.ts`: a
 * página SERVIDA responde a mesma pergunta, e a prova de F04-T10 compara as
 * duas. A lista é FECHADA de propósito — o schema de §5.2 tem 24 chaves, e uma
 * rota que aceitasse "qualquer chave do schema" deixaria a tela de IA gravar
 * retenção de mídia e lembrete de pedido.
 */

const patchSchema = z
  .object({
    "ai.enabled": z.boolean(),
    "ai.system_prompt": z.string().trim().max(4000).nullable(),
    "ai.unknown_answer": z.string().trim().max(1000).nullable(),
    "ai.confidence_threshold": z.number().min(0).max(1),
  })
  .partial()
  .refine((corpo) => Object.keys(corpo).length > 0, {
    message: "Nenhuma configuração de IA foi enviada.",
  });

function contexto(authz: Awaited<ReturnType<typeof requireRole>>): TenantCtx {
  if (!authz.ok) throw new Error("authz_required");
  return {
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    role: authz.org.role,
    source: "session",
  };
}

function falha(erro: unknown, requestId: string): Response {
  if (erro instanceof ZodError) {
    return fail("validation_failed", "Revise a configuração de IA.", 422, {
      requestId,
      details: erro.flatten(),
    });
  }
  if (erro instanceof InvalidSettingError || erro instanceof UnknownSettingError) {
    return fail("validation_failed", "Esta configuração não é válida.", 422, { requestId });
  }
  return fail("internal_error", "Não foi possível salvar a configuração de IA.", 500, {
    requestId,
  });
}

export async function GET(req?: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", {
    requestId,
    resource: "ai_settings",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  const ctx = contexto(authz);
  try {
    return ok(await lerConfiguracaoDeIa(ctx), { requestId });
  } catch (erro) {
    return falha(erro, requestId);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const suporteNegado = await requireSupportWrite();
  if (suporteNegado) return suporteNegado;
  const authz = await requireRole("admin", {
    requestId,
    resource: "ai_settings",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  const ctx = contexto(authz);
  try {
    const corpo = patchSchema.parse(await req.json().catch(() => null));
    for (const chave of CHAVES_DA_TELA_DE_IA) {
      if (!Object.hasOwn(corpo, chave)) continue;
      const valor = corpo[chave];
      // Texto em branco significa "não configurei" — e `null` é o que o schema
      // chama de não configurado. Gravar `""` faria o turno responder uma
      // string vazia ao cliente achando que era o texto do tenant.
      const normalizado = typeof valor === "string" && valor.length === 0 ? null : valor;
      await setSetting(ctx, chave, normalizado, "tenant_admin");
    }
    return ok(await lerConfiguracaoDeIa(ctx), { requestId });
  } catch (erro) {
    return falha(erro, requestId);
  }
}
