/**
 * A ORGANIZAÇÃO NUNCA FICA SEM ADMIN.
 *
 * Em 25/09/2026 o proprietário saiu de um tenant de cliente por `DELETE` em psql. Antes
 * de apertar o gatilho eu contei os admins na mão e vi que sobrava um. Deu
 * certo — mas a regra morava na minha atenção, não no código, e quem repetisse
 * o comando sem contar deixaria a empresa órfã: sem ninguém que possa convidar,
 * configurar ou pagar, e com o acompanhamento da plataforma em SÓ LEITURA
 * (D51), incapaz de destravar.
 *
 * Aqui ela vira código, e recusa em vez de avisar (ADR-048 §4): empresa sem
 * admin não pode existir nem por engano.
 */
export type Papel = "viewer" | "agent" | "manager" | "admin";

export interface MembroDaOrganizacao {
  readonly user_id: string;
  readonly role: Papel;
}

export type RecusaDaEquipe = "ultimo_admin" | "membro_nao_encontrado" | "papel_igual";

/** Quem pode sair ou ser rebaixado sem deixar a empresa sem comando. */
function admins(membros: readonly MembroDaOrganizacao[]): readonly MembroDaOrganizacao[] {
  return membros.filter((m) => m.role === "admin");
}

export function podeRemover(
  membros: readonly MembroDaOrganizacao[],
  user_id: string,
): { ok: true } | { ok: false; recusa: RecusaDaEquipe } {
  const alvo = membros.find((m) => m.user_id === user_id);
  if (!alvo) return { ok: false, recusa: "membro_nao_encontrado" };
  if (alvo.role === "admin" && admins(membros).length <= 1) {
    return { ok: false, recusa: "ultimo_admin" };
  }
  return { ok: true };
}

export function podeMudarPapel(
  membros: readonly MembroDaOrganizacao[],
  user_id: string,
  novo: Papel,
): { ok: true } | { ok: false; recusa: RecusaDaEquipe } {
  const alvo = membros.find((m) => m.user_id === user_id);
  if (!alvo) return { ok: false, recusa: "membro_nao_encontrado" };
  if (alvo.role === novo) return { ok: false, recusa: "papel_igual" };
  // Rebaixar o último admin produz o MESMO estado órfão que removê-lo. Sem esta
  // metade, a regra teria uma porta lateral (ADR-048 §4).
  if (alvo.role === "admin" && novo !== "admin" && admins(membros).length <= 1) {
    return { ok: false, recusa: "ultimo_admin" };
  }
  return { ok: true };
}
