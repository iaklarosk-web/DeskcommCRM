import { EquipeDoTenantClient } from "./_client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EquipeDoTenantPage({ params }: Props) {
  const { id } = await params;
  return <EquipeDoTenantClient organizationId={id} />;
}
