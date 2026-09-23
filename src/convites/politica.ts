/**
 * Quem gere convites (F20-T03, ADR-045 §4; D61 c).
 *
 * `tenant_admin` e `manager` veem pendentes, reenviam e revogam na PRÓPRIA
 * organização — o `manager` já cuida de equipe, fila e relatório desde a F13.
 * `agent` e `viewer` não: um atendente cancelar o acesso de um colega é uma
 * decisão de gestão, não de atendimento.
 *
 * A checagem de papel fica aqui, e não só na rota, porque o `/admin` chama o
 * mesmo caminho com a autoridade do `platform_admin` — e duas cópias da regra
 * divergem no primeiro conserto.
 */
import type { Role } from "@/lib/auth/types";

import { revogarConvite, type Deps } from "./repositorio";

export function podeGerirConvites(papel: Role | "platform_admin"): boolean {
  return papel === "admin" || papel === "manager" || papel === "platform_admin";
}

export type RecusaDaRevogacao = "sem_permissao" | "nao_encontrado";

/**
 * Revoga dentro da organização informada. "Não encontrado" cobre tanto o
 * convite inexistente quanto o de outra organização — de fora, os dois casos
 * são indistinguíveis de propósito.
 */
export async function revogarConviteDaOrganizacao(
  entrada: {
    organization_id: string;
    invite_id: string;
    papel: Role | "platform_admin";
    revoked_by: string | null;
  },
  deps: Deps = {},
): Promise<{ ok: true } | { ok: false; motivo: RecusaDaRevogacao }> {
  if (!podeGerirConvites(entrada.papel)) return { ok: false, motivo: "sem_permissao" };
  const revogou = await revogarConvite(
    { organization_id: entrada.organization_id, invite_id: entrada.invite_id, revoked_by: entrada.revoked_by },
    deps,
  );
  return revogou ? { ok: true } : { ok: false, motivo: "nao_encontrado" };
}
