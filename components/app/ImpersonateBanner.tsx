"use client";
import { useT } from "@/hooks/i18n/useT";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useOrganizationTransition } from "@/components/shell/OrganizationTransitionProvider";

export interface ImpersonatingInfo {
  tenantId: string;
  tenantName: string;
  expiresAt: string;
  accessMode?: "full" | "support_readonly";
  /** F11-T02 (D39): motivo e escopo do acompanhamento, visíveis no banner. */
  reason?: string | null;
  scope?: string;
}
export function notifySupportTransition() {
  localStorage.setItem("support-context-transition", String(Date.now()));
}
export function ImpersonateBanner({ impersonating, ended = false }: {
  impersonating: ImpersonatingInfo | null; ended?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const transition = useOrganizationTransition();
  useEffect(() => {
    if (!impersonating || ended) return;
    const timer = setTimeout(() => {
      transition.begin("Acompanhamento encerrado. Confirmando acesso…");
      window.location.assign("/support-ended");
    }, Math.max(0, new Date(impersonating.expiresAt).getTime()-Date.now()));
    return () => clearTimeout(timer);
  }, [impersonating, ended, transition]);
  if (!impersonating) return null;
  async function handleEnd() {
    flushSync(() => { setBusy(true); transition.begin("Encerrando acompanhamento…"); });
    try {
      const res = await fetch("/api/v1/admin/impersonate/end", { method: "POST" });
      if (!res.ok) throw new Error("Não foi possível encerrar o acompanhamento. Tente novamente.");
      notifySupportTransition();
      window.location.assign("/app/inbox");
    } catch (error) {
      transition.cancel(); setBusy(false);
      toast.error(error instanceof Error ? error.message : "Falha de conexão.");
    }
  }
  return <div role="alert" className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950">
    <span data-testid="suporte-banner" data-scope={impersonating.scope ?? ""} data-expires-at={impersonating.expiresAt}>
      {ended ? t("Acompanhamento encerrado") : t("Suporte à organização")} <strong>{impersonating.tenantName}</strong>
      {!ended && (impersonating.accessMode === "support_readonly" ? ` — ${t("Somente leitura")}` : ` — ${t("Edição permitida")}`)}
      {!ended && impersonating.reason ? <> · {t("Motivo")}: <span data-testid="suporte-banner-motivo">{impersonating.reason}</span></> : null}
      {!ended && impersonating.scope ? <> · {t("Escopo")}: <span data-testid="suporte-banner-escopo">{impersonating.scope}</span></> : null}
      {!ended ? <> · {t("Vence às")} <span data-testid="suporte-banner-vencimento">{new Date(impersonating.expiresAt).toLocaleTimeString()}</span></> : null}
    </span>
    <Button size="sm" variant="outline" onClick={handleEnd} disabled={busy}>{t("Sair do acompanhamento")}</Button>
  </div>;
}
