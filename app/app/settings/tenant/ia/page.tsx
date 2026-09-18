/**
 * A tela de IA do `tenant_admin` (F04-T10, §5.2/§5.10, D15).
 *
 * Persona, texto de "não sei", limiar de confiança, liga/desliga e o acervo da
 * organização — as cinco coisas que §7.5 pede, numa página só, porque são a
 * mesma decisão: o que o agente pode dizer em nome desta empresa.
 *
 * A leitura é SERVIDA (não buscada no cliente) porque a prova de F04-T10 recarrega
 * a página e cobra que o valor volte: buscar no cliente faria o teste medir o
 * estado do React, e o que precisa ser medido é o que está em `tenant_settings`.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerConfiguracaoDeIa } from "@/lib/settings/ia-do-tenant";
import { listarAcervo, type MaterialDoAcervo } from "@/src/knowledge";
import type { TenantCtx } from "@/src/tenant-context";

import { FormularioDeIa, type ConfiguracaoDeIa } from "./_form";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const ctx: TenantCtx = {
    organization_id: activeOrg.orgId,
    user_id: user.id,
    role: activeOrg.role,
    source: "session",
  };

  // A MESMA leitura que `GET /api/v1/settings/ai` faz — inclusive a regra de
  // presença de `ai.enabled` (ver `lib/settings/ia-do-tenant.ts`).
  const config = await lerConfiguracaoDeIa(ctx);
  const inicial: ConfiguracaoDeIa = {
    enabled: config["ai.enabled"],
    system_prompt: config["ai.system_prompt"] ?? "",
    unknown_answer: config["ai.unknown_answer"] ?? "",
    confidence_threshold: config["ai.confidence_threshold"],
  };

  // O acervo desta organização — e só dela. O predicado é o de
  // `src/knowledge/ingestao.ts`; nenhuma consulta desta página monta o seu.
  let acervo: MaterialDoAcervo[] = [];
  try {
    acervo = await listarAcervo(ctx);
  } catch {
    // Acervo indisponível não derruba a tela de configuração: a persona e o
    // limiar continuam editáveis, e a lista aparece vazia com o aviso.
    acervo = [];
  }

  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Agente de IA desta empresa", idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Como o agente fala, o que ele responde quando não sabe, e a partir de que confiança ele chama uma pessoa.",
            idioma,
          )}
        </p>
      </header>
      <FormularioDeIa inicial={inicial} acervo={acervo} />
    </div>
  );
}
