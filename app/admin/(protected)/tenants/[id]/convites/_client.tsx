"use client";

/**
 * Convites de uma empresa, pelo painel do dono (F20-T03, ADR-045 §4; D61 b/c).
 *
 * Esta tela existe por um caso concreto: o proprietário cria a empresa, fecha a
 * tela de conclusão e perde o link do convite — e não tinha como recuperá-lo,
 * porque a sessão de suporte é só-leitura (D51) e a rota de convite do tenant
 * nega escrita durante acompanhamento. Aqui ele age com a própria autoridade,
 * auditado, sem precisar ser membro da empresa do cliente.
 *
 * A partir de D60, uma empresa criada para outra pessoa nasce SEM membros — e
 * esta tela passa a ser o único lugar onde o convite pendente aparece.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

interface Convite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  link: string;
}

const PAPEIS = ["admin", "manager", "agent", "viewer"] as const;

export function ConvitesDoTenantClient({ organizationId }: { organizationId: string }) {
  const t = useT();
  const [convites, setConvites] = useState<Convite[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<(typeof PAPEIS)[number]>("admin");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch(`/api/v1/admin/tenants/${organizationId}/invites`, { cache: "no-store" });
    if (!r.ok) {
      setErro(t("Não foi possível carregar os convites desta empresa."));
      setConvites([]);
      return;
    }
    const corpo = (await r.json()) as { data?: { invites?: Convite[] } };
    setConvites(corpo.data?.invites ?? []);
  }, [organizationId, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function convidar() {
    setOcupado(true);
    setErro(null);
    const r = await fetch(`/api/v1/admin/tenants/${organizationId}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role: papel }),
    });
    setOcupado(false);
    if (!r.ok) {
      setErro(t("Não foi possível emitir o convite."));
      return;
    }
    setEmail("");
    await carregar();
  }

  async function revogar(id: string) {
    setOcupado(true);
    const r = await fetch(`/api/v1/admin/tenants/${organizationId}/invites/${id}`, { method: "DELETE" });
    setOcupado(false);
    if (!r.ok) {
      setErro(t("Não foi possível cancelar este convite."));
      return;
    }
    await carregar();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">{t("Convidar")}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="convite-email">{t("E-mail do responsável")}</Label>
            <Input
              id="convite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com.br"
            />
          </div>
          <div>
            <Label htmlFor="convite-papel">{t("Papel")}</Label>
            <select
              id="convite-papel"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={papel}
              onChange={(e) => setPapel(e.target.value as (typeof PAPEIS)[number])}
            >
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" disabled={ocupado || email.trim().length === 0} onClick={() => void convidar()}>
            {t("Convidar")}
          </Button>
        </div>
        {/* Reenviar é convidar o mesmo e-mail de novo: o link anterior morre (D61 b). */}
        <p className="mt-2 text-xs text-muted-foreground">
          {t("Reenviar convite")}: {t("Este link fica guardado: abra a empresa em Empresas › Convites para copiar de novo, reenviar ou cancelar. Reenviar gera um link novo e cancela este.")}
        </p>
      </section>

      <section className="rounded-lg border p-4" aria-labelledby="convites-da-empresa">
        <h2 id="convites-da-empresa" className="text-sm font-medium">
          {t("Convites pendentes")}
        </h2>
        {erro ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {erro}
          </p>
        ) : null}
        {convites === null ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("Carregando convites…")}</p>
        ) : convites.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("Nenhum convite pendente nesta empresa.")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {convites.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm" data-testid={`admin-convite-${c.email}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.email}</span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{c.role}</span>
                </div>
                <code className="mt-2 block break-all text-xs text-muted-foreground">{c.link}</code>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Helper da casa: fora de secure context (staging por IP)
                      // a API crua do navegador não existe.
                      void copyToClipboard(c.link).then((ok) => {
                        if (!ok) return setErro(t("Não foi possível copiar. Selecione o link e copie à mão."));
                        setCopiado(c.id);
                        setTimeout(() => setCopiado(null), 2000);
                      });
                    }}
                  >
                    {copiado === c.id ? t("Copiado") : t("Copiar link")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => void revogar(c.id)}>
                    {t("Cancelar convite")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
