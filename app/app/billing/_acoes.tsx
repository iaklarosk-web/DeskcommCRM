/**
 * Os botões da tela de cobrança (F12-T04/T05): contratar/pagar, trocar de
 * plano e cancelar. Cada um chama a rota correspondente e recarrega a página
 * servida — o número que aparece depois é o do servidor, nunca um estado
 * local otimista (tela contra banco, F12-T08).
 */
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";

async function chamar(caminho: string, corpo: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown>; message?: string }> {
  const res = await fetch(caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { message?: string } };
  return res.ok ? { ok: true, data: json.data } : { ok: false, message: json.error?.message };
}

export function BotaoDeCheckout({ planCode, rotulo }: { planCode: string; rotulo: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
      data-testid={`billing-checkout-${planCode}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await chamar("/api/v1/billing/checkout", { plan_code: planCode });
        setBusy(false);
        if (!r.ok) return void toast.error(r.message ? t(r.message) : t("Não foi possível iniciar a contratação."));
        const url = (r.data?.checkout as { url?: string } | undefined)?.url;
        if (url) router.push(url);
        else router.refresh();
      }}
    >
      {busy ? t("Aguarde…") : rotulo}
    </button>
  );
}

export function BotaoDeTrocaDePlano({ planCode }: { planCode: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      data-testid={`billing-mudar-plano-${planCode}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await chamar("/api/v1/billing/subscription/plan", { plan_code: planCode });
        setBusy(false);
        if (!r.ok) return void toast.error(r.message ? t(r.message) : t("Não foi possível trocar o plano."));
        toast.success(t("Plano alterado."));
        router.refresh();
      }}
    >
      {busy ? t("Aguarde…") : t("Mudar para este plano")}
    </button>
  );
}

export function FormularioDeCancelamento() {
  const t = useT();
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="billing-cancelar"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await chamar("/api/v1/billing/subscription/cancel", { reason: motivo });
        setBusy(false);
        if (!r.ok) return void toast.error(r.message ? t(r.message) : t("Não foi possível cancelar."));
        toast.success(t("Assinatura cancelada. Seus dados foram preservados."));
        router.refresh();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("Motivo do cancelamento")}</span>
        <input
          className="rounded-md border px-2 py-1"
          data-testid="billing-cancelar-motivo"
          value={motivo}
          minLength={3}
          maxLength={500}
          required
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      <button type="submit" className="rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50" disabled={busy} data-testid="billing-cancelar-confirmar">
        {busy ? t("Aguarde…") : t("Cancelar assinatura")}
      </button>
    </form>
  );
}

export function BotoesDoCheckoutMock({ checkoutRef }: { checkoutRef: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"paid" | "failed" | null>(null);
  const decidir = async (outcome: "paid" | "failed") => {
    setBusy(outcome);
    const r = await chamar("/api/v1/billing/mock-checkout", { checkout_ref: checkoutRef, outcome });
    setBusy(null);
    if (!r.ok) return void toast.error(r.message ? t(r.message) : t("O gateway mock não aceitou o evento."));
    router.push("/app/billing");
    router.refresh();
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50" data-testid="mock-checkout-pagar" disabled={busy !== null} onClick={() => decidir("paid")}>
        {busy === "paid" ? t("Aguarde…") : t("Simular pagamento confirmado")}
      </button>
      <button type="button" className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50" data-testid="mock-checkout-falhar" disabled={busy !== null} onClick={() => decidir("failed")}>
        {busy === "failed" ? t("Aguarde…") : t("Simular pagamento recusado")}
      </button>
    </div>
  );
}
