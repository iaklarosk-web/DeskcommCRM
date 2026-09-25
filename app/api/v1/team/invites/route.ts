/**
 * `GET /api/v1/team/invites` — os convites pendentes da organização ativa
 * (F20-T03, ADR-045 §4; D61 c).
 *
 * Quem lê: `tenant_admin` e `manager` (mesma matriz da F13 para equipe). A
 * tabela é service_only, então a leitura passa pelo pool de serviço com a
 * organização vinda da SESSÃO — nunca de parâmetro, que seria a porta para ler
 * convite de outra empresa.
 *
 * O `token` vai na resposta de propósito: é o link que o administrador copia
 * para mandar pelo WhatsApp. Quem chega aqui já provou papel de gestão na
 * organização dona do convite.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { podeGerirConvites } from "@/src/convites/politica";
import { listarPendentes } from "@/src/convites/repositorio";
import { linkDoConvite } from "@/src/convites/token";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  if (!podeGerirConvites(org.role)) {
    return fail("forbidden", "Acesso negado.", 403, { requestId });
  }

  const pendentes = await listarPendentes(org.orgId);
  return ok(
    {
      invites: pendentes.map((c) => ({
        id: c.id,
        email: c.email,
        role: c.role,
        invited_by: c.invited_by,
        expires_at: c.expires_at,
        created_at: c.created_at,
        link: linkDoConvite(env.NEXT_PUBLIC_APP_URL, c.token),
      })),
    },
    { requestId },
  );
}
