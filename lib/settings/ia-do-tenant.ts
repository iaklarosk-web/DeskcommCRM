/**
 * A leitura das Settings de IA como a TELA e a API as mostram (F04-T10).
 *
 * Existe num lugar só porque a página (`app/app/settings/tenant/ia/page.tsx`) e
 * a rota (`app/api/v1/settings/ai/route.ts`) respondem a mesma pergunta, e a
 * prova de F04-T10 compara uma com a outra: duas leituras com regras
 * ligeiramente diferentes fariam a tela e o banco discordarem sem que nenhum dos
 * dois estivesse errado sozinho.
 *
 * ═══ `ai.enabled` é lido por PRESENÇA, e isso não é detalhe ═════════════════
 *
 * O schema de §5.2 dá `true` como default, mas a guarda que decide se a IA
 * responde (`src/conversation/guards.ts`, casos `ai_available`/`ai_enabled`) lê
 * por PRESENÇA: sem linha em `tenant_settings`, a IA não atende. Mostrar
 * "ligado" numa organização que nunca configurou nada seria a tela afirmando o
 * contrário do que o produto faz — e o `tenant_admin` só descobriria no
 * atendimento que não aconteceu.
 *
 * As outras três chaves usam `getSetting` normalmente: o default delas É o
 * comportamento (limiar 0,6; persona e "não sei" vazios).
 */
import { getSetting, getStoredSetting } from "@/src/tenant-config";
import type { TenantCtx } from "@/src/tenant-context";

/** As quatro chaves que a tela de IA governa — a lista fechada. */
export const CHAVES_DA_TELA_DE_IA = [
  "ai.enabled",
  "ai.system_prompt",
  "ai.unknown_answer",
  "ai.confidence_threshold",
] as const;

export interface ConfiguracaoDeIaDoTenant {
  "ai.enabled": boolean;
  "ai.system_prompt": string | null;
  "ai.unknown_answer": string | null;
  "ai.confidence_threshold": number;
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

export async function lerConfiguracaoDeIa(ctx: TenantCtx): Promise<ConfiguracaoDeIaDoTenant> {
  const ligada = await getStoredSetting(ctx, "ai.enabled");
  const limiar = await getSetting(ctx, "ai.confidence_threshold");
  return {
    "ai.enabled": ligada.present && ligada.value === true,
    "ai.system_prompt": comoTexto(await getSetting(ctx, "ai.system_prompt")),
    "ai.unknown_answer": comoTexto(await getSetting(ctx, "ai.unknown_answer")),
    "ai.confidence_threshold": typeof limiar === "number" ? limiar : 0.6,
  };
}
