import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { WebchatSettingsClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * F14-T02 (ADR-038 §2, D55 c) — o chat do site da organização: ligar/desligar,
 * origens que podem embutir e o código para copiar. Manager+ (configuração
 * comercial da operação); a rota `PATCH /api/v1/settings/webchat` é quem
 * decide de verdade (`settings.manage`).
 */
export default async function WebchatSettingsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Chat do site", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Um balão de conversa no site da sua empresa. O visitante fala, a assistente responde a qualquer hora e a sua equipe continua pelo inbox no horário de atendimento.", idioma)}
        </p>
      </header>
      <WebchatSettingsClient />
    </div>
  );
}
