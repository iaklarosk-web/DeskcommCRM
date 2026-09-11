/**
 * A tela de USO de IA do `tenant_admin` (F05-T09, §5.3, D14/D15).
 *
 * Tokens e custo estimado por período, lidos do livro-razão `ai_usage_events`
 * — uma linha por chamada, escrita por `runModelCall` na mesma transação de
 * `llm_calls` (F04-T08, ADR-023). O que aparece aqui é o que o Postgres somou
 * (`resumoDeUso`), não uma soma feita no cliente: a prova de F05-T09 compara o
 * valor exibido com `sum(ai_usage_events)` e com `GET /api/v1/settings/ai/uso`,
 * que lê pela mesma função.
 *
 * A leitura é SERVIDA (não buscada no cliente) pela mesma razão da tela de
 * configuração de IA: recarregar a página tem de trazer o número do servidor.
 * O período vem da URL (`?desde=YYYY-MM-DD&ate=YYYY-MM-DD`; sem ele, o mês
 * corrente) para que um link seja um relatório — copiável, recarregável.
 *
 * Custo é ESTIMADO e local (tabela de preço do motor, nunca do provedor); em
 * `AI_PROVIDER=mock` ele é o que a tabela cotaria. Provedor real segue
 * `NOT VALIDATED (real)` (D12).
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  mesAnteriorA,
  mesDe,
  PeriodoInvalido,
  periodoDeDatas,
  resumoDeUso,
  type PeriodoDeUso,
  type ResumoDeUso,
} from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

export const dynamic = "force-dynamic";

const TELA = "/app/settings/tenant/ia/uso";

/** `YYYY-MM-DD` do início e do ÚLTIMO dia (inclusivo) de um período `[desde, ate)`. */
function datasDaUrl(periodo: PeriodoDeUso): { desde: string; ate: string } {
  const ultimo = new Date(periodo.ate);
  ultimo.setUTCDate(ultimo.getUTCDate() - 1);
  return { desde: periodo.desde.slice(0, 10), ate: ultimo.toISOString().slice(0, 10) };
}

function centavosComoUsd(cents: number): string {
  return `US$ ${(cents / 100).toFixed(4)}`;
}

function lerPeriodo(params: { desde?: string; ate?: string }): { periodo: PeriodoDeUso; invalido: boolean } {
  if (typeof params.desde === "string" && typeof params.ate === "string") {
    try {
      return { periodo: periodoDeDatas(params.desde, params.ate), invalido: false };
    } catch (erro) {
      if (!(erro instanceof PeriodoInvalido)) throw erro;
      return { periodo: mesDe(new Date()), invalido: true };
    }
  }
  return { periodo: mesDe(new Date()), invalido: false };
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; ate?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const ctx: TenantCtx = {
    organization_id: activeOrg.orgId,
    user_id: user.id,
    role: activeOrg.role,
    source: "session",
  };

  const params = await searchParams;
  const { periodo, invalido } = lerPeriodo(params);
  const resumo: ResumoDeUso = await resumoDeUso(ctx, periodo);
  const datas = datasDaUrl(periodo);
  const agora = new Date();
  const esteMes = datasDaUrl(mesDe(agora));
  const mesPassado = datasDaUrl(mesAnteriorA(agora));
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="uso-ia">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Uso de IA desta empresa", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Tokens e custo estimado por período, somados do registro de uso — uma linha por chamada ao modelo.",
            idioma,
          )}
        </p>
      </header>

      <section className="rounded-lg border p-4" aria-labelledby="uso-ia-periodo">
        <h2 id="uso-ia-periodo" className="text-sm font-medium">
          {traduzir("Período", idioma)}
        </h2>
        <p className="mt-1 text-sm" data-testid="uso-ia-periodo-atual">
          {datas.desde} → {datas.ate}
        </p>
        {invalido ? (
          <p className="mt-1 text-sm text-destructive" data-testid="uso-ia-periodo-invalido">
            {traduzir("Período inválido; mostrando o mês corrente.", idioma)}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            className="rounded-md border px-3 py-1 hover:bg-muted"
            data-testid="uso-ia-este-mes"
            href={`${TELA}?desde=${esteMes.desde}&ate=${esteMes.ate}`}
          >
            {traduzir("Este mês", idioma)}
          </Link>
          <Link
            className="rounded-md border px-3 py-1 hover:bg-muted"
            data-testid="uso-ia-mes-passado"
            href={`${TELA}?desde=${mesPassado.desde}&ate=${mesPassado.ate}`}
          >
            {traduzir("Mês passado", idioma)}
          </Link>
        </div>
        <form method="get" action={TELA} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span>{traduzir("De", idioma)}</span>
            <input className="rounded-md border px-2 py-1" type="date" name="desde" defaultValue={datas.desde} data-testid="uso-ia-desde" />
          </label>
          <label className="flex flex-col gap-1">
            <span>{traduzir("Até", idioma)}</span>
            <input className="rounded-md border px-2 py-1" type="date" name="ate" defaultValue={datas.ate} data-testid="uso-ia-ate" />
          </label>
          <button type="submit" className="rounded-md border px-3 py-1 hover:bg-muted" data-testid="uso-ia-aplicar">
            {traduzir("Aplicar", idioma)}
          </button>
        </form>
      </section>

      <section className="grid gap-4 sm:grid-cols-4" aria-label={traduzir("Totais do período", idioma)}>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{traduzir("Chamadas", idioma)}</p>
          <p className="text-2xl font-semibold" data-testid="uso-ia-chamadas">{resumo.calls}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{traduzir("Tokens de entrada", idioma)}</p>
          <p className="text-2xl font-semibold" data-testid="uso-ia-prompt-tokens">{resumo.prompt_tokens}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{traduzir("Tokens de saída", idioma)}</p>
          <p className="text-2xl font-semibold" data-testid="uso-ia-completion-tokens">{resumo.completion_tokens}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{traduzir("Custo estimado", idioma)}</p>
          <p className="text-2xl font-semibold" data-testid="uso-ia-custo">{centavosComoUsd(resumo.estimated_cost_cents)}</p>
          <p className="text-xs text-muted-foreground">
            <span data-testid="uso-ia-custo-cents">{resumo.estimated_cost_cents.toFixed(4)}</span> {traduzir("centavos", idioma)}
          </p>
        </div>
      </section>
      <p className="text-sm" data-testid="uso-ia-total-tokens-linha">
        {traduzir("Total de tokens", idioma)}: <span data-testid="uso-ia-total-tokens">{resumo.total_tokens}</span>
      </p>

      <section className="overflow-x-auto rounded-lg border" aria-label={traduzir("Por modelo", idioma)}>
        <table className="w-full text-sm" data-testid="uso-ia-por-modelo">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2">{traduzir("Modelo", idioma)}</th>
              <th className="p-2">{traduzir("Operação", idioma)}</th>
              <th className="p-2 text-right">{traduzir("Chamadas", idioma)}</th>
              <th className="p-2 text-right">{traduzir("Tokens", idioma)}</th>
              <th className="p-2 text-right">{traduzir("Custo estimado", idioma)}</th>
            </tr>
          </thead>
          <tbody>
            {resumo.por_modelo.length === 0 ? (
              <tr>
                <td className="p-2 text-muted-foreground" colSpan={5} data-testid="uso-ia-sem-uso">
                  {traduzir("Nenhuma chamada ao modelo neste período.", idioma)}
                </td>
              </tr>
            ) : (
              resumo.por_modelo.map((linha) => (
                <tr key={`${linha.model}:${linha.operation}`} data-testid="uso-ia-linha" data-model={linha.model}>
                  <td className="p-2">{linha.model}</td>
                  <td className="p-2">{linha.operation}</td>
                  <td className="p-2 text-right">{linha.calls}</td>
                  <td className="p-2 text-right">{linha.total_tokens}</td>
                  <td className="p-2 text-right">{centavosComoUsd(linha.estimated_cost_cents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
