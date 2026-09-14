"use client";
/**
 * F15-T01 — a tabela de autonomia por ação. Lê e grava pela rota
 * `/api/v1/settings/ai-autonomy`; cada linha mostra o modo EFETIVO e a origem
 * (padrão pelo risco, ou escolha da organização). Mudar é um PATCH com a
 * ação e o modo; "Voltar ao padrão" manda `null`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";

type Modo = "allow" | "approve" | "block" | "transfer";
interface Linha {
  action: string;
  mode: Modo;
  source: "padrão" | "organização";
  risk: "low" | "medium" | "high" | "blocked";
  configurable: boolean;
}
interface Leitura {
  policy: Record<string, Modo>;
  confirm_from_risk: unknown;
  table: Linha[];
}

const MODOS: Modo[] = ["allow", "approve", "block", "transfer"];

export function AiAutonomyClient() {
  const t = useT();
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: ["ai-autonomy"],
    staleTime: 30_000,
    queryFn: async (): Promise<Leitura> => (await apiClient.get<{ data: Leitura }>("/api/v1/settings/ai-autonomy")).data,
  });
  const [salvando, setSalvando] = React.useState<string | null>(null);

  const rotuloDoModo: Record<Modo, string> = {
    allow: t("Permitir"),
    approve: t("Pedir aprovação"),
    block: t("Bloquear"),
    transfer: t("Transferir a uma pessoa"),
  };
  const rotuloDoRisco: Record<Linha["risk"], string> = {
    low: t("baixo"),
    medium: t("médio"),
    high: t("alto"),
    blocked: t("bloqueado"),
  };

  async function gravar(action: string, mode: Modo | null) {
    setSalvando(action);
    try {
      const r = await apiClient.patch<{ data: Leitura }>("/api/v1/settings/ai-autonomy", { policy: { [action]: mode } });
      queryClient.setQueryData<Leitura>(["ai-autonomy"], r.data);
      toast.success(t("Autonomia salva."));
    } catch (e) {
      if (e instanceof ApiError) showApiError(e);
      else toast.error(t("Não foi possível salvar a autonomia."));
    } finally {
      setSalvando(null);
    }
  }

  if (consulta.isError) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="ai-autonomy-erro">
        {t("Não foi possível carregar a autonomia.")}{" "}
        <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  const dados = consulta.data;
  if (!dados) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  const sobrescritas = dados.table.filter((l) => l.source === "organização").length;
  return (
    <section className="rounded-lg border bg-card p-4" data-testid="ai-autonomy">
      <p className="text-xs text-muted-foreground">
        {t("Pedir aprovação vale para ações feitas dentro de uma conversa (pedido, quantidade, mensagem); numa ação sem conversa, como criar tarefa, a IA é recusada em vez de esperar.")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("Ações do catálogo")}: <span data-testid="ai-autonomy-total">{dados.table.length}</span> · {t("com escolha da organização")}:{" "}
        <span data-testid="ai-autonomy-sobrescritas">{sobrescritas}</span>
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t("Ação")}</th>
              <th className="py-2 pr-3 font-medium">{t("Risco")}</th>
              <th className="py-2 pr-3 font-medium">{t("Modo")}</th>
              <th className="py-2 pr-3 font-medium">{t("Origem")}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {dados.table.map((linha) => (
              <tr key={linha.action} className="border-t" data-testid={`ai-autonomy-${linha.action}`} data-mode={linha.mode} data-source={linha.source}>
                <td className="py-2 pr-3 font-mono text-xs">{linha.action}</td>
                <td className="py-2 pr-3">{rotuloDoRisco[linha.risk]}</td>
                <td className="py-2 pr-3">
                  {linha.configurable ? (
                    <select
                      value={linha.mode}
                      disabled={salvando === linha.action}
                      onChange={(e) => void gravar(linha.action, e.target.value as Modo)}
                      className="h-9 rounded-md border bg-background px-2"
                      data-testid={`ai-autonomy-${linha.action}-modo`}
                      aria-label={`${t("Modo")} ${linha.action}`}
                    >
                      {MODOS.map((m) => (
                        <option key={m} value={m}>{rotuloDoModo[m]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted-foreground">{t("Só uma pessoa faz isto")}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{linha.source === "organização" ? t("escolha da organização") : t("padrão pelo risco")}</td>
                <td className="py-2 text-right">
                  {linha.source === "organização" ? (
                    <Button variant="ghost" size="sm" disabled={salvando === linha.action} onClick={() => void gravar(linha.action, null)} data-testid={`ai-autonomy-${linha.action}-padrao`}>
                      {t("Voltar ao padrão")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
