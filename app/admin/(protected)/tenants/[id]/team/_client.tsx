"use client";

/**
 * Membros de uma empresa, pelo painel do dono (F21, ADR-048).
 *
 * Esta tela existe por 25/09/2026: fechado o D60, o proprietário precisou sair
 * do tenant do cliente e NÃO HAVIA TELA. A remoção saiu por `DELETE` em psql,
 * sem rastro em `api_audit_log`, com a regra do último admin conferida na mão.
 *
 * O que ela NÃO faz: adicionar membro. Isso é o convite (F20), que exige aceite
 * da pessoa. Uma segunda porta de entrada seria pior que a ausência da tela.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

interface Membro {
  user_id: string;
  email: string;
  role: string;
  accepted_at: string | null;
}

const PAPEIS = ["admin", "manager", "agent", "viewer"] as const;

export function EquipeDoTenantClient({ organizationId }: { organizationId: string }) {
  const t = useT();
  const [membros, setMembros] = useState<Membro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch(`/api/v1/admin/tenants/${organizationId}/team`, { cache: "no-store" });
    if (!r.ok) {
      setErro(t("Não foi possível carregar a equipe."));
      return;
    }
    const corpo = (await r.json()) as { data: { members: Membro[] } };
    setMembros(corpo.data.members);
  }, [organizationId, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** A mensagem do servidor é a que diz o que fazer — não a substitua por uma genérica. */
  async function agir(r: Response): Promise<boolean> {
    if (r.ok) {
      await carregar();
      return true;
    }
    const corpo = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    setErro(corpo?.error?.message ?? t("A ação não pôde ser concluída."));
    return false;
  }

  async function mudarPapel(m: Membro, novo: string) {
    setOcupado(m.user_id);
    setErro(null);
    const r = await fetch(`/api/v1/admin/tenants/${organizationId}/team/${m.user_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: novo }),
    });
    await agir(r);
    setOcupado(null);
  }

  async function remover(m: Membro) {
    setOcupado(m.user_id);
    setErro(null);
    const r = await fetch(`/api/v1/admin/tenants/${organizationId}/team/${m.user_id}`, { method: "DELETE" });
    await agir(r);
    setOcupado(null);
  }

  return (
    <section className="space-y-4" data-testid="admin-equipe">
      <header>
        <h2 className="text-sm font-medium">{t("Equipe")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Quem tem acesso a esta empresa. Para dar acesso a alguém novo, use a aba Convites — a pessoa precisa aceitar.")}
        </p>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="admin-equipe-erro">
          {erro}
        </div>
      )}

      {membros === null ? (
        <p className="text-sm text-muted-foreground">{t("Carregando...")}</p>
      ) : membros.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="admin-equipe-vazia">
          {t("Esta empresa ainda não tem nenhum membro. Um convite pendente pode estar esperando aceite.")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {membros.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid={`membro-${m.email}`}>
              <span className="min-w-0 flex-1 truncate text-sm">{m.email}</span>
              <select
                className="h-9 rounded-sm border border-input bg-transparent px-2 text-sm"
                value={m.role}
                disabled={ocupado === m.user_id}
                aria-label={t("Papel de") + " " + m.email}
                data-testid={`membro-papel-${m.email}`}
                onChange={(e) => void mudarPapel(m, e.target.value)}
              >
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                className="h-9"
                disabled={ocupado === m.user_id}
                data-testid={`membro-remover-${m.email}`}
                onClick={() => void remover(m)}
              >
                {t("Remover")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
