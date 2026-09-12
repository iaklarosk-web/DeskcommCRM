"use client";
/**
 * O formulário da tela de IA do tenant (F04-T10).
 *
 * Duas metades, e elas gravam por portas diferentes de propósito:
 *
 *  - CONFIGURAÇÃO → `PATCH /api/v1/settings/ai`, que chama `setSetting`
 *    (§5.2 invariante 4). Nenhuma escrita em `tenant_settings` sai daqui.
 *  - ACERVO → `POST /api/v1/settings/ai/acervo`, que chama `ingerirDocumento`.
 *
 * O aviso do limiar não é enfeite: 0 aceita qualquer palpite do modelo e 1 manda
 * tudo para uma pessoa. Quem configura precisa ler a consequência ANTES de
 * salvar, não descobri-la no atendimento.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import type { MaterialDoAcervo } from "@/src/knowledge";

export interface ConfiguracaoDeIa {
  enabled: boolean;
  system_prompt: string;
  unknown_answer: string;
  confidence_threshold: number;
}

const ROTA_DE_CONFIG = "/api/v1/settings/ai";
const ROTA_DO_ACERVO = "/api/v1/settings/ai/acervo";

async function mensagemDeErro(resposta: Response, padrao: string): Promise<string> {
  const corpo = (await resposta.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return corpo?.error?.message ?? padrao;
}

export function FormularioDeIa({
  inicial,
  acervo,
}: {
  inicial: ConfiguracaoDeIa;
  acervo: readonly MaterialDoAcervo[];
}) {
  const t = useT();
  const router = useRouter();
  const [form, setForm] = useState<ConfiguracaoDeIa>(inicial);
  const [aviso, setAviso] = useState<string>("");
  const [avisoDoAcervo, setAvisoDoAcervo] = useState<string>("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();
  const [enviando, iniciarEnvio] = useTransition();

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso("");
    iniciarSalvamento(async () => {
      const resposta = await fetch(ROTA_DE_CONFIG, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          "ai.enabled": form.enabled,
          "ai.system_prompt": form.system_prompt.trim() === "" ? null : form.system_prompt,
          "ai.unknown_answer": form.unknown_answer.trim() === "" ? null : form.unknown_answer,
          "ai.confidence_threshold": form.confidence_threshold,
        }),
      });
      if (!resposta.ok) {
        setAviso(await mensagemDeErro(resposta, t("Não consegui salvar.")));
        return;
      }
      setAviso(t("Configuração de IA salva."));
      router.refresh();
    });
  }

  function enviarDocumento(evento: React.FormEvent) {
    evento.preventDefault();
    setAvisoDoAcervo("");
    if (arquivo === null) {
      setAvisoDoAcervo(t("Escolha um arquivo de texto."));
      return;
    }
    iniciarEnvio(async () => {
      const corpo = new FormData();
      corpo.set("file", arquivo);
      corpo.set("name", arquivo.name);
      const resposta = await fetch(ROTA_DO_ACERVO, { method: "POST", body: corpo });
      if (!resposta.ok) {
        setAvisoDoAcervo(await mensagemDeErro(resposta, t("Não consegui indexar o documento.")));
        return;
      }
      setAvisoDoAcervo(t("Documento adicionado ao acervo desta empresa."));
      setArquivo(null);
      router.refresh();
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <form onSubmit={salvar} className="flex flex-col gap-6" data-testid="form-ia">
        <Card className="space-y-4 p-4">
          <label
            className="flex cursor-pointer items-start gap-3"
            data-testid="ia-ligada-rotulo"
          >
            <input
              type="checkbox"
              data-testid="ia-ligada"
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
              checked={form.enabled}
              disabled={salvando}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              aria-label={t("Agente de IA ligado")}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">{t("Agente de IA ligado")}</span>
              <span className="block text-xs text-muted-foreground">
                {t(
                  "Desligado, nenhuma conversa nova é respondida automaticamente — tudo espera uma pessoa.",
                )}
              </span>
            </span>
          </label>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="space-y-1">
            <Label htmlFor="ia-persona">{t("Como o agente fala")}</Label>
            <Textarea
              id="ia-persona"
              data-testid="ia-persona"
              rows={4}
              value={form.system_prompt}
              disabled={salvando}
              onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "Descreve o tom, não as permissões: as regras da casa valem sempre por cima deste texto.",
              )}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ia-nao-sei">{t("O que responder quando não souber")}</Label>
            <Textarea
              id="ia-nao-sei"
              data-testid="ia-nao-sei"
              rows={3}
              value={form.unknown_answer}
              disabled={salvando}
              onChange={(e) => setForm((f) => ({ ...f, unknown_answer: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "É o texto exato que o cliente recebe. Na segunda vez na mesma conversa, o agente chama uma pessoa.",
              )}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ia-limiar">{t("Confiança mínima para responder")}</Label>
            <Input
              id="ia-limiar"
              data-testid="ia-limiar"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.confidence_threshold}
              disabled={salvando}
              onChange={(e) =>
                setForm((f) => ({ ...f, confidence_threshold: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "Abaixo disso, o agente não responde: chama uma pessoa. Perto de 0 ele arrisca; perto de 1 quase tudo vira atendimento humano.",
              )}
            </p>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" data-testid="ia-salvar" disabled={salvando}>
            {salvando ? t("Salvando…") : t("Salvar configuração de IA")}
          </Button>
          <span role="status" data-testid="ia-aviso" className="text-xs text-muted-foreground">
            {aviso}
          </span>
        </div>
      </form>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("Acervo desta empresa")}</h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "O agente só afirma o que está aqui. O material é desta organização e nenhuma outra o enxerga.",
            )}
          </p>
        </div>

        <form
          onSubmit={enviarDocumento}
          className="flex flex-wrap items-center gap-3"
          data-testid="form-acervo"
        >
          <Input
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            data-testid="acervo-arquivo"
            className="max-w-sm"
            disabled={enviando}
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            aria-label={t("Documento para o acervo")}
          />
          <Button type="submit" data-testid="acervo-enviar" disabled={enviando}>
            {enviando ? t("Indexando…") : t("Adicionar ao acervo")}
          </Button>
          <span
            role="status"
            data-testid="acervo-aviso"
            className="text-xs text-muted-foreground"
          >
            {avisoDoAcervo}
          </span>
        </form>

        <ul className="divide-y rounded-md border" data-testid="acervo-lista">
          {acervo.length === 0 ? (
            <li className="p-3 text-xs text-muted-foreground" data-testid="acervo-vazio">
              {t("Nenhum material ainda. Sem acervo, o agente responde o texto de “não sei”.")}
            </li>
          ) : (
            acervo.map((material) => (
              <li
                key={material.id}
                data-testid="acervo-item"
                data-nome={material.nome}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <span className="truncate">{material.nome}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {material.trechos} {t("trechos")}
                </span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
