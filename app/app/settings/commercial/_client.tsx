"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import type { CommercialProfile, CommercialValues } from "@/src/tenant-config/commercial-contract";
import { CommercialFields } from "./_fields";
import { CommercialSummary } from "./_summary";
import { COMMERCIAL_KEYS, commercialPatch } from "./_values";

const ENDPOINT = "/api/v1/settings/commercial";
function valuesOf(profile: CommercialProfile): CommercialValues {
  return Object.fromEntries(
    COMMERCIAL_KEYS.map((key) => [key, structuredClone(profile.settings[key].value)]),
  ) as CommercialValues;
}
function errorStatus(error: unknown): number | null {
  return typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : null;
}

/** Descarta leitura/rascunho anterior ao mudar o tenant efetivo de AuthProvider. */
export function CommercialSettingsClient() {
  const { activeOrg } = useAuth();
  const t = useT();
  if (!activeOrg) return <p role="status">{t("Carregando dados comerciais…")}</p>;
  return <TenantCommercialSettings key={activeOrg.orgId} />;
}

function TenantCommercialSettings() {
  const [attempt, setAttempt] = React.useState(0);
  const t = useT();
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6" data-testid="dados-comerciais">
      <header>
        <h1 className="text-2xl font-semibold">{t("Dados comerciais")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Contato, atendimento, entrega e política comercial da empresa.")}
        </p>
      </header>
      <CommercialLoader key={attempt} onReload={() => setAttempt((value) => value + 1)} />
    </main>
  );
}

function CommercialLoader({ onReload }: { onReload: () => void }) {
  const t = useT();
  const [profile, setProfile] = React.useState<CommercialProfile | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .get<{ data: CommercialProfile }>(ENDPOINT, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setProfile(response.data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            errorStatus(cause) === 403
              ? "Você não tem acesso aos dados comerciais desta organização."
              : "Não foi possível carregar os dados comerciais.",
          );
      });
    return () => controller.abort();
  }, []);
  if (error)
    return (
      <Card className="space-y-3 rounded-md p-4">
        <p role="alert">{t(error)}</p>
        <Button variant="outline" onClick={onReload}>
          {t("Tentar novamente")}
        </Button>
      </Card>
    );
  if (!profile) return <p role="status">{t("Carregando dados comerciais…")}</p>;
  return <CommercialEditor initialProfile={profile} onReload={onReload} />;
}

function CommercialEditor({
  initialProfile,
  onReload,
}: {
  initialProfile: CommercialProfile;
  onReload: () => void;
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [profile, setProfile] = React.useState(initialProfile);
  const [baseline, setBaseline] = React.useState(() => valuesOf(initialProfile));
  const [draft, setDraft] = React.useState(() => valuesOf(initialProfile));
  const [saving, setSaving] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [confirmReload, setConfirmReload] = React.useState(false);
  const mutation = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => mutation.current?.abort(), []);
  const canWrite = profile.capabilities.can_write_commercial && !blocked;
  const patch = commercialPatch(baseline, draft);
  const dirty = Object.keys(patch).length > 0;
  const present = Object.fromEntries(
    COMMERCIAL_KEYS.map((key) => [key, profile.settings[key].present]),
  ) as Record<keyof CommercialValues, boolean>;
  const latest = COMMERCIAL_KEYS.map((key) => profile.settings[key].updated_at)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  const updated = latest ? new Date(latest) : null;

  function change<K extends keyof CommercialValues>(key: K, value: CommercialValues[K]) {
    if (!canWrite || mutation.current) return;
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setSaved(false);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || mutation.current || !dirty) return;
    const controller = new AbortController();
    mutation.current = controller;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await apiClient.patch<{ data: CommercialProfile }>(
        ENDPOINT,
        { settings: patch },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setProfile(response.data);
      setBaseline(valuesOf(response.data));
      setDraft(valuesOf(response.data));
      setSaved(true);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const status = errorStatus(cause);
      if (status === 401 || status === 403) {
        setBlocked(true);
        setError("Sua permissão de escrita mudou. Recarregue os dados antes de continuar.");
      } else if (status === 400 || status === 422) {
        setError(
          "Revise os dados informados e os limites dos campos. Suas alterações continuam no formulário.",
        );
      } else {
        setError(
          "Não foi possível salvar os dados comerciais. Suas alterações continuam no formulário.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <>
      <Card className="space-y-4 rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("Atendimento e entrega")}</h2>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => (dirty ? setConfirmReload(true) : onReload())}
          >
            {t("Recarregar dados")}
          </Button>
        </div>
        {!canWrite && <p className="text-sm text-muted-foreground">{t("Somente leitura")}</p>}
        {confirmReload && (
          <div className="space-y-2 rounded-md border p-3" role="alert">
            <p>{t("Recarregar descarta as alterações ainda não salvas.")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setConfirmReload(false)}>
                {t("Manter alterações")}
              </Button>
              <Button onClick={onReload}>{t("Descartar alterações e recarregar")}</Button>
            </div>
          </div>
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => void save(event)}
          aria-label={t("Editar dados comerciais")}
        >
          <CommercialFields
            values={draft}
            present={present}
            disabled={!canWrite || saving}
            onChange={change}
          />
          {dirty && <p className="text-sm">{t("Alterações ainda não salvas.")}</p>}
          {canWrite && (
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? t("Salvando…") : t("Salvar dados comerciais")}
            </Button>
          )}
          {error && <p role="alert">{t(error)}</p>}
          {saved && <p role="status">{t("Dados comerciais salvos.")}</p>}
        </form>
        {updated && !Number.isNaN(updated.getTime()) && (
          <p className="text-xs text-muted-foreground">
            {t("Última atualização")}:{" "}
            <time dateTime={updated.toISOString()}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "short",
                timeStyle: "short",
              }).format(updated)}
            </time>
          </p>
        )}
      </Card>
      <CommercialSummary profile={profile} />
    </>
  );
}
