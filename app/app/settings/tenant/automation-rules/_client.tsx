"use client";
/**
 * F15-T04 — a tela de regras do SaaS. Lê e grava pelas rotas herdadas
 * (`/api/v1/automation-rules`), que agora conferem o vocabulário fechado:
 * gatilhos de GATILHOS_DE_REGRA e ações do catálogo. A regra nasce LIGADA
 * aqui (a organização acabou de escrevê-la); desligar é um clique.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";

type Gatilho = "lead.created" | "lead.stage_changed" | "conversation.resolved" | "order.confirmed" | "task.overdue";
type Acao = "send_message" | "create_task" | "transfer_to_human" | "assign_owner";

interface Regra {
  id: string;
  name: string;
  trigger_event: string;
  actions: Array<{ type: string; config?: Record<string, unknown> }>;
  is_active: boolean;
  run_count: number;
  last_run_at: string | null;
}
interface Run {
  id: string;
  status: string;
  created_at: string;
  actions_result: Array<{ type: string; status: string; error?: string; detail?: Record<string, unknown> }>;
}

const GATILHOS: Gatilho[] = ["lead.created", "lead.stage_changed", "conversation.resolved", "order.confirmed", "task.overdue"];
const ACOES: Acao[] = ["send_message", "create_task", "transfer_to_human", "assign_owner"];

export function AutomationRulesClient() {
  const t = useT();
  const queryClient = useQueryClient();
  const regras = useQuery({
    queryKey: ["automation-rules"],
    staleTime: 15_000,
    queryFn: async (): Promise<Regra[]> => (await apiClient.get<{ data: Regra[] }>("/api/v1/automation-rules")).data,
  });
  const [salvando, setSalvando] = React.useState(false);
  const [aberta, setAberta] = React.useState<string | null>(null);
  const [nome, setNome] = React.useState("");
  const [gatilho, setGatilho] = React.useState<Gatilho>("order.confirmed");
  const [acao, setAcao] = React.useState<Acao>("create_task");
  const [texto, setTexto] = React.useState("");
  const runs = useQuery({
    queryKey: ["automation-rule-runs", aberta],
    enabled: aberta !== null,
    queryFn: async (): Promise<Run[]> => (await apiClient.get<{ data: Run[] }>(`/api/v1/automation-rules/${aberta}/runs?limit=20`)).data,
  });

  const rotuloDoGatilho: Record<Gatilho, string> = {
    "lead.created": t("Quando entrar uma oportunidade nova"),
    "lead.stage_changed": t("Quando uma oportunidade mudar de etapa"),
    "conversation.resolved": t("Quando uma conversa for resolvida"),
    "order.confirmed": t("Quando um pedido for confirmado"),
    "task.overdue": t("Quando uma tarefa vencer"),
  };
  const rotuloDaAcao: Record<Acao, string> = {
    send_message: t("Enviar mensagem na conversa ativa"),
    create_task: t("Criar tarefa no pedido"),
    transfer_to_human: t("Transferir a conversa a uma pessoa"),
    assign_owner: t("Entregar a oportunidade pelo rodízio"),
  };
  const rotuloDoTexto: Record<Acao, string | null> = {
    send_message: t("Texto da mensagem"),
    create_task: t("Título da tarefa"),
    transfer_to_human: t("Resumo para quem assume"),
    assign_owner: null,
  };

  function configDe(tipo: Acao, valor: string): Record<string, unknown> {
    if (tipo === "send_message") return { body: valor };
    if (tipo === "create_task") return { title: valor, priority: "medium", due_in_hours: null };
    if (tipo === "transfer_to_human") return { summary: valor };
    return { user_id: null };
  }

  async function invalidar() {
    await queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const criada = await apiClient.post<{ data: Regra }>("/api/v1/automation-rules", {
        name: nome.trim(),
        trigger_event: gatilho,
        conditions: [],
        actions: [{ type: acao, config: configDe(acao, texto.trim()) }],
      });
      await apiClient.patch(`/api/v1/automation-rules/${criada.data.id}`, { is_active: true });
      toast.success(t("Regra criada e ligada."));
      setNome("");
      setTexto("");
      await invalidar();
    } catch (err) {
      if (err instanceof ApiError) showApiError(err);
      else toast.error(t("Não foi possível criar a regra."));
    } finally {
      setSalvando(false);
    }
  }

  async function ligar(regra: Regra, ativa: boolean) {
    try {
      await apiClient.patch(`/api/v1/automation-rules/${regra.id}`, { is_active: ativa });
      await invalidar();
    } catch (err) {
      if (err instanceof ApiError) showApiError(err);
      else toast.error(t("Não foi possível alterar a regra."));
    }
  }

  async function apagar(regra: Regra) {
    try {
      await apiClient.delete(`/api/v1/automation-rules/${regra.id}`);
      if (aberta === regra.id) setAberta(null);
      await invalidar();
    } catch (err) {
      if (err instanceof ApiError) showApiError(err);
      else toast.error(t("Não foi possível apagar a regra."));
    }
  }

  if (regras.isError) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="automation-rules-erro">
        {t("Não foi possível carregar as regras.")}{" "}
        <Button variant="outline" size="sm" onClick={() => void regras.refetch()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  const lista = regras.data;
  if (!lista) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border bg-card p-4" data-testid="automation-rules">
        <h2 className="font-medium">{t("Regras")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Regras definidas")}: <span data-testid="automation-rules-total">{lista.length}</span> · {t("ligadas")}:{" "}
          <span data-testid="automation-rules-ligadas">{lista.filter((r) => r.is_active).length}</span>
        </p>
        <ul className="mt-3 space-y-2">
          {lista.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t("Nenhuma regra definida.")}</li>
          ) : (
            lista.map((r) => (
              <li key={r.id} className="rounded-md border px-3 py-2 text-sm" data-testid={`automation-rule-${r.id}`} data-active={r.is_active ? "1" : "0"}>
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{r.name}</span>{" "}
                    <span className="text-muted-foreground">
                      ({rotuloDoGatilho[r.trigger_event as Gatilho] ?? r.trigger_event} → {r.actions.map((a) => rotuloDaAcao[a.type as Acao] ?? a.type).join(", ")})
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void ligar(r, !r.is_active)} data-testid={`automation-rule-${r.id}-ligar`}>
                      {r.is_active ? t("Desligar") : t("Ligar")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAberta(aberta === r.id ? null : r.id)} data-testid={`automation-rule-${r.id}-runs`}>
                      {t("Execuções")} ({r.run_count})
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void apagar(r)} data-testid={`automation-rule-${r.id}-apagar`}>
                      {t("Apagar")}
                    </Button>
                  </span>
                </div>
                {aberta === r.id ? (
                  <ul className="mt-2 space-y-1 border-t pt-2 text-xs" data-testid={`automation-rule-${r.id}-lista-de-runs`}>
                    {(runs.data ?? []).length === 0 ? (
                      <li className="text-muted-foreground">{t("Nenhuma execução ainda.")}</li>
                    ) : (
                      (runs.data ?? []).map((run) => (
                        <li key={run.id} data-testid="automation-run" data-status={run.status}>
                          {new Date(run.created_at).toLocaleString()} · <span className="font-medium">{run.status}</span> ·{" "}
                          {run.actions_result.map((a) => `${a.type}: ${a.status}${a.error ? ` (${a.error})` : ""}`).join("; ")}
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>
      <section className="rounded-lg border bg-card p-4">
        <h2 className="font-medium">{t("Nova regra")}</h2>
        <form className="mt-3 grid gap-2" data-testid="nova-regra" onSubmit={(e) => void criar(e)}>
          <label className="text-sm">
            {t("Nome")}
            <input required maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-3" data-testid="nova-regra-nome" />
          </label>
          <label className="text-sm">
            {t("Quando")}
            <select value={gatilho} onChange={(e) => setGatilho(e.target.value as Gatilho)} className="mt-1 h-9 w-full rounded-md border bg-background px-3" data-testid="nova-regra-gatilho">
              {GATILHOS.map((g) => (
                <option key={g} value={g}>{rotuloDoGatilho[g]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("Então")}
            <select value={acao} onChange={(e) => setAcao(e.target.value as Acao)} className="mt-1 h-9 w-full rounded-md border bg-background px-3" data-testid="nova-regra-acao">
              {ACOES.map((a) => (
                <option key={a} value={a}>{rotuloDaAcao[a]}</option>
              ))}
            </select>
          </label>
          {rotuloDoTexto[acao] !== null ? (
            <label className="text-sm">
              {rotuloDoTexto[acao]}
              <input required maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-3" data-testid="nova-regra-texto" />
            </label>
          ) : null}
          <div>
            <Button type="submit" size="sm" disabled={salvando} data-testid="nova-regra-salvar">
              {salvando ? t("Salvando…") : t("Criar regra")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
