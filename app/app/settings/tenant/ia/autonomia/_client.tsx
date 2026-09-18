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
  limits: { daily_turns: number; used_today: number; remaining: number | null; day: string; timezone: string; paused: boolean };
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
  const [limiteRascunho, setLimiteRascunho] = React.useState<string | null>(null);

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

  async function enviar(corpo: Record<string, unknown>, chave: string) {
    setSalvando(chave);
    try {
      const r = await apiClient.patch<{ data: Leitura }>("/api/v1/settings/ai-autonomy", corpo);
      queryClient.setQueryData<Leitura>(["ai-autonomy"], r.data);
      toast.success(t("Autonomia salva."));
      return true;
    } catch (e) {
      if (e instanceof ApiError) showApiError(e);
      else toast.error(t("Não foi possível salvar a autonomia."));
      return false;
    } finally {
      setSalvando(null);
    }
  }
  const gravar = (action: string, mode: Modo | null) => enviar({ policy: { [action]: mode } }, action);
  async function gravarLimite(valor: string) {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) {
      toast.error(t("Limite inválido: use um inteiro maior ou igual a zero."));
      return;
    }
    if (await enviar({ daily_turns: n }, "daily_turns")) setLimiteRascunho(null);
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
  const limites = dados.limits;
  return (
    <div className="grid gap-6">
    <section className="rounded-lg border bg-card p-4" data-testid="ai-limits" data-paused={limites.paused ? "1" : "0"}>
      <h2 className="font-medium">{t("Limite diário de turnos")}</h2>
      <p className="text-xs text-muted-foreground">
        {t("Quantas vezes por dia a IA pode responder nesta organização. Ao bater o limite, ela para até o dia virar e as conversas vão para a fila de pessoas. Zero é sem teto.")}
      </p>
      <p className="mt-2 text-sm" data-testid="ai-limits-uso">
        {t("Hoje")} ({limites.day}, {limites.timezone}): <span data-testid="ai-limits-usado">{limites.used_today}</span>
        {" / "}
        <span data-testid="ai-limits-teto">{limites.daily_turns === 0 ? t("sem teto") : limites.daily_turns}</span>
        {limites.paused ? <span className="ml-2 rounded-md border px-2 py-0.5 text-xs" data-testid="ai-limits-pausada">{t("IA pausada até o dia virar")}</span> : null}
      </p>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void gravarLimite(limiteRascunho ?? String(limites.daily_turns));
        }}
      >
        <label className="text-sm">
          {t("Turnos por dia")}
          <input
            type="number"
            min={0}
            step={1}
            value={limiteRascunho ?? String(limites.daily_turns)}
            onChange={(e) => setLimiteRascunho(e.target.value)}
            className="mt-1 h-9 w-32 rounded-md border bg-background px-3"
            data-testid="ai-limits-input"
          />
        </label>
        <Button type="submit" size="sm" disabled={salvando === "daily_turns"} data-testid="ai-limits-salvar">
          {salvando === "daily_turns" ? t("Salvando…") : t("Salvar limite")}
        </Button>
      </form>
    </section>
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
    </div>
  );
}
