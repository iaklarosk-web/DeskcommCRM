import { verifyInviteToken } from "@/lib/auth/invite-token";
import { lerConvitePorToken } from "@/src/convites/repositorio";

/**
 * Um convite pode chegar em dois formatos ao mesmo tempo, e os dois têm de
 * valer:
 *
 * - `team_invites` (F20): token curto e aleatório, com linha no banco — é o
 *   que a tela emite hoje, e o único revogável.
 * - legado (pré-F20): JWT HMAC de 559 caracteres, com tudo na própria URL.
 *   Nenhum banco sabe dele; ele vale até vencer sozinho.
 *
 * Antes da T07 o `/signup?invite=` só conhecia o legado, e `app/i/[token]`
 * mandava o token CURTO para lá — quem foi convidado lia "convite expirado"
 * (ADR-047 §Contexto, elo 4). Resolver os dois num lugar só é o que impede
 * esse descasamento de voltar: quem precisa do e-mail do convite chama aqui.
 */
export type ConviteResolvido = {
  token: string;
  email: string;
  origem: "team_invites" | "legado";
};

export async function resolverConvite(token: string): Promise<ConviteResolvido | null> {
  const limpo = token.trim();
  if (limpo === "") return null;

  // O token novo primeiro: é o que a emissão produz hoje, e é o único que sabe
  // dizer "revogado" e "já aceito" em vez de um "inválido" genérico.
  const daLinha = await lerConvitePorToken(limpo);
  if ("convite" in daLinha && daLinha.convite.email !== "") {
    return { token: limpo, email: daLinha.convite.email, origem: "team_invites" };
  }

  const doLegado = verifyInviteToken(limpo);
  if (doLegado) return { token: limpo, email: doLegado.email, origem: "legado" };

  return null;
}
