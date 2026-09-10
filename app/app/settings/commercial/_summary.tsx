"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { CommercialProfile, LegacyAlias } from "@/src/tenant-config/commercial-contract";

function CanonicalField({
  label,
  value,
  legacy,
}: {
  label: string;
  value: string | null;
  legacy?: LegacyAlias<string | null>;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words">{value ? value : t("Não definido na organização")}</dd>
      {legacy?.status === "conflicts" && (
        <dd className="space-y-1 rounded-md border p-2 text-sm" role="note">
          <p>{t("Configuração antiga diferente do valor em uso.")}</p>
          <p className="break-words">
            {t("Valor em uso")}: {value ?? t("Sem valor definido")}
          </p>
          <p className="break-words">
            {t("Configuração antiga")}: {legacy.value ?? t("Sem valor definido")}
          </p>
        </dd>
      )}
      {legacy?.status === "invalid" && (
        <dd role="note" className="text-sm">
          {t("A configuração antiga deste campo precisa de revisão.")}
        </dd>
      )}
    </div>
  );
}

export function CommercialSummary({ profile }: { profile: CommercialProfile }) {
  const t = useT();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3 rounded-md p-4" aria-label={t("Organização")}>
        <h2 className="text-lg font-semibold">{t("Organização")}</h2>
        <dl className="space-y-3">
          <CanonicalField label={t("Nome de exibição")} value={profile.organization.display_name} />
          <CanonicalField label={t("Razão social")} value={profile.organization.legal_name} />
          <CanonicalField label={t("CNPJ")} value={profile.organization.cnpj} />
          <CanonicalField
            label={t("Fuso horário")}
            value={profile.organization.timezone}
            legacy={profile.organization.legacy_timezone}
          />
          <CanonicalField label={t("Moeda")} value={profile.organization.currency} />
        </dl>
        {profile.capabilities.can_edit_organization ? (
          <Link href="/app/settings/tenant" className="text-sm underline">
            {t("Revisar em Organização")}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("Um administrador pode revisar os dados de Organização.")}
          </p>
        )}
      </Card>
      <Card className="space-y-3 rounded-md p-4" aria-label={t("Marca")}>
        <h2 className="text-lg font-semibold">{t("Marca")}</h2>
        <dl className="space-y-3">
          <CanonicalField
            label={t("Nome da marca")}
            value={profile.branding.app_name}
            legacy={profile.branding.legacy_name}
          />
          <CanonicalField
            label={t("Cor da marca")}
            value={profile.branding.accent_hex}
            legacy={profile.branding.legacy_primary_color}
          />
          <div>
            <dt className="text-sm text-muted-foreground">{t("Logo da organização")}</dt>
            <dd>
              {profile.branding.logo_path
                ? t("Definido na organização")
                : t("Não definido na organização")}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {t(
            "Campos de marca não definidos na organização podem herdar a aparência da instalação. Use o editor de Marca para conferir.",
          )}
        </p>
        {(profile.legacy_logo_url.status === "unsupported_url" ||
          profile.legacy_logo_url.status === "invalid") && (
          <p role="note" className="rounded-md border p-2 text-sm">
            {t(
              "Existe uma referência antiga de logo que precisa de revisão no editor de Marca. O logo atual foi preservado.",
            )}
          </p>
        )}
        {profile.capabilities.can_edit_branding ? (
          <Link href="/app/settings/marca" className="text-sm underline">
            {t("Revisar em Marca")}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("Um administrador pode revisar a marca da organização.")}
          </p>
        )}
      </Card>
    </div>
  );
}
