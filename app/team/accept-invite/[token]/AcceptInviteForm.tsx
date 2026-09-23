"use client";
import { useActionState } from "react";
import { acceptInviteAction, type AcceptInviteResult } from "@/app/actions/team/acceptInvite";
import { aceitarConviteCurtoAction, type ResultadoDoAceiteCurto } from "@/app/actions/team/aceitarConviteCurto";

/**
 * O mesmo botão para os dois caminhos de convite que convivem (D61 a): o token
 * HMAC herdado e o link curto `/i/<token>` da F20. Quem decide é `modo`; o
 * resto da tela é idêntico de propósito, porque para quem recebe o convite não
 * há diferença nenhuma.
 */
export function AcceptInviteForm({
  token,
  label,
  failureLabel,
  pendingLabel,
  modo = "token",
}: {
  token: string;
  label: string;
  failureLabel: string;
  pendingLabel: string;
  modo?: "token" | "curto";
}) {
  const [result, submit, pending] = useActionState<AcceptInviteResult | ResultadoDoAceiteCurto | null, FormData>(
    async () => (modo === "curto" ? aceitarConviteCurtoAction(token) : acceptInviteAction(token)),
    null,
  );
  return <form action={submit} className="mt-4 space-y-3">
    {result && !result.ok && <p role="alert">{failureLabel}</p>}
    <button type="submit" disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
      {pending ? pendingLabel : label}
    </button>
  </form>;
}
