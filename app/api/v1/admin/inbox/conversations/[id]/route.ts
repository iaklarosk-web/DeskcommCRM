import { type NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// GET /api/v1/admin/inbox/conversations/[id]
// ---------------------------------------------------------------------------

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

  // Load conversation (cross-tenant — no org filter, intentional)
  const { data: conversation, error: convError } = await admin
    .from("conversations")
    .select(`
      id,
      organization_id,
      contact_id,
      channel,
      status,
      assigned_to_user_id,
      last_inbound_at,
      last_message_at,
      last_message_preview,
      unread_count_for_assignee,
      created_at,
      updated_at
    `)
    .eq("id", id)
    .maybeSingle();

  if (convError) {
    return fail("internal_error", "Query failed", 500, { requestId, details: convError.message });
  }
  if (!conversation) {
    return fail("not_found", "Conversation not found", 404, { requestId });
  }

  // Load organization
  const { data: organization } = await admin
    .from("organizations")
    .select("id, display_name, slug, status")
    .eq("id", conversation.organization_id)
    .maybeSingle();

  // Load contact
  const { data: contact } = conversation.contact_id
    ? await admin
        .from("contacts")
        .select("id, name, phone_number, email, is_anonymized, is_blocked")
        .eq("id", conversation.contact_id)
        .maybeSingle()
    : { data: null };

  // Load last 50 messages (desc — client reverses for display)
  const { data: messages, error: msgError } = await admin
    .from("messages")
    .select(`
      id,
      conversation_id,
      organization_id,
      direction,
      type,
      status,
      body,
      media_url,
      media_mime,
      sent_via,
      sent_at,
      read_at,
      delivered_at,
      error_code,
      error_message,
      ack,
      sent_by_user_id,
      created_at
    `)
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (msgError) {
    return fail("internal_error", "Messages query failed", 500, {
      requestId,
      details: msgError.message,
    });
  }

  // Audit — tenant_id only, no PII
  void audit({
    action: "platform_admin.conversation_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    organizationId: conversation.organization_id,
    resourceType: "conversation",
    resourceId: id,
    metadata: { tenant_id: conversation.organization_id },
  });

  return ok(
    {
      conversation,
      organization: organization ?? null,
      contact: contact ?? null,
      messages: messages ?? [],
    },
    { requestId },
  );
}
