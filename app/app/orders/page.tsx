import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { OrdersClient } from "./_client";
import { initialOrderContact } from "./_initial-contact";
export const dynamic = "force-dynamic";
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const podeEditar =
    !user.support &&
    !user.is_platform_admin &&
    ROLE_RANK[org.role] >= ROLE_RANK.agent;
  const contactId = initialOrderContact(await searchParams);
  return (
    <OrdersClient
      key={contactId}
      podeEditar={podeEditar}
      initialContactId={contactId}
      startCreating={Boolean(contactId)}
    />
  );
}
