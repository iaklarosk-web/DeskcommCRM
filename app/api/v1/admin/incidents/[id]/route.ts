/**
 * GET /api/v1/admin/incidents/[id] (S-11.11)
 *
 * Returns incident detail + tenant info + audit trail.
 * Requires platform admin.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  // F20-T03: a guarda distingue NEGAÇÃO (403) de INDISPONIBILIDADE (503).
  // O `catch` genérico que existia aqui respondia "sem permissão" quando o
  // banco estava fora — foi o que fez o dono achar que tinha perdido o
  // acesso no incidente de 21–22/09 (VARREDURA §B25/§B29).
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  const adminCtx = guarda;

  const admin = createAdminClient();

  const { data: incident, error } = await admin
    .from("incidents")
    .select(
      `*, organizations!incidents_organization_id_fkey(id, display_name, slug, status)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !incident) {
    return fail("not_found", "Incident not found", 404, { requestId });
  }

  // Fetch audit trail for this incident via metadata
  const { data: auditTrail } = await admin
    .from("api_audit_log")
    .select(
      "id, action, actor_user_id, created_at, metadata, request_id",
    )
    .contains("metadata", { incident_id: id })
    .order("created_at", { ascending: false })
    .limit(50);

  const org = Array.isArray(incident.organizations)
    ? incident.organizations[0]
    : incident.organizations;

  const shaped = {
    ...incident,
    organizations: undefined,
    tenant: org ?? null,
    audit_trail: auditTrail ?? [],
  };

  void audit({
    action: "platform_admin.incident_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    resourceType: "incident",
    resourceId: id,
    requestId,
    bypassedRls: true,
    metadata: { incident_id: id },
  });

  // `ok()` já embrulha em `{ data }`. Passar `{ data: shaped }` gerava
  // `{ data: { data: shaped } }`, e a tela de detalhe lia `body.data` esperando
  // o incidente: `created_at` vinha undefined e `formatDistanceToNow(new
  // Date(undefined))` derrubava a página no error boundary, sempre.
  return ok(shaped, { requestId });
}
