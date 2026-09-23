"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";
import { ROLE_RANK } from "@/lib/auth/types";

type Member = { user_id: string; full_name: string | null };

/** Nomes atuais autorizados; autores ausentes continuam identificados na API. */
export function useCrmAuthorNames(): Record<string, string> {
  const { user, activeOrg } = useAuth();
  const enabled = Boolean(
    activeOrg &&
    !user.support &&
    !user.is_platform_admin &&
    ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent,
  );
  const query = useQuery({
    queryKey: ["crm", "author-names", activeOrg?.orgId, user.id],
    enabled,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: Member[] }>("/api/v1/team/assignable", { signal }),
    staleTime: 60_000,
    retry: false,
  });
  const names: Record<string, string> = {};
  // Uma query desabilitada ainda pode ter cache: não o exiba sem acesso atual.
  if (enabled && !query.isError) {
    for (const member of query.data?.data ?? []) {
      if (typeof member.full_name === "string" && member.full_name.trim()) {
        names[member.user_id] = member.full_name.trim();
      }
    }
  }
  if (typeof user.full_name === "string" && user.full_name.trim()) {
    names[user.id] = user.full_name.trim();
  }
  return names;
}
