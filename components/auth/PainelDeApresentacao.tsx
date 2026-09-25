import Link from "next/link";

import { menorPrecoAnunciavel, type PrecoDeEntrada } from "@/components/auth/preco-de-entrada";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { CalendarBlank, Funnel, Inbox, Robot } from "@/lib/ui/icons";
import { listarPlanos } from "@/src/billing/planos";

/**
 * O painel à direita das telas de acesso — o molde dos OS da KN (PDV, Oferta,
 * Transportes): quem chega por um link compartilhado entende o produto antes
 * de ter conta. Só em telas largas (`lg:`); no celular a tela é o formulário.
 *
 * O que ele afirma sobre o produto vem do que o produto FAZ (F03 inbox, F14
 * chat do site e agenda, F15 autonomia por ação, F13 CRM comercial). Não há
 * cliente, número ou depoimento inventado.
 *
 * O preço NÃO é literal: sai de `plans` (D14 — a tela e o Stripe nascem da
 * mesma linha), e a linha some quando nenhum plano é anunciável. A leitura do
 * banco é a única coisa aqui que pode falhar, e ela falha FECHADA para o
 * painel (sem preço), nunca para a tela de entrar: derrubar o login por causa
 * de uma frase promocional seria o pior negócio possível.
 */
async function precoDeEntrada(): Promise<PrecoDeEntrada | null> {
  try {
    return menorPrecoAnunciavel(await listarPlanos());
  } catch (erro) {
    logger.warn("fachada: preço dos planos indisponível; painel sai sem preço", {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}

function formatarPreco(preco: PrecoDeEntrada, idioma: Idioma): string {
  return (preco.price_cents / 100).toLocaleString(idioma === "es" ? "es" : "pt-BR", {
    style: "currency",
    currency: preco.currency || "BRL",
    maximumFractionDigits: 0,
  });
}

const DESTAQUES = [
  {
    Icone: Inbox,
    titulo: "Uma fila só",
    texto: "WhatsApp e chat do site na mesma caixa, com o histórico de cada cliente.",
  },
  {
    Icone: Robot,
    titulo: "IA com limites",
    texto: "Por ação, você decide: a IA responde sozinha, propõe ou pede aprovação. Com teto diário.",
  },
  {
    Icone: CalendarBlank,
    titulo: "Agenda sincronizada",
    texto: "Google Agenda por atendente. A IA marca horário sem conflito.",
  },
  {
    Icone: Funnel,
    titulo: "CRM comercial",
    texto: "Funis, contatos, tarefas e relatório, com campos próprios de cada empresa.",
  },
] as const;

export async function PainelDeApresentacao({ idioma }: { idioma: Idioma }) {
  const t = (texto: string) => traduzir(texto, idioma);
  const preco = await precoDeEntrada();
  const trial = env.BILLING_TRIAL_DAYS;

  return (
    <aside
      aria-label={t("Apresentação do produto")}
      className="relative hidden overflow-hidden bg-neutral-900 p-12 text-neutral-50 lg:flex lg:flex-col lg:justify-between xl:p-16 dark:border-l dark:border-border dark:bg-surface-elevated"
    >
      <div
        aria-hidden="true"
        className="absolute -top-32 -right-32 size-96 rounded-full border border-white/10 bg-accent-400/20"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -left-28 size-[30rem] rounded-full border border-white/10 bg-white/5"
      />

      <div className="relative flex max-w-xl flex-col gap-6">
        <span className="w-fit rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[0.16em] uppercase">
          {t("Para quem atende clientes pelo WhatsApp")}
        </span>
        <h2 className="text-4xl leading-[1.08] font-bold tracking-tight text-balance xl:text-[2.75rem]">
          {t(
            "Atendimento por WhatsApp e chat do site, com IA que resolve e passa para a equipe o que importa.",
          )}
        </h2>
        <p className="max-w-lg text-base leading-7 text-neutral-300">
          {t(
            "As conversas entram numa fila só. Os agentes de IA respondem dentro dos limites que você define, marcam horário na agenda e chamam uma pessoa quando precisa. Tudo registrado, por empresa.",
          )}
        </p>
      </div>

      <ul className="relative grid max-w-xl grid-cols-2 gap-3">
        {DESTAQUES.map(({ Icone, titulo, texto }) => (
          <li
            key={titulo}
            className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/5 p-4"
          >
            <Icone size={22} className="text-accent-300" aria-hidden="true" />
            <p className="font-bold">{t(titulo)}</p>
            <p className="text-xs leading-5 text-neutral-300">{t(texto)}</p>
          </li>
        ))}
      </ul>

      <p className="relative text-sm text-neutral-300" data-testid="fachada-planos">
        {preco && (
          <>
            {t("Planos a partir de")} {formatarPreco(preco, idioma)} {t("por mês")}
            {trial > 0 ? `, ${trial} ${t("dias grátis")}` : ""}.{" "}
          </>
        )}
        <Link
          href="/signup"
          className="font-bold text-accent-300 underline underline-offset-4 hover:text-neutral-50"
        >
          {t("Conhecer os planos")}
        </Link>
      </p>
    </aside>
  );
}
