import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { provisionarAssinatura } from "@/lib/auth/assinatura-provisionada";

/** Normaliza o nome da empresa para um slug candidato (citext unique no DB). */
function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "org";
}

type ProvisionUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

/**
 * De onde veio o provisionamento. A organização nasce igual nos dois casos — o
 * que muda é a linha de auditoria, e ela precisa distinguir "primeiro acesso
 * normal" de "primeiro acesso que precisou ser recuperado": a segunda é um
 * sintoma de que o caminho do signup falhou, e some no meio da primeira.
 */
type ProvisionOptions = {
  source?: "signup" | "recovery";
};

/**
 * Provisiona o tenant de um usuário recém-confirmado via signup self-service:
 * cria a organização (status `active`, `onboarded_at` null → cai no onboarding)
 * e a membership `admin` do usuário.
 *
 * Idempotente: se o usuário já tem membership ativa (link de confirmação
 * clicado duas vezes, ou usuário que entrou antes por convite), não faz nada.
 *
 * Service role é intencional aqui — o usuário ainda não pertence a nenhuma org,
 * então RLS bloquearia os INSERTs. A fonte confiável é o JWT já validado por
 * `verifyOtp` no caller (nunca o body).
 */
export async function ensureTenantForUser(
  user: ProvisionUser,
  options: ProvisionOptions = {},
): Promise<{ provisioned: boolean; organizationId?: string }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) return { provisioned: false, organizationId: existing.organization_id };

  const orgName =
    (user.user_metadata?.org_name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Minha empresa";
  const base = slugify(orgName);

  // ponytail: check-then-insert tem janela de corrida se o mesmo link for
  // confirmado 2x em paralelo (pior caso: org duplicada órfã). Advisory lock
  // por user_id se isso aparecer na prática.
  let org: { id: string; slug: string } | null = null;
  for (let attempt = 0; attempt < 3 && !org; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin
      .from("organizations")
      .insert({
        slug,
        display_name: orgName,
        legal_name: orgName,
        status: "active",
        created_by: user.id,
      })
      .select("id, slug")
      .single();
    if (data) {
      org = data;
    } else if (error && error.code !== "23505") {
      throw new Error(`signup provisioning: org insert failed: ${error.message}`);
    }
  }
  if (!org) throw new Error("signup provisioning: slug exhausted after 3 attempts");

  const { error: memberError } = await admin.from("user_organizations").insert({
    user_id: user.id,
    organization_id: org.id,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });
  if (memberError && memberError.code !== "23505") {
    throw new Error(`signup provisioning: membership insert failed: ${memberError.message}`);
  }

  // F11-T04 (D38, ADR-030 §3): a organização do cadastro nasce ESPERANDO
  // pagamento — `pending_payment`, origem `self_service`, no plano default
  // declarado. É o que faz "/app" cair em "/app/billing" até o webhook do
  // gateway confirmar. Se a assinatura não puder ser gravada, a organização
  // não sobrevive ao fluxo (compensação): organização sem assinatura seria
  // exatamente o "acesso operacional gratuito por falha no fluxo" que §7.9
  // proíbe — e a falha é relançada, nunca engolida.
  try {
    await provisionarAssinatura(org.id, { origin: "self_service", status: "pending_payment" });
  } catch (erro) {
    await admin.from("organizations").delete().eq("id", org.id);
    void audit({
      action: "tenant.created_by_signup",
      actorUserId: user.id,
      organizationId: org.id,
      resourceType: "organization",
      resourceId: org.id,
      bypassedRls: true,
      metadata: { slug: org.slug, outcome: "rolled_back", reason: "subscription_insert_failed" },
    });
    throw new Error(
      `signup provisioning: subscription insert failed, organization removed: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  void audit({
    action:
      options.source === "recovery" ? "tenant.created_by_recovery" : "tenant.created_by_signup",
    actorUserId: user.id,
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    bypassedRls: true,
    metadata: { slug: org.slug },
  });

  return { provisioned: true, organizationId: org.id };
}
