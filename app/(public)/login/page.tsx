import Link from "next/link";

import { LoginForm } from "@/components/auth/LoginForm";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Entrar" };

/**
 * A tela de entrar no molde dos OS da KN (F23). A marca e o painel de
 * apresentação moram em `app/(public)/layout.tsx`; aqui fica só o que é desta
 * tela: o convite, o formulário, os avisos que chegam pela URL e o caminho de
 * quem ainda não tem conta.
 *
 * O `title` "Entrar" e o nome da marca na fachada continuam sendo cruzados por
 * `tests/e2e/icone-da-marca.spec.ts`; o link "Esqueci minha senha" é o que
 * `tests/e2e/password-recovery.spec.ts` clica pelo nome.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  // Fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider` do lado do
  // servidor (o cliente já tem o seu, montado em `app/(public)/layout.tsx`).
  // Quase nunca há sessão aqui, mas resolve do mesmo jeito — `user` opcional.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);
  // Mesma fonte do Checkout (`app/api/v1/billing/checkout/route.ts`): a frase
  // da fachada e o trial cobrado nascem da mesma variável, e zero dias apaga a
  // frase em vez de prometer o que não existe.
  const trial = env.BILLING_TRIAL_DAYS;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-bold tracking-[0.14em] text-text-muted uppercase">
          {t("Bem-vindo de volta")}
        </p>
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
          {t("Entre na sua conta")}
        </h1>
        <p className="text-sm leading-6 text-text-muted">
          {t("Suas conversas, sua equipe e seus clientes, de onde você parou.")}
        </p>
      </div>
      {reset === "success" && (
        <div
          className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
          role="status"
        >
          {t("Senha redefinida com sucesso. Entre com a nova senha.")}
        </div>
      )}
      {error === "link_invalido" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t("Link inválido ou expirado. Peça um novo em Recuperar senha ou refaça o cadastro.")}
        </div>
      )}
      {/*
        Os dois avisos abaixo chegaram por frentes diferentes e falam de erros
        diferentes — o merge os pôs no mesmo lugar, e ficar com um só apagaria um
        diagnóstico inteiro da tela de login.
      */}
      {error === "convite_invalido" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas o convite não vale mais — ele expirou ou foi emitido para outro e-mail. Peça um novo a quem te convidou. Não criamos uma empresa nova para você, porque não era isso que você estava fazendo.",
          )}
        </div>
      )}
      {error === "template_padrao" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Este link veio do modelo de e-mail padrão do Supabase, que não fecha o acesso nesta instalação — pedir outro link não resolve. Quem administra o sistema precisa configurar os e-mails de acesso (",
          )}
          <code>marca-emails.sh</code>
          {t(", no kit de instalação).")}
        </div>
      )}
      {error === "provisionamento" && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas houve um erro ao preparar seu ambiente. Tente entrar novamente em instantes.",
          )}
        </div>
      )}
      <LoginForm next={next} />
      <p className="text-right text-sm">
        <Link
          href="/login/forgot"
          className="text-text-muted underline underline-offset-4 hover:text-text"
        >
          {t("Esqueci minha senha")}
        </Link>
      </p>

      <div className="space-y-3 border-t border-border pt-6">
        <p className="text-sm text-text-muted">
          {t("Ainda não tem conta?")}
          {trial > 0 ? ` ${t("Teste por")} ${trial} ${t("dias sem pagar nada no ato.")}` : ""}
        </p>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="w-full border-2 border-accent font-bold text-accent hover:bg-accent-soft hover:text-accent"
        >
          <Link href="/signup">{t("Criar conta")}</Link>
        </Button>
      </div>
    </div>
  );
}
