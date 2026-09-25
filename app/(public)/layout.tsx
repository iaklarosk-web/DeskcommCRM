import Link from "next/link";

import { MarcaDaFachada } from "@/components/auth/MarcaDaFachada";
import { PainelDeApresentacao } from "@/components/auth/PainelDeApresentacao";
import { precoDeEntradaDoBanco } from "@/components/auth/preco-de-entrada-do-banco";
import { branding } from "@/lib/branding";
import { marcaDaSaida } from "@/lib/branding/saida";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createClient } from "@/lib/supabase/server";

/**
 * A casca das telas de acesso — login, cadastro, recuperação, MFA — no molde
 * dos OS da KN (F23): formulário à esquerda, apresentação do produto à direita
 * em telas largas, rodapé com os textos legais.
 *
 * ── Por que a MARCA mora aqui, e não em `login/page.tsx` ─────────────────────
 *
 * São seis telas no grupo `(public)`, todas "antes de entrar": quem instala o
 * produto para clientes mostra a marca dele exatamente aí. Uma cópia por página
 * seriam seis cópias que divergem na primeira vez que alguém mexer numa só — e a
 * que ficaria para trás é sempre a que ninguém abre (recuperação de senha,
 * cadastro de MFA), onde o cliente do revendedor aparece sozinho e sem contexto.
 *
 * ── As duas resoluções da marca, de propósito ────────────────────────────────
 *
 * O LOGO vem de `marcaDaSaida(null)`: não há organização resolvida aqui, `null`
 * é a declaração disso, e a pilha é a mesma do layout raiz (banco acima, `.env`
 * embaixo). `marcaDaSaida` NUNCA lança: um logo mal gravado não pode derrubar a
 * única tela por onde se entra para corrigi-lo.
 *
 * O NOME sai de `branding()` (o `.env`) — não é descuido, está medido em
 * `tests/e2e/icone-da-marca.spec.ts`: aquela spec cruza o título da aba (que lê
 * o banco) com o nome na tela (que lê o `.env`). Trocar o texto para o mesmo
 * resolvedor deixaria a spec verde medindo nada.
 *
 * O rodapé diz só "© ano · nome": o produto é instalável por terceiros e não
 * existe configuração para a razão social de quem opera a instalação.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const marca = await marcaDaSaida(null);
  // A maioria destas telas roda ANTES do login, mas `/login/mfa` e, em parte,
  // `/login/recovery` rodam com sessão parcial (primeiro fator verificado).
  // Onde há sessão, o idioma salvo no perfil vale; sem ela, `IdiomaProvider`
  // cai no padrão pt-BR sozinho — nunca lança.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const locale = (user?.user_metadata?.locale as string | undefined) ?? null;
  const idioma = normalizarIdioma(locale);
  const t = (texto: string) => traduzir(texto, idioma);
  const nome = branding().name;
  const ano = new Date().getFullYear();
  // Lido aqui, e não dentro do painel: o painel é síncrono (ver o cabeçalho dele).
  const preco = await precoDeEntradaDoBanco();

  return (
    <IdiomaProvider locale={locale}>
      <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-[minmax(24rem,0.9fr)_minmax(30rem,1.1fr)]">
        <section
          aria-label={t("Acesso à conta")}
          className="flex min-h-screen flex-col px-6 py-7 sm:px-10 lg:px-14 xl:px-20"
        >
          <MarcaDaFachada nome={nome} logoUrl={marca.logoUrl} logoAlt={marca.nome} />

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
            {children}
          </div>

          <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-text-muted">
            <span>
              © {ano} {nome}
            </span>
            <Link href="/legal/terms" className="underline underline-offset-4 hover:text-text">
              {t("Termos")}
            </Link>
            <Link href="/legal/privacy" className="underline underline-offset-4 hover:text-text">
              {t("Privacidade")}
            </Link>
          </footer>
        </section>

        <PainelDeApresentacao idioma={idioma} preco={preco} />
      </div>
    </IdiomaProvider>
  );
}
