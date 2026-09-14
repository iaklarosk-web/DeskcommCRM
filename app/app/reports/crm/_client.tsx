"use client";
/**
 * F13-T05 — a tela do relatório comercial. Lê `/api/v1/reports/crm` e mostra
 * cada indicador com `data-testid` e `data-value` para a prova de navegador
 * comparar tela × rota × banco.
 */
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { formatCentsBRL } from "@/lib/money";
import type { RelatorioComercial } from "@/src/crm/relatorio";

function inicioDoPeriodo(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

export function RelatorioComercialClient() {
  const t = useT();
  const [dias, setDias] = React.useState(30);
  const consulta = useQuery({
    queryKey: ["crm-report", dias],
    queryFn: async () => {
      const params = new URLSearchParams({ from: inicioDoPeriodo(dias), to: new Date().toISOString() });
      return (await apiClient.get<{ data: RelatorioComercial }>(`/api/v1/reports/crm?${params}`)).data;
    },
  });

  if (consulta.isError) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="relatorio-erro">
        {t("Não foi possível carregar o relatório.")}{" "}
        <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  const rel = consulta.data;
  if (!rel) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  const Numero = ({ id, valor, rotulo, dinheiro }: { id: string; valor: number; rotulo: string; dinheiro?: boolean }) => (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs uppercase text-muted-foreground">{rotulo}</p>
      <p className="text-xl font-semibold" data-testid={`relatorio-${id}`} data-value={valor}>
        {dinheiro ? formatCentsBRL(valor) : valor}
      </p>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="relatorio-comercial" data-from={rel.from} data-to={rel.to}>
      <div className="flex items-center gap-2 text-sm">
        <span>{t("Período")}:</span>
        {[7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant={dias === d ? "default" : "outline"} onClick={() => setDias(d)} data-testid={`relatorio-periodo-${d}`}>
            {d} {t("dias")}
          </Button>
        ))}
      </div>

      <section>
        <h2 className="mb-2 font-medium">{t("Negócios no período")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Numero id="closed-won" valor={rel.closed.won} rotulo={t("Ganhos")} />
          <Numero id="closed-won-value" valor={rel.closed.won_value_cents} rotulo={t("Valor ganho")} dinheiro />
          <Numero id="closed-lost" valor={rel.closed.lost} rotulo={t("Perdidos")} />
          <Numero id="closed-lost-value" valor={rel.closed.lost_value_cents} rotulo={t("Valor perdido")} dinheiro />
          <Numero id="queue-size" valor={rel.queue_size} rotulo={t("Na fila")} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">{t("Funil (abertas agora)")}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">{t("Etapa")}</th>
              <th className="py-1 text-right">{t("Abertas")}</th>
              <th className="py-1 text-right">{t("Valor")}</th>
            </tr>
          </thead>
          <tbody data-testid="relatorio-funil">
            {rel.funnel.map((e) => (
              <tr key={e.stage_id} className="border-t" data-testid={`relatorio-etapa-${e.stage_id}`} data-open={e.open} data-value-cents={e.value_cents}>
                <td className="py-1">{e.stage_name}</td>
                <td className="py-1 text-right">{e.open}</td>
                <td className="py-1 text-right">{formatCentsBRL(e.value_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 font-medium">{t("Por responsável")}</h2>
        {rel.by_owner.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma oportunidade com responsável.")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">{t("Responsável")}</th>
                <th className="py-1 text-right">{t("Abertas")}</th>
                <th className="py-1 text-right">{t("Ganhos")}</th>
                <th className="py-1 text-right">{t("Perdidos")}</th>
              </tr>
            </thead>
            <tbody data-testid="relatorio-por-responsavel">
              {rel.by_owner.map((o) => (
                <tr key={o.user_id} className="border-t" data-testid={`relatorio-dono-${o.user_id}`} data-open={o.open} data-won={o.won} data-lost={o.lost}>
                  <td className="py-1">{o.user_id.slice(0, 8)}</td>
                  <td className="py-1 text-right">{o.open}</td>
                  <td className="py-1 text-right">{o.won}</td>
                  <td className="py-1 text-right">{o.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">{t("Tarefas e pedidos")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Numero id="tasks-open" valor={rel.tasks.open} rotulo={t("Tarefas abertas")} />
          <Numero id="tasks-overdue" valor={rel.tasks.overdue} rotulo={t("Tarefas vencidas")} />
          <Numero id="tasks-done" valor={rel.tasks.done} rotulo={t("Tarefas concluídas no período")} />
        </div>
        <ul className="mt-3 space-y-1 text-sm" data-testid="relatorio-pedidos">
          {rel.orders.length === 0 ? (
            <li className="text-muted-foreground">{t("Nenhum pedido criado no período.")}</li>
          ) : (
            rel.orders.map((o) => (
              <li key={o.status} data-testid={`relatorio-pedidos-${o.status}`} data-count={o.count} data-total-cents={o.total_cents}>
                {o.status}: {o.count} · {formatCentsBRL(o.total_cents)}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
