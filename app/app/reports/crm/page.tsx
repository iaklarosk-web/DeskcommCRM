import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { RelatorioComercialClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * F13-T05 (ADR-034 §2) — o relatório comercial da organização. A página é
 * manager+ (a rota decide pela permissão `reports.read`); os números vêm da
 * rota, que vem de `fn_crm_report` — a tela não soma nada por conta própria.
 */
export default async function RelatorioComercialPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const idioma = user.idioma;
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Relatório comercial", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Funil com valor, negócios ganhos e perdidos, fila, tarefas e pedidos do período.", idioma)}
        </p>
      </header>
      <RelatorioComercialClient />
    </div>
  );
}
