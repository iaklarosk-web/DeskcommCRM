"use server";

/**
 * Aceite do convite CURTO (F20-T02, ADR-045 §2).
 *
 * O trabalho real é do banco: `fn_aceitar_convite_de_equipe` trava a linha,
 * recusa por motivo nomeado e cria a membership numa transação só. Aqui ficam
 * as três coisas que são da aplicação: exigir sessão, recusar durante
 * acompanhamento de suporte (quem está em sessão de suporte não aceita convite
 * em nome de ninguém) e registrar a auditoria.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { readSupportContext } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { aceitarConvitePorToken, type MotivoDaRecusa } from "@/src/convites/repositorio";

export type ResultadoDoAceiteCurto =
  | { ok: false; error: "not_authenticated" | "internal_error"; message?: string }
  | { ok: false; error: MotivoDaRecusa }
  | { ok: true };

export async function aceitarConviteCurtoAction(token: string): Promise<ResultadoDoAceiteCurto> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  if (await readSupportContext(supabase)) {
    return { ok: false, error: "internal_error", message: "Saia do acompanhamento antes de aceitar o convite." };
  }

  const resultado = await aceitarConvitePorToken({ token, user_id: user.id });
  if (!resultado.ok) return { ok: false, error: resultado.recusa };

  await audit({
    action: "member.accepted",
    actorUserId: user.id,
    organizationId: resultado.organization_id,
    resourceType: "membership",
    resourceId: resultado.invite_id,
    metadata: { invite_id: resultado.invite_id, via: "link_curto" },
  });

  (await cookies()).set("active_org", resultado.organization_id, {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/app");
}
