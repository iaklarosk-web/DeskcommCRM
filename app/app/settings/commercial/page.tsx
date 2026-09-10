import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { CommercialSettingsClient } from "./_client";

export const dynamic = "force-dynamic";

/** Leitura viewer+; resolveActiveOrg verifica suporte ativo e o escopo acompanhado. */
export default async function CommercialSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if ((user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] < ROLE_RANK.viewer)
    redirect("/403");
  return <CommercialSettingsClient />;
}
