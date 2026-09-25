import { ConvitesDoTenantClient } from "./_client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ConvitesDoTenantPage({ params }: Props) {
  const { id } = await params;
  return <ConvitesDoTenantClient organizationId={id} />;
}
