"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { esquecerEmail, lembrarEmail, lerEmailLembrado } from "@/lib/auth/lembrar-email";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPassword } from "@/app/actions/auth/signInWithPassword";

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // "Lembrar meu e-mail neste aparelho" (F23): só o e-mail, nunca a senha — ver
  // lib/auth/lembrar-email.ts. Nasce desmarcado no servidor e no primeiro paint;
  // o efeito abaixo lê o storage DEPOIS da hidratação, senão o servidor renderiza
  // vazio e o cliente hidrata preenchido (React #418).
  const [lembrar, setLembrar] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    const salvo = lerEmailLembrado();
    if (salvo) {
      setValue("email", salvo);
      setLembrar(true);
    }
  }, [setValue]);

  const onSubmit = (values: LoginInput) => {
    setServerError(null);
    // Antes de enviar, e não só no sucesso: o sucesso redireciona pelo Server
    // Action e este componente nunca volta a rodar. Lembrar um e-mail cuja senha
    // errou é inofensivo; desmarcar apaga na hora.
    if (lembrar) lembrarEmail(values.email);
    else esquecerEmail();
    startTransition(async () => {
      // Server Action redirects on success — no return value reaches here.
      // On failure, an error discriminator is returned and rendered inline.
      const res = await signInWithPassword(values, next);
      if (!res) {
        // Should be unreachable (redirect throws), but guard anyway.
        router.replace(next || "/app");
        return;
      }
      if (res.error === "mfa_required") {
        const params = new URLSearchParams();
        if (next) params.set("next", next);
        if (res.challengeId) params.set("factor", res.challengeId);
        router.replace(`/login/mfa${params.toString() ? `?${params}` : ""}`);
        return;
      }
      if (res.error === "invalid_credentials") {
        setServerError(t("Email ou senha incorretos."));
      } else if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Erro inesperado. Tente novamente."));
      }
    });
  };

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={errors.email ? true : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{t(errors.email.message ?? "")}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("Senha")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{t(errors.password.message ?? "")}</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          name="lembrar"
          checked={lembrar}
          onChange={(e) => setLembrar(e.target.checked)}
          className="size-4 rounded-sm border-border accent-accent"
        />
        {t("Lembrar meu e-mail neste aparelho")}
      </label>
      {serverError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {serverError}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full font-bold" disabled={isPending}>
        {isPending ? t("Entrando...") : t("Entrar")}
      </Button>
    </form>
  );
}
