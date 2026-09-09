import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { CompaniesClient } from "./_client";

export const dynamic = "force-dynamic";

/** A página só decide a cortesia visual; a API continua sendo a autoridade. */
export default async function CompaniesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;

  return <CompaniesClient podeEditar={podeEditar} />;
}
