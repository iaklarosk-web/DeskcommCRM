import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { type Produto } from "@/lib/schemas/produtos";
import { catalogQuerySchema, listCatalogPage } from "@/lib/catalogo/listar";
import { createClient } from "@/lib/supabase/server";

import { ProdutosClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * O CATÁLOGO DA LOJA — onde o preço que a IA responde é cadastrado.
 *
 * ─── Por que esta tela precisa existir ───────────────────────────────────
 *
 * A ferramenta `crm_search_products` já vinha ligada em todo agente novo, e
 * lia uma tabela que ninguém nunca preencheu. O efeito não era silêncio: era o
 * agente respondendo "não tenho nada com esse nome no catálogo" para uma loja
 * com o estoque cheio. Ferramenta que devolve vazio para 100% das lojas é pior
 * que ferramenta ausente — ela mente com autoridade.
 *
 * ─── Quem pode o quê ─────────────────────────────────────────────────────
 *
 * `viewer` VÊ o catálogo: saber quanto custa é informação de operação, e quem
 * atende precisa dela. Cadastrar e alterar preço é `manager`, e a rota cobra de
 * novo — a tela esconder o botão é cortesia, não autorização.
 */
export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar =
    supportWriteError(user.support) === null &&
    ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const params = await searchParams;
  const parsed = catalogQuerySchema.safeParse({
    busca: params.busca,
    page: params.page,
    limit: 50,
  });
  const supabase = await createClient();
  const result = parsed.success
    ? await listCatalogPage(supabase, activeOrg.orgId, parsed.data)
    : null;
  const erro = !parsed.success
    ? t("Filtros inválidos.")
    : !result || result.error || result.count === null
      ? t("Erro ao listar os produtos.")
      : null;

  return (
    <ProdutosClient
      inicial={(result?.data ?? []) as unknown as Produto[]}
      erro={erro}
      buscaInicial={parsed.success ? parsed.data.busca : ""}
      pagina={parsed.success ? parsed.data.page : 1}
      total={result?.count ?? 0}
      limite={50}
      podeEditar={podeEditar}
      textos={{
        titulo: t("Produtos"),
        subtitulo: t(
          "O catálogo da loja. É daqui que o atendente de IA tira o preço quando alguém pergunta.",
        ),
        vazio: t("Nenhum produto cadastrado ainda"),
        vazioDica: t(
          "Enquanto o catálogo estiver vazio, o atendente responde que não encontrou o produto — mesmo que a loja tenha.",
        ),
      }}
    />
  );
}
