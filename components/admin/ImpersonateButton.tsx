"use client";
/**
 * ImpersonateButton (S-11.07)
 *
 * Triggers `POST /api/v1/admin/tenants/[id]/impersonate`. Confirmation is
 * mandatory — the body of the dialog spells out that every subsequent action
 * will be flagged with `acting_as_platform_admin=true` in the audit log.
 *
 * On success: pushes the user to the redirect_url returned by the API
 * (default `/app/inbox`) so they immediately enter the tenant context.
 */
import { useState } from "react";
import { flushSync } from "react-dom";
import { useOrganizationTransition } from "@/components/shell/OrganizationTransitionProvider";
import { notifySupportTransition } from "@/components/app/ImpersonateBanner";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { ESCOPOS_DO_SUPORTE, type EscopoDoSuporte } from "@/lib/impersonate/support";

interface ImpersonateButtonProps {
  organizationId: string;
  displayName: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function ImpersonateButton({
  organizationId,
  displayName,
  disabled,
  disabledReason,
}: ImpersonateButtonProps) {
  const t = useT();
  const transition = useOrganizationTransition();
  // F11-T02 (D39/D51, ADR-030 §4): o acompanhamento é SÓ LEITURA, com
  // motivo obrigatório, escopo e vencimento escolhido (até 60 min).
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<EscopoDoSuporte>("all");
  const [minutes, setMinutes] = useState(60);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const motivoValido = reason.trim().length >= 10 && reason.trim().length <= 500;

  async function handleConfirm() {
    flushSync(() => { setBusy(true); transition.begin("Carregando acompanhamento…"); });
    try {
      const res = await fetch(
        `/api/v1/admin/tenants/${organizationId}/impersonate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_mode: "support_readonly", reason: reason.trim(), scope, expires_in_minutes: minutes }),
        },
      );
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const rawMsg = (json as { error?: { message?: string } })?.error?.message;
        const errorMsg = rawMsg ? t(rawMsg) : t("Não foi possível iniciar impersonate");
        transition.cancel();
        toast.error(errorMsg);
        return;
      }
      const redirectUrl =
        (json as { data?: { redirect_url?: string } })?.data?.redirect_url ??
        "/app/inbox";
      setOpen(false);
      // Hard navigation so the new cookie is sent on the next request and the
      // server layout can read it to render the banner.
      notifySupportTransition();
      window.location.assign(redirectUrl);
      // Fallback (in case assign is intercepted in tests).

    } catch (err) {
      transition.cancel();
      toast.error(t("Erro de rede ao iniciar impersonate"));
      console.error("[impersonate] start error", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          className="w-full"
          variant="outline"
          disabled={disabled}
          aria-label={
            disabled
              ? (disabledReason ?? t("Impersonate indisponível"))
              : `${t("Acompanhar")} ${displayName}`
          }
          title={disabled ? disabledReason : undefined}
        >
          {t("Acompanhar organização")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Iniciar acompanhamento?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Acompanhe")} <span className="font-semibold text-foreground">{displayName}</span> {t("com sua identidade de administrador, somente leitura. Motivo, escopo e vencimento ficam registrados na auditoria.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span>{t("Motivo do acompanhamento")}</span>
            <textarea
              className="rounded-md border px-2 py-1"
              aria-label={t("Motivo do acompanhamento")}
              data-testid="suporte-motivo"
              minLength={10}
              maxLength={500}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("Escopo")}</span>
            <select className="rounded-md border px-2 py-1" aria-label={t("Escopo")} data-testid="suporte-escopo" value={scope} onChange={(e) => setScope(e.target.value as EscopoDoSuporte)}>
              {ESCOPOS_DO_SUPORTE.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("Vencimento (minutos, até 60)")}</span>
            <input className="rounded-md border px-2 py-1" type="number" min={1} max={60} aria-label={t("Vencimento (minutos, até 60)")} data-testid="suporte-minutos" value={minutes} onChange={(e) => setMinutes(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <p className="text-xs text-muted-foreground">{t("Somente leitura")}: {t("nenhuma escrita é permitida durante o acompanhamento.")}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("Cancelar")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={busy || !motivoValido}>
            {busy ? t("Entrando…") : t("Confirmar e entrar")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
