import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { CrmFieldsClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * F13-T01 (ADR-034 §2) — os campos configuráveis por ORGANIZAÇÃO (contatos e
 * empresas). A página é manager+ (mesmo corte de Etapas do funil); a rota
 * `PUT /api/v1/settings/crm-fields` é quem decide de verdade (`fields.manage`).
 */
export default async function CrmFieldsSettingsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Campos do cadastro", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Os campos que contatos e empresas desta organização carregam além do padrão. Apagar um campo não apaga o que já foi gravado.", idioma)}
        </p>
      </header>
      <CrmFieldsClient />
    </div>
  );
}
