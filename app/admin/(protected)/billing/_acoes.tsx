/**
 * As ações do padrão KN do /admin (F19-T04, ADR-042 §5) numa linha da tabela
 * de assinaturas: suspender, reativar, estender trial, provisionar na mão e
 * abrir no Stripe. Cada botão chama `POST /api/v1/admin/billing/[org]` e
 * recarrega a página servida — o estado que aparece depois é o do banco.
 */
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";

type Acao = { action: "suspend" } | { action: "resume" } | { action: "extend_trial"; days: number } | { action: "provision"; plan_code: string };

export function AcoesDaAssinatura({
  organizationId,
  status,
  gateway,
  planos,
  linkStripe,
  somenteLeitura,
}: {
  organizationId: string;
  status: string | null;
  gateway: string | null;
  planos: readonly string[];
  linkStripe: string | null;
  somenteLeitura: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [dias, setDias] = useState(7);
  const [plano, setPlano] = useState(planos[0] ?? "PLAN_A");

  const executar = async (acao: Acao) => {
    setBusy(acao.action);
    const res = await fetch(`/api/v1/admin/billing/${organizationId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(acao) });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    setBusy(null);
    if (!res.ok) return void toast.error(json.error?.message ? t(json.error.message) : t("A ação não foi executada."));
    toast.success(t("Assinatura atualizada."));
    router.refresh();
  };
  if (somenteLeitura) return <span className="text-xs text-muted-foreground" data-testid="admin-billing-acoes-somente-leitura">{t("só leitura")}</span>;

  const podeSuspender = status === "active" || status === "past_due";
  const podeReativar = status === "blocked";
  const podeProvisionar = gateway !== "stripe" && status !== "cancelled";
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="admin-billing-acoes" data-org={organizationId}>
      <button type="button" className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-40" data-testid="admin-billing-suspender" disabled={!podeSuspender || busy !== null} onClick={() => executar({ action: "suspend" })}>
        {t("Suspender")}
      </button>
      <button type="button" className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-40" data-testid="admin-billing-reativar" disabled={!podeReativar || busy !== null} onClick={() => executar({ action: "resume" })}>
        {t("Reativar")}
      </button>
      <span className="inline-flex items-center gap-1">
        <input type="number" min={1} max={90} value={dias} onChange={(e) => setDias(Number(e.target.value))} className="w-14 rounded-md border px-1 py-0.5 text-xs" aria-label={t("Dias de trial")} data-testid="admin-billing-trial-dias" />
        <button type="button" className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-40" data-testid="admin-billing-estender-trial" disabled={status === null || status === "cancelled" || busy !== null} onClick={() => executar({ action: "extend_trial", days: dias })}>
          {t("Estender trial")}
        </button>
      </span>
      <span className="inline-flex items-center gap-1">
        <select value={plano} onChange={(e) => setPlano(e.target.value)} className="rounded-md border px-1 py-0.5 text-xs" aria-label={t("Plano")} data-testid="admin-billing-provisionar-plano">
          {planos.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button type="button" className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-40" data-testid="admin-billing-provisionar" disabled={!podeProvisionar || busy !== null} onClick={() => executar({ action: "provision", plan_code: plano })}>
          {t("Provisionar na mão")}
        </button>
      </span>
      {linkStripe ? (
        <a href={linkStripe} target="_blank" rel="noreferrer" className="rounded-md border px-2 py-0.5 text-xs underline" data-testid="admin-billing-abrir-no-stripe">
          {t("Abrir no Stripe")}
        </a>
      ) : null}
    </div>
  );
}
