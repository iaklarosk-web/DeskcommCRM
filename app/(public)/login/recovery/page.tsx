import Link from "next/link";

import { RecoveryForm } from "@/components/auth/RecoveryForm";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Recuperar acesso" };

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
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
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{t("Recuperar acesso")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Use um código de recuperação para reconfigurar sua autenticação em duas etapas.")}
        </p>
      </div>
      <RecoveryForm next={next} />
      <div className="text-sm">
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("Voltar ao login")}
        </Link>
      </div>
    </div>
  );
}
