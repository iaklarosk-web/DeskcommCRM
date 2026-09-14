"use client";
/**
 * F13-T03 — a fila lida de `/api/v1/crm/opportunities/queue`; "Distribuir"
 * chama `/distribute` (rodízio) e "Assumir" chama `/[id]/claim`. O que a
 * tela mostra vem da rota, nunca de estado inventado: depois de distribuir,
 * a fila é relida e as atribuições exibidas são as que a rota devolveu.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { formatCentsBRL } from "@/lib/money";

interface ItemDaFila {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  value_cents: number | null;
  contact_id: string | null;
  created_at: string;
}
interface Fila {
  mode: "manual" | "round_robin";
  queue_size: number;
  eligible: Array<{ user_id: string; open: number }>;
  items: ItemDaFila[];
}
interface Distribuicao {
  queue_size: number;
  eligible: number;
  assignments: Array<{ opportunity_id: string; user_id: string }>;
  balanced: boolean;
}

export function FilaClient({ podeDistribuir }: { podeDistribuir: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: ["crm-opportunity-queue"],
    queryFn: async () => (await apiClient.get<{ data: Fila }>("/api/v1/crm/opportunities/queue")).data,
  });
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [ultima, setUltima] = React.useState<Distribuicao | null>(null);

  async function distribuir() {
    setOcupado("distribuir");
    try {
      const r = await apiClient.post<{ data: Distribuicao }>("/api/v1/crm/opportunities/distribute", {});
      setUltima(r.data);
      toast.success(t("Fila distribuída."));
      await queryClient.invalidateQueries({ queryKey: ["crm-opportunity-queue"] });
    } catch (e) {
      if (e instanceof ApiError) showApiError(e);
      else toast.error(t("Não foi possível distribuir a fila."));
    } finally {
      setOcupado(null);
    }
  }

  async function assumir(id: string) {
    setOcupado(id);
    try {
      await apiClient.post(`/api/v1/crm/opportunities/${id}/claim`, {});
      toast.success(t("Oportunidade assumida."));
      await queryClient.invalidateQueries({ queryKey: ["crm-opportunity-queue"] });
    } catch (e) {
      if (e instanceof ApiError) showApiError(e);
      else toast.error(t("Não foi possível assumir a oportunidade."));
    } finally {
      setOcupado(null);
    }
  }

  if (consulta.isError) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="fila-erro">
        {t("Não foi possível carregar a fila.")}{" "}
        <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  const fila = consulta.data;
  if (!fila) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4" data-testid="fila-resumo">
        <div>
          <p className="text-xs uppercase text-muted-foreground">{t("Na fila")}</p>
          <p className="text-2xl font-semibold" data-testid="fila-tamanho">{fila.queue_size}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">{t("Elegíveis")}</p>
          <p className="text-2xl font-semibold" data-testid="fila-elegiveis">{fila.eligible.length}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">{t("Distribuição")}</p>
          <p className="text-sm font-medium" data-testid="fila-modo">{fila.mode === "round_robin" ? t("Rodízio") : t("Manual")}</p>
        </div>
        {podeDistribuir && (
          <Button className="ml-auto" disabled={ocupado !== null || fila.queue_size === 0 || fila.mode !== "round_robin"} onClick={() => void distribuir()} data-testid="fila-distribuir">
            {ocupado === "distribuir" ? t("Distribuindo…") : t("Distribuir por rodízio")}
          </Button>
        )}
      </section>

      {ultima && (
        <section className="rounded-lg border bg-card p-4 text-sm" data-testid="fila-ultima-distribuicao">
          <p>
            {t("Distribuídas")}: <span data-testid="fila-distribuidas">{ultima.assignments.length}</span>/{ultima.queue_size} · {t("Equilibrada")}:{" "}
            <span data-testid="fila-equilibrada">{ultima.balanced ? t("sim") : t("não")}</span>
          </p>
          <ul className="mt-2 space-y-1">
            {ultima.assignments.map((a) => (
              <li key={a.opportunity_id} data-testid={`fila-atribuicao-${a.opportunity_id}`} data-user-id={a.user_id}>
                {a.opportunity_id.slice(0, 8)} → {a.user_id.slice(0, 8)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="space-y-2" data-testid="fila-itens">
        {fila.items.length === 0 ? (
          <li className="rounded-lg border p-4 text-sm text-muted-foreground" data-testid="fila-vazia">{t("Nenhuma oportunidade sem responsável.")}</li>
        ) : (
          fila.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3" data-testid={`fila-item-${item.id}`}>
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {item.value_cents !== null ? formatCentsBRL(item.value_cents) : t("Sem valor")} · {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => void assumir(item.id)} data-testid={`fila-assumir-${item.id}`}>
                {ocupado === item.id ? t("Assumindo…") : t("Assumir")}
              </Button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
