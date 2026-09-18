import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { AutomationRulesClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * F15-T04 (ADR-036 §2, D54 e) — as regras QUANDO/ENTÃO da organização sobre o
 * catálogo: cinco gatilhos, quatro ações. A página é manager+; as rotas
 * `/api/v1/automation-rules` (herdadas, com o vocabulário do SaaS conferido)
 * decidem de verdade.
 */
export default async function AutomationRulesSettingsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Regras de automação", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Quando algo acontecer, faça uma ação do catálogo: enviar mensagem, criar tarefa, transferir a uma pessoa ou entregar a oportunidade. Toda execução fica registrada.", idioma)}
        </p>
      </header>
      <AutomationRulesClient />
    </div>
  );
}
