import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { definicoesDa } from "@/src/crm/campos";

import { CompaniesClient } from "./_client";

export const dynamic = "force-dynamic";

/** A página só decide a cortesia visual; a API continua sendo a autoridade. */
export default async function CompaniesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;
  // F13-T01: as definições de campo da organização (crm.fields.companies), no
  // servidor — o formulário não faz ida extra à rota.
  const definicoes = await definicoesDa({ organization_id: activeOrg.orgId, source: "session", user_id: user.id }, "companies");

  return <CompaniesClient podeEditar={podeEditar} definicoes={definicoes} />;
}
