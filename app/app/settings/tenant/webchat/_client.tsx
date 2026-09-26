"use client";

/**
 * F14-T02 (ADR-038 §2, D55 c) — a tela do chat do site. Tudo o que ela mostra
 * vem de `GET /api/v1/settings/webchat`; nada é inventado no cliente. O código
 * de embed e a URL da página são derivados no servidor (origem pública da
 * requisição — `src/http/origem-publica.ts`).
 *
 * F24 (Suporte KN, 25/09/2026): a seção "Quando a conversa vai para uma
 * pessoa" — `webchat.handoff_mode` (`atendente` | `retorno`) e
 * `webchat.return_deadline_text` — e a nota sobre o pré-preenchimento
 * (`window.__crmWebchatPrefill`), com a ressalva de que a identidade do
 * visitante é declarada, não autenticada.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";

type ModoDaFila = "atendente" | "retorno";

interface Leitura {
  enabled: boolean;
  allowed_origins: string[];
  handoff_mode: ModoDaFila;
  return_deadline_text: string;
  slug: string;
  chat_url: string;
  embed_snippet: string;
}

export function WebchatSettingsClient() {
  const t = useT();
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: ["webchat-settings"],
    staleTime: 30_000,
    queryFn: async (): Promise<Leitura> => (await apiClient.get<{ data: Leitura }>("/api/v1/settings/webchat")).data,
  });
  const [salvando, setSalvando] = React.useState(false);
  const [origensRascunho, setOrigensRascunho] = React.useState<string | null>(null);
  const [filaRascunho, setFilaRascunho] = React.useState<{ modo: ModoDaFila; prazo: string } | null>(null);

  async function enviar(corpo: Record<string, unknown>): Promise<boolean> {
    setSalvando(true);
    try {
      const r = await apiClient.patch<{ data: Leitura }>("/api/v1/settings/webchat", corpo);
      queryClient.setQueryData<Leitura>(["webchat-settings"], r.data);
      toast.success(t("Chat do site salvo."));
      return true;
    } catch (e) {
      if (e instanceof ApiError) showApiError(e);
      else toast.error(t("Não foi possível salvar o chat do site."));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  if (consulta.isError) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="webchat-erro">
        {t("Não foi possível carregar o chat do site.")}{" "}
        <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  const dados = consulta.data;
  if (!dados) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  const origensTexto = origensRascunho ?? dados.allowed_origins.join("\n");
  const fila = filaRascunho ?? { modo: dados.handoff_mode, prazo: dados.return_deadline_text };
  const exemploDeRetorno = t("Recebemos sua pergunta. {empresa} responde por {contato} em até {prazo}.")
    .replace("{empresa}", dados.slug)
    .replace("{contato}", t("e-mail ou telefone informado"))
    .replace("{prazo}", fila.prazo || t("1 dia útil"));

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border bg-card p-4" data-testid="webchat-estado" data-enabled={dados.enabled ? "1" : "0"}>
        <h2 className="font-medium">{t("Estado")}</h2>
        <p className="text-sm">
          {dados.enabled ? t("O chat do site está ligado.") : t("O chat do site está desligado. Ninguém consegue abrir uma conversa até você ligar.")}
        </p>
        <Button
          className="mt-3"
          variant={dados.enabled ? "outline" : "default"}
          disabled={salvando}
          data-testid="webchat-alternar"
          onClick={() => void enviar({ enabled: !dados.enabled })}
        >
          {dados.enabled ? t("Desligar o chat") : t("Ligar o chat")}
        </Button>
      </section>

      <section className="rounded-lg border bg-card p-4" data-testid="webchat-embed">
        <h2 className="font-medium">{t("Como colocar no site")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Cole esta linha antes do fechamento do </body> das páginas do seu site. Ou use o link direto como botão.")}
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted p-3 text-xs" data-testid="webchat-snippet">{dados.embed_snippet}</pre>
        <p className="mt-2 text-sm">
          {t("Link direto")}: <a className="underline" href={dados.chat_url} target="_blank" rel="noreferrer" data-testid="webchat-url">{dados.chat_url}</a>
        </p>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="webchat-prefill">
          {t("Pré-preenchimento: o site pode definir window.__crmWebchatPrefill = { name, contact } antes do script. Os campos chegam preenchidos e continuam editáveis.")}{" "}
          {t("A identidade do visitante é declarada, não autenticada: o CRM registra o que foi digitado ou pré-preenchido.")}
        </p>
      </section>

      <section className="rounded-lg border bg-card p-4" data-testid="webchat-fila" data-handoff-mode={dados.handoff_mode}>
        <h2 className="font-medium">{t("Quando a conversa vai para uma pessoa")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("O visitante já informou nome e contato antes da primeira resposta. Escolha o que ele lê enquanto espera.")}
        </p>
        <form
          className="mt-2 grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            void enviar({ handoff_mode: fila.modo, return_deadline_text: fila.prazo.trim() || "1 dia útil" }).then((ok) => {
              if (ok) setFilaRascunho(null);
            });
          }}
        >
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="handoff_mode"
              value="atendente"
              checked={fila.modo === "atendente"}
              onChange={() => setFilaRascunho({ ...fila, modo: "atendente" })}
              data-testid="webchat-fila-atendente"
            />
            <span>
              <span className="block font-medium">{t("Fila para um atendente (padrão)")}</span>
              <span className="block text-xs text-muted-foreground">{t("Sua conversa está na fila para um atendente.")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="handoff_mode"
              value="retorno"
              checked={fila.modo === "retorno"}
              onChange={() => setFilaRascunho({ ...fila, modo: "retorno" })}
              data-testid="webchat-fila-retorno"
            />
            <span>
              <span className="block font-medium">{t("Retorno combinado: avisar o prazo")}</span>
              <span className="block text-xs text-muted-foreground">{exemploDeRetorno}</span>
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t("Prazo de retorno")}</span>
            <input
              className="max-w-xs rounded-md border bg-background p-2 text-sm"
              value={fila.prazo}
              maxLength={80}
              disabled={fila.modo !== "retorno"}
              onChange={(ev) => setFilaRascunho({ ...fila, prazo: ev.target.value })}
              data-testid="webchat-prazo"
            />
          </label>
          <div>
            <Button type="submit" size="sm" disabled={salvando || filaRascunho === null}>{t("Salvar fila")}</Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-card p-4" data-testid="webchat-origens">
        <h2 className="font-medium">{t("Sites que podem embutir")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Uma origem por linha (https://www.suaempresa.com.br). Vazio = qualquer site pode embutir o chat.")}
        </p>
        <form
          className="mt-2 grid gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const lista = origensTexto.split(/\r?\n/).map((o) => o.trim()).filter((o) => o.length > 0);
            void enviar({ allowed_origins: lista }).then((ok) => {
              if (ok) setOrigensRascunho(null);
            });
          }}
        >
          <textarea
            className="min-h-24 rounded-md border bg-background p-2 text-sm"
            value={origensTexto}
            onChange={(ev) => setOrigensRascunho(ev.target.value)}
            data-testid="webchat-origens-campo"
          />
          <div>
            <Button type="submit" size="sm" disabled={salvando || origensRascunho === null}>{t("Salvar origens")}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
