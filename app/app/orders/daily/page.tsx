import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { DailyOrdersClient } from "./_client";

export const dynamic = "force-dynamic";
export default async function DailyOrdersPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if ((user.is_platform_admin && !user.support) || ROLE_RANK[org.role] < ROLE_RANK.viewer)
    redirect("/403");
  return <DailyOrdersClient />;
}
