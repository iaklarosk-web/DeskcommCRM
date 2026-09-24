import { listarPlanos } from "@/src/billing/planos";

import { NewTenantForm } from "./_form";

export const metadata = { title: "Novo Tenant — Admin Plataforma" };

/**
 * Os planos vêm do BANCO, não de rótulos fixos. Até 24/09/2026 o menu oferecia
 * `PLAN_A (placeholder)` enquanto a produção já tinha Essencial/Profissional/
 * Empresarial com preço real e Stripe LIVE (D58) — quem criasse um cliente
 * pagante escolhia de uma lista que mentia o nome do que estava vendendo.
 */
export default async function NewTenantPage() {
  const planos = await listarPlanos();
  return (
    <NewTenantForm
      planos={planos.map((p) => ({
        code: p.code,
        name: p.name,
        price_cents: p.price_cents,
        currency: p.currency,
        source: p.source,
      }))}
    />
  );
}
