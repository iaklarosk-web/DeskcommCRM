import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { FilaClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * F13-T03 (ADR-034 §2) — a fila de oportunidades sem responsável. Todo
 * atendente vê e pode assumir; distribuir por rodízio é manager+ (a rota
 * decide pela permissão `opportunities.assign`).
 */
export default async function FilaDeOportunidadesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");
  const podeDistribuir = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const idioma = user.idioma;
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Fila de oportunidades", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Oportunidades abertas sem responsável: distribuir por rodízio ou assumir uma.", idioma)}
        </p>
      </header>
      <FilaClient podeDistribuir={podeDistribuir} />
    </div>
  );
}
