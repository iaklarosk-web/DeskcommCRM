import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { OrderDetailClient } from "./_client";
export const dynamic = "force-dynamic";
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const podeEditar =
    !user.support && !user.is_platform_admin && ROLE_RANK[org.role] >= ROLE_RANK.agent;
  const { id } = await params;
  return <OrderDetailClient key={id} orderId={id} podeEditar={podeEditar} />;
}
