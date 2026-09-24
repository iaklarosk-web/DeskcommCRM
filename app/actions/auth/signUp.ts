"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import {
  signupSchema,
  signupComConviteSchema,
  type SignupInput,
  type SignupComConviteInput,
} from "@/lib/auth/schemas";
import { resolverConvite } from "@/lib/auth/resolver-de-convite";
import { createAdminClient } from "@/lib/supabase/admin";
import { aceitarConvitePorToken } from "@/src/convites/repositorio";
import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";

export type SignUpResult =
  | {
      ok: true;
      /**
       * O provedor de auth JÁ abriu a sessão neste `signUp()` — quer dizer,
       * "Confirm email" está DESLIGADO nele e não vai existir link nenhum para
       * clicar. Quem chama precisa saber disto: a tela de "confirme seu e-mail"
       * é uma instrução impossível de cumprir nesse estado, e a pessoa fica
       * esperando para sempre um e-mail que nunca sai — autenticada, sem
       * organização, sem motivo para navegar até a saída que existe.
       *
       * Medido em 2026-09-05 na `origin/main` @ `4d50f63f`, com
       * `GOTRUE_MAILER_AUTOCONFIRM=true`: a tela dizia "Enviamos um link de
       * confirmação para …", e ao mesmo tempo o cookie `sb-deskcomm-auth`
       * estava no browser e `user_organizations` do usuário vinha `[]`.
       *
       * Achado de @KIRAzinx566, com um cliente real travado nessa tela.
       */
      sessao_ativa: boolean;
    }
  | {
      ok: false;
      error: "validation_error" | "rate_limited" | "signup_failed";
      details?: Record<string, unknown>;
    };

/**
 * Signup self-service: cria o usuário no GoTrue e dispara o e-mail de
 * confirmação. O tenant só é provisionado quando o link é confirmado em
 * /auth/confirm (evita orgs órfãs de cadastros nunca confirmados).
 *
 * Anti-enumeração: e-mail já cadastrado recebe a MESMA resposta de sucesso —
 * o GoTrue devolve um usuário ofuscado (identities vazio) sem erro, e nós não
 * diferenciamos. Rate limit de envio de e-mail é do próprio GoTrue.
 */
export async function signUp(
  input: SignupInput | SignupComConviteInput,
  /**
   * Token de convite, quando a conta está sendo criada para ACEITAR um convite.
   * Viaja até `/auth/confirm` pelo `user_metadata` — o mesmo canal que
   * `org_name` já usa e que o e2e do signup exercita. Ele não dá acesso a nada
   * sozinho: quem decide é `decidirConviteDoSignup`, comparando a assinatura do
   * token com o e-mail que o provedor de auth confirmou.
   */
  inviteToken?: string,
): Promise<SignUpResult> {
  const temConvite = typeof inviteToken === "string" && inviteToken.trim() !== "";
  const parsed = temConvite
    ? signupComConviteSchema.safeParse(input)
    : signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? env.NEXT_PUBLIC_APP_URL;
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Criar conta é fluxo raro por pessoa: teto baixo por IP evita fábrica de
  // organizações (cada signup provisiona tenant). Issue #64.
  if (await authRateLimited("signup", null, AUTH_LIMITS.signup)) {
    return { ok: false, error: "rate_limited" };
  }

  // Só vira convite se o token verificar E for para este e-mail. Divergência
  // aqui não é erro do usuário — é tentativa de entrar em organização alheia
  // colando um token que chegou para outra pessoa.
  let convite: string | null = null;
  let origemDoConvite: "team_invites" | "legado" | null = null;
  if (temConvite && inviteToken) {
    // Resolve token NOVO (linha em `team_invites`) e legado (JWT HMAC) no mesmo
    // lugar: antes da T07 só o legado era entendido aqui, e `app/i/[token]`
    // mandava o curto — todo convidado lia "convite expirado" (ADR-047 §4).
    const resolvido = await resolverConvite(inviteToken);
    if (!resolvido) {
      return { ok: false, error: "validation_error", details: { invite: ["convite_invalido"] } };
    }
    if (resolvido.email.trim().toLowerCase() !== parsed.data.email.trim().toLowerCase()) {
      return { ok: false, error: "validation_error", details: { invite: ["email_divergente"] } };
    }
    convite = inviteToken;
    origemDoConvite = resolvido.origem;
  }

  // ─── A porta do convidado ────────────────────────────────────────────────
  // Com convite VIVO e e-mail conferido, a conta nasce pelo service role, que
  // não passa pelo `GOTRUE_DISABLE_SIGNUP`. Sem convite nada muda: a porta
  // pública segue sendo a pública, e na produção ela recusa (D13).
  //
  // `email_confirm: true` não concede nada novo — o token do convite JÁ é o
  // segredo portador da organização. O que evita é a tela impossível de pedir
  // confirmação onde não há remetente configurado (§B29).
  if (convite && origemDoConvite === "team_invites") {
    const admin = createAdminClient();
    const { data: criado, error: erroDoServico } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { invite_token: convite },
    });
    if (erroDoServico) {
      await audit({
        action: "auth.signup_failed",
        metadata: { email_hash: hashEmail(parsed.data.email), reason: erroDoServico.message, via: "convite" },
        requestId,
        ip,
        userAgent,
      });
      return { ok: false, error: "signup_failed" };
    }
    await audit({
      action: "auth.signup_requested",
      actorUserId: criado?.user?.id ?? null,
      metadata: { email_hash: hashEmail(parsed.data.email), via: "convite" },
      requestId,
      ip,
      userAgent,
    });
    // O VÍNCULO ACONTECE AQUI, não no `/auth/confirm`: com o e-mail já
    // confirmado, aquela rota nunca é visitada, e sem isto a pessoa teria conta
    // e nenhuma organização — a tela impossível de novo, por outro caminho.
    const vinculo = await aceitarConvitePorToken({ token: convite, user_id: criado!.user!.id });
    if (!vinculo.ok) {
      await audit({
        action: "auth.signup_failed",
        actorUserId: criado?.user?.id ?? null,
        metadata: { email_hash: hashEmail(parsed.data.email), reason: vinculo.recusa, via: "convite" },
        requestId,
        ip,
        userAgent,
      });
      return { ok: false, error: "signup_failed", details: { invite: [vinculo.recusa] } };
    }

    // Sem sessão: o service role cria a conta, não autentica o browser. A tela
    // manda para o login, que agora funciona porque a conta existe, o e-mail já
    // está confirmado e a organização já é dela.
    return { ok: true, sessao_ativa: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Ver comentário equivalente em requestPasswordReset.ts: ?type=signup
      // sobrevive ao redirect do GoTrue e é o que distingue este fluxo do de
      // recovery quando a verificação chega via `code` (PKCE), não `token_hash`.
      emailRedirectTo: `${origin}/auth/confirm?type=signup`,
      // O convite é revalidado no servidor mesmo tendo sido validado ao montar
      // a tela: o campo de e-mail do formulário é adulterável no cliente, e a
      // decisão que importa acontece com o e-mail JÁ confirmado pelo provedor.
      data: convite
        ? { invite_token: convite }
        : { org_name: (parsed.data as SignupInput).org_name },
    },
  });

  if (error) {
    if (error.status === 429) return { ok: false, error: "rate_limited" };
    await audit({
      action: "auth.signup_failed",
      metadata: {
        email_hash: hashEmail(parsed.data.email),
        reason: error.message,
      },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: "signup_failed" };
  }

  await audit({
    action: "auth.signup_requested",
    actorUserId: data.user?.id ?? null,
    metadata: { email_hash: hashEmail(parsed.data.email) },
    requestId,
    ip,
    userAgent,
  });

  // `data.session` é o único sinal confiável de que o provedor não vai mandar
  // e-mail nenhum: ele vem preenchido exatamente quando a confirmação está
  // desligada (ou já resolvida) e o GoTrue devolveu tokens junto do usuário.
  return { ok: true, sessao_ativa: data.session !== null };
}
