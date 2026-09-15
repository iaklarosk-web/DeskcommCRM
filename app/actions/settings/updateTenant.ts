"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { tenantSchema, type TenantInput } from "@/lib/schemas/settings";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type UpdateTenantResult =
  { ok: true } | { ok: false; error: string; details?: unknown };

export async function updateTenant(
  input: TenantInput,
): Promise<UpdateTenantResult> {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_failed",
      details: parsed.error.flatten(),
    };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support))
    return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (
    !authUser.is_platform_admin &&
    ROLE_RANK[activeOrg.role] < ROLE_RANK.admin
  ) {
    return { ok: false, error: "forbidden_role" };
  }

  /**
   * A ESCRITA EM `organizations` VAI PELO ADMIN CLIENT — e não é preguiça.
   *
   * A única policy de escrita da tabela é `orgs_write_platform_admin`, com
   * `USING (fn_is_platform_admin())`. Pelo client de sessão, o UPDATE de quem não
   * é super-admin de plataforma casa ZERO linhas — e o PostgREST devolve sucesso,
   * porque "nenhuma linha casou o filtro" não é erro. Resultado: a tela dizia
   * "salvo", nada era gravado, e recarregar mostrava o estado antigo.
   *
   * Medido em Postgres com o baseline aplicado (issue #144): sob `authenticated`
   * com o JWT de um manager, `update organizations` devolve 0 linhas; sob
   * postgres, 1. Ninguém tinha notado porque o dono do repo e o owner criado pelo
   * `bootstrap-owner.ts` SÃO platform_admin — quem tropeça é o segundo admin
   * convidado e qualquer manager.
   *
   * O gate continua sendo o de cima (papel resolvido de fonte confiável), e o
   * filtro por `organization_id` é explícito, como a doutrina exige de todo
   * handler que usa service role.
   */
  const supabase = createAdminClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // A RPC faz merge somente de lost_reasons_extra e arquiva o alias de timezone
  // no MESMO commit. Dois requests REST deixariam uma janela em que o valor
  // canônico mudou e o diagnóstico antigo continuou ativo.
  const { data, error } = await supabase.rpc("fn_update_organization_profile", {
    p_org: activeOrg.orgId,
    p_actor: authUser.id,
    // O contrato SQL é total para distinguir ausência acidental de limpeza
    // explícita. Os três campos opcionais do Zod viram null aqui, como já
    // acontecia no UPDATE herdado.
    p_profile: {
      ...parsed.data,
      cnpj: parsed.data.cnpj ?? null,
      dpo_email: parsed.data.dpo_email ?? null,
      privacy_policy_url: parsed.data.privacy_policy_url ?? null,
    },
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden_role" };
    if (error.code === "22023") {
      return { ok: false, error: "validation_failed", details: error.message };
    }
    return { ok: false, error: "db_error", details: error.message };
  }
  if (data !== 1) return { ok: false, error: "nao_gravou" };

  await audit({
    action: "org.updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "organization",
    resourceId: activeOrg.orgId,
    requestId,
    ip,
    userAgent,
    metadata: {
      fields_changed: Object.keys(parsed.data),
    },
  });

  await supabase
    .rpc("emit_event", {
      p_event_type: "org.updated",
      p_entity_kind: "organization",
      p_entity_id: activeOrg.orgId,
      p_payload: { organization_id: activeOrg.orgId },
      p_metadata: { request_id: requestId },
      p_organization_id: activeOrg.orgId,
    })
    .then(({ error: e }) => {
      if (e) console.error("[updateTenant] emit_event failed", e.message);
    });

  revalidatePath("/app/settings/tenant");
  return { ok: true };
}
