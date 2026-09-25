import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Nova senha" };

export default async function ResetPasswordPage() {
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
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{t("Definir nova senha")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Escolha uma nova senha para sua conta")}
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
