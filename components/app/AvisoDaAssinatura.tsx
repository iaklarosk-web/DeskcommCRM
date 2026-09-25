/**
 * A faixa da ASSINATURA (F12-T04/T06, D44): aparece em toda tela de /app
 * quando a organização está em carência (`past_due` — aviso com o prazo) ou
 * bloqueada por atraso (`blocked` — só leitura). Mesma razão da faixa de
 * conexão caída: aviso guardado onde ninguém passa é aviso que não existe.
 * Em `active` (ou organização herdada sem assinatura) não renderiza nada.
 */
"use client";
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import type { EstadoDeAcesso } from "@/src/billing/acesso";

export function AvisoDaAssinatura({ acesso }: { acesso: EstadoDeAcesso | null }) {
  const t = useT();
  if (acesso === null || acesso.mode === "full" && acesso.status !== "past_due") return null;
  const prazo = acesso.grace_until ? new Date(acesso.grace_until).toLocaleDateString() : null;
  const bloqueada = acesso.mode === "read_only";
  return (
    <div
      role="status"
      data-testid="aviso-da-assinatura"
      data-status={acesso.status ?? ""}
      className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${bloqueada ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-900"}`}
    >
      <span>
        {bloqueada
          ? t("Assinatura bloqueada por atraso: você pode ver seus dados, mas novas operações estão suspensas até o pagamento.")
          : t("Pagamento não confirmado. Regularize até")}
        {!bloqueada && prazo ? ` ${prazo}` : null}
      </span>
      <Link href="/app/billing" className="rounded-md border px-3 py-1 hover:bg-background" data-testid="aviso-da-assinatura-link">
        {t("Ver cobrança")}
      </Link>
    </div>
  );
}
