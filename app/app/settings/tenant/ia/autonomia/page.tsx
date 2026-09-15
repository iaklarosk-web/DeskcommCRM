import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { AiAutonomyClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * F15-T01 (ADR-036 §2, D54 b) — a autonomia da IA por AÇÃO: permitir,
 * aprovar, bloquear ou transferir, ação por ação do catálogo. A página é
 * manager+ (configuração comercial da operação); a rota
 * `PATCH /api/v1/settings/ai-autonomy` é quem decide de verdade (`settings.manage`).
 */
export default async function AiAutonomySettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const idioma = user.idioma;
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Autonomia da IA", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("O que a IA pode fazer sozinha nesta organização, ação por ação: permitir, pedir aprovação de uma pessoa, bloquear ou transferir a conversa. Sem escolha sua, vale o padrão pelo risco da ação.", idioma)}
        </p>
      </header>
      <AiAutonomyClient />
    </div>
  );
}
