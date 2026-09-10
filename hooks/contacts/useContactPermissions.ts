"use client";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { ROLE_RANK, type ActiveOrg, type AuthUser } from "@/lib/auth/types";

/** Apresentação das permissões legadas; cada API continua sendo a autoridade. */
export function contactPermissions(
  user: AuthUser,
  activeOrg: ActiveOrg | null,
) {
  const writableSession =
    !user.support ||
    (user.support.status === "active" && user.support.access_mode === "full");
  const rank = activeOrg ? ROLE_RANK[activeOrg.role] : 0;
  return {
    canWrite: writableSession && rank >= ROLE_RANK.agent,
    canMerge: writableSession && rank >= ROLE_RANK.manager,
    canAnonymize:
      writableSession &&
      (rank >= ROLE_RANK.admin || (user.is_platform_admin && !user.support)),
  };
}

export function useContactPermissions() {
  const { user, activeOrg } = useAuth();
  return contactPermissions(user, activeOrg);
}
