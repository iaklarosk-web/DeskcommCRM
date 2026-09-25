import {
  interfaceSettingsSchema,
  INTERFACE_COMPLETA,
  interfaceTemDestino,
  type InterfaceSettings,
} from "@/lib/navigation/interface";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { emitirConvite, type PapelDoConvite } from "@/src/convites/repositorio";
import { buildInviteEmail } from "@/lib/email/templates/invite";
import { sendEmail } from "@/lib/email/resend";
import { marcaDaSaida } from "@/lib/branding/saida";

/**
 * Link sempre existe, inclusive quando a instalação não configurou e-mail.
 *
 * F20 (D59/D61): o convite virou LINHA (`team_invites`) e o link virou
 * `/i/<token>` — ~47 chars em vez dos 559 que o WhatsApp não linkificava
 * (§B27). A emissão revoga o convite vivo anterior da mesma pessoa, então
 * "reenviar" tem um só link válido por vez (D61 b). O token HMAC continua
 * sendo ACEITO enquanto os convites já enviados não expiram (D61 a), mas não é
 * mais EMITIDO.
 */
export async function issueInvite(input: {
  interfaceSettings?: InterfaceSettings;
  email: string;
  role: "viewer" | "agent" | "manager" | "admin";
  organizationId: string;
  orgName: string;
  inviterId: string;
  inviterName: string;
  requestId: string;
  dispatch?: boolean;
}) {
  const interfaceSettings = interfaceSettingsSchema.parse(
    input.interfaceSettings ?? INTERFACE_COMPLETA,
  );
  if (!interfaceTemDestino(interfaceSettings, input.role))
    throw new Error("Selecione ao menos uma área permitida ao papel.");
  const email = input.email.trim().toLowerCase();
  const { convite, link: acceptUrl, revogados } = await emitirConvite({
    organization_id: input.organizationId,
    email,
    role: input.role as PapelDoConvite,
    invited_by: input.inviterId,
    interface_settings: interfaceSettings,
    app_url: env.NEXT_PUBLIC_APP_URL,
    // `dispatch: false` é a repetição idempotente da criação de tenant: ela
    // devolve o MESMO link, em vez de revogar o que já foi enviado.
    reaproveitar_vivo: input.dispatch === false,
  });
  const inviteId = convite.id;
  const exp = Math.floor(new Date(convite.expires_at).getTime() / 1000);
  let dispatched = false;
  // Falhas de infraestrutura não desfazem a organização já criada nem o link.
  if (input.dispatch !== false) {
    try {
      const marca = await marcaDaSaida(input.organizationId);
      const message = buildInviteEmail({
        inviterName: input.inviterName,
        orgName: input.orgName,
        acceptUrl,
        role: input.role,
        expiresAt: new Date(exp * 1000),
        marca,
      });
      const result = await sendEmail({
        to: email,
        ...message,
        fromName: marca.nome,
        tags: [
          { name: "kind", value: "team_invite" },
          { name: "org", value: input.organizationId },
        ],
      });
      dispatched = result.ok;
    } catch {
      /* A superfície de recuperação é o link devolvido abaixo. */
    }
    await audit({
      action: "member.invited",
      actorUserId: input.inviterId,
      organizationId: input.organizationId,
      resourceType: "membership",
      resourceId: inviteId,
      requestId: input.requestId,
      metadata: { email, role: input.role, email_dispatched: dispatched, revogados_no_reenvio: revogados },
    });
  }
  return {
    email,
    invite_id: inviteId,
    expires_at: new Date(exp * 1000).toISOString(),
    email_dispatched: dispatched,
    accept_url: acceptUrl,
  };
}
