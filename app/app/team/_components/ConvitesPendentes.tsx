"use client";

/**
 * Convites pendentes da organização (F20-T03, ADR-045 §4; D61 b/c).
 *
 * O que esta tela resolve, e por que ela é a peça que faltava: até a F20 o link
 * do convite existia UMA vez, na resposta da emissão. Quem fechava a tela
 * perdia o convite — não havia lista, não havia como reenviar e não havia como
 * cancelar um link que foi para o grupo errado. Agora cada convite vivo aparece
 * aqui com o link copiável, e as duas ações que faltavam.
 *
 * "Reenviar" gera um link NOVO e mata o anterior (D61 b) — por isso o botão diz
 * o que faz, em vez de sugerir que reenvia o mesmo e-mail.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import { useIdioma, useT } from "@/lib/i18n/IdiomaProvider";

interface Convite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  link: string;
}

export function ConvitesPendentes({ podeGerir }: { podeGerir: boolean }) {
  const t = useT();
  const idioma = useIdioma();
  const [convites, setConvites] = useState<Convite[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch("/api/v1/team/invites", { cache: "no-store" });
    if (!r.ok) {
      setErro(t("Não foi possível carregar os convites pendentes."));
      setConvites([]);
      return;
    }
    const corpo = (await r.json()) as { data?: { invites?: Convite[] } };
    setConvites(corpo.data?.invites ?? []);
  }, [t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function revogar(id: string) {
    setOcupado(id);
    const r = await fetch(`/api/v1/team/invites/${id}`, { method: "DELETE" });
    setOcupado(null);
    if (!r.ok) {
      setErro(t("Não foi possível cancelar este convite."));
      return;
    }
    await carregar();
  }

  async function copiar(convite: Convite) {
    // `copyToClipboard` é o helper da casa: a API crua do navegador não existe
    // fora de secure context, e o link do convite é justamente o que se copia
    // de um staging acessado por IP.
    if (await copyToClipboard(convite.link)) {
      setCopiado(convite.id);
      setTimeout(() => setCopiado(null), 2000);
    } else {
      setErro(t("Não foi possível copiar. Selecione o link e copie à mão."));
    }
  }

  if (convites === null) return <p className="text-sm text-muted-foreground">{t("Carregando convites…")}</p>;

  return (
    <section aria-labelledby="convites-pendentes" className="rounded-lg border p-4">
      <h2 id="convites-pendentes" className="text-sm font-medium">
        {t("Convites pendentes")}
      </h2>
      {erro ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      {convites.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Nenhum convite aguardando aceite.")}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {convites.map((c) => (
            <li key={c.id} className="rounded-md border p-3 text-sm" data-testid={`convite-${c.email}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{c.email}</span>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{c.role}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Vence em")} {new Date(c.expires_at).toLocaleDateString(idioma === "es" ? "es" : "pt-BR")}
              </p>
              <code className="mt-2 block break-all text-xs text-muted-foreground" data-testid={`convite-link-${c.email}`}>
                {c.link}
              </code>
              {podeGerir ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copiar(c)}>
                    {copiado === c.id ? t("Copiado") : t("Copiar link")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ocupado === c.id}
                    onClick={() => void revogar(c.id)}
                    data-testid={`convite-cancelar-${c.email}`}
                  >
                    {t("Cancelar convite")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
