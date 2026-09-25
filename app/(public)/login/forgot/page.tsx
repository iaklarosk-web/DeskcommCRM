import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Recuperar senha" };

export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{t("Recuperar senha")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Informe seu e-mail e enviaremos um link de redefinição")}
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-sm text-muted-foreground">
        {t("Lembrou a senha?")}{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          {t("Entrar")}
        </Link>
      </p>
    </div>
  );
}
