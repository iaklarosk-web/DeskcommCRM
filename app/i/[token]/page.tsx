/**
 * `/i/<token>` — o convite curto (F20-T02, ADR-045 §2; D59).
 *
 * Rota pública, como `/team/accept-invite/[token]` (que continua viva até os
 * convites antigos expirarem — D61 a). A diferença é de onde vem o convite: ali
 * o token CARREGA o payload; aqui ele é a chave de uma linha que pode ter sido
 * revogada, aceita ou vencida — e cada um desses desfechos tem uma tela
 * própria, porque "convite inválido" para quem teve o link revogado pelo
 * administrador é uma mentira por omissão.
 *
 * O teto por IP vem antes da leitura, como na rota irmã: a rota é pública e
 * cada GET testa um token.
 */
import Link from "next/link";

import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createClient } from "@/lib/supabase/server";
import { lerConvitePorToken, type MotivoDaRecusa } from "@/src/convites/repositorio";

import { AcceptInviteForm } from "@/app/team/accept-invite/[token]/AcceptInviteForm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ConviteCurtoPage({ params }: PageProps) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma((user?.user_metadata?.locale as string | undefined) ?? null);
  const t = (texto: string) => traduzir(texto, idioma);

  if (await authRateLimited("invite_accept", null, AUTH_LIMITS.invite_accept)) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t("Muitas tentativas")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Aguarde alguns minutos e abra o link do convite de novo.")}
        </p>
      </Shell>
    );
  }

  const leitura = await lerConvitePorToken(token);

  if ("recusa" in leitura) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t(TITULO_DA_RECUSA[leitura.recusa])}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(TEXTO_DA_RECUSA[leitura.recusa])}</p>
      </Shell>
    );
  }

  const { convite } = leitura;

  if (!user) {
    const next = encodeURIComponent(`/i/${token}`);
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t("Você foi convidado")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Para aceitar o convite como")} <strong>{convite.role}</strong>,{" "}
          {t("faça login com o email")} <strong>{convite.email}</strong>.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/login?next=${next}`}
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("Fazer login")}
          </Link>
          {/* Quem ainda não tem conta: o token viaja para que o signup nasça
              amarrado a este convite, em vez de abrir uma organização fantasma. */}
          <Link href={`/signup?invite=${encodeURIComponent(token)}`} className="text-sm underline underline-offset-4">
            {t("Ainda não tenho conta")}
          </Link>
        </div>
      </Shell>
    );
  }

  const emailDoUsuario = (user.email ?? "").trim().toLowerCase();
  if (emailDoUsuario !== convite.email.trim().toLowerCase()) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t("Email não corresponde")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Você está logado como")} <strong>{user.email}</strong>,{" "}
          {t("mas o convite foi enviado para")} <strong>{convite.email}</strong>.{" "}
          {t("Saia e faça login com o email correto.")}
        </p>
        <form action="/api/auth/signout" method="post" className="mt-4">
          <button type="submit" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
            {t("Sair")}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">{t("Aceitar convite")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("Você foi convidado para entrar como")} <strong>{convite.role}</strong>.{" "}
        {t("Confirme abaixo para ativar seu acesso.")}
      </p>
      <AcceptInviteForm
        token={token}
        modo="curto"
        label={t("Aceitar convite")}
        pendingLabel={t("Confirmando…")}
        failureLabel={t("Não foi possível aceitar este convite. Ele pode ter vencido ou seu acesso foi revogado. Peça um novo link ao administrador.")}
      />
    </Shell>
  );
}

/** Cada recusa tem nome próprio: dizer "inválido" para um convite revogado esconde o que houve. */
const TITULO_DA_RECUSA: Record<MotivoDaRecusa, string> = {
  invite_not_found: "Convite inválido",
  invite_revoked: "Convite cancelado",
  invite_expired: "Convite expirado",
  invite_already_accepted: "Convite já usado",
  invite_email_mismatch: "Email não corresponde",
};

const TEXTO_DA_RECUSA: Record<MotivoDaRecusa, string> = {
  invite_not_found: "Este link não corresponde a nenhum convite. Peça um novo ao administrador da empresa.",
  invite_revoked: "Este convite foi cancelado — em geral porque um link novo foi enviado no lugar. Procure a mensagem mais recente ou peça outro.",
  invite_expired: "Este convite passou da validade de 7 dias. Peça um novo ao administrador da empresa.",
  invite_already_accepted: "Este convite já foi aceito. Se o acesso é seu, entre normalmente pela tela de login.",
  invite_email_mismatch: "Este convite foi enviado para outro endereço de e-mail.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">{children}</div>
    </div>
  );
}
