// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { applyReactivityEvent, createSupabaseReactivityClient } from "@/lib/followup/reactivity";

vi.mock("@/lib/channels/contato-por-telefone", () => ({
  idsDoContatoEGemeos: vi.fn(async (_db: unknown, _org: string, contact: string) => [contact]),
}));

type Row = Record<string, unknown>;
type TableName = "contacts" | "followup_enrollments" | "followup_flow_pointers" | "followup_enrollment_events";
const ORG = "org-a", CONTACT = "contact-a";
const NOW = new Date("2026-09-09T12:00:00Z");

// Exercita o adapter de produção: seus filtros decidem quais linhas o dublê
// entrega e altera. Nenhum LIVE_STATUSES é importado/copied para a fixture.
function fixture(policy: "pause" | "cancel" | "allow", blocked = false) {
  const enrollment = { id: "enrollment-a", organization_id: ORG, contact_id: CONTACT,
    pointer_id: "pointer-a", status: "paused_manual", current_node_id: "w1", steps_taken: 0,
    next_eval_at: null, claimed_until: null };
  const tables: Record<TableName, Row[]> = {
    contacts: [{ id: CONTACT, organization_id: ORG, is_blocked: blocked }],
    followup_enrollments: [enrollment],
    followup_flow_pointers: [{ id: "pointer-a", organization_id: ORG, handoff_policy: policy,
      trigger_config: { kind: "manual", cancel_on_reply: true } }],
    followup_enrollment_events: [],
  };
  const isFixtureTable = (table: string): table is TableName => Object.prototype.hasOwnProperty.call(tables, table);
  const admin = { from(table: string) {
    if (!isFixtureTable(table)) throw new Error(`Tabela não prevista na fixture: ${table}`);
    const rows = tables[table];
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined;
    const selected = () => rows.filter((row) => filters.every((filter) => filter(row)));
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
      update(value: Row) { patch = value; return query; },
      async maybeSingle() { return { data: selected()[0] ?? null, error: null }; },
      async insert(row: Row) {
        if (rows.some((old) => old.idempotency_key === row.idempotency_key)) return { error: { code: "23505" } };
        rows.push(row); return { error: null };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        const data = selected();
        if (patch) data.forEach((row) => Object.assign(row, patch));
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { db: createSupabaseReactivityClient(admin), enrollment, tables };
}

function event(event_type = "message.received", organization_id = ORG): EventRow {
  return { id: `${event_type}:${organization_id}`, organization_id, event_type,
    entity_kind: "contact", entity_id: CONTACT,
    payload: { contact_id: CONTACT, conversation_id: "conversation-a" },
    metadata: {}, consumed_by: [], attempts: 0 };
}

describe("pausa manual pelo adapter de reatividade", () => {
  it("STOP encerra paused_manual pelo adapter e replay não duplica o evento", async () => {
    const { db, enrollment, tables } = fixture("pause", true);
    const row = event();
    expect(await applyReactivityEvent(db, () => NOW, row)).toEqual({ matched: true, reacted: 1 });
    expect(enrollment).toMatchObject({ status: "cancelled", outcome: "opted_out",
      cancel_reason: "stop_keyword", next_eval_at: null, claimed_until: null, completed_at: NOW.toISOString() });
    expect(await applyReactivityEvent(db, () => NOW, row)).toEqual({ matched: true, reacted: 0 });
    expect(tables.followup_enrollment_events).toHaveLength(1);
    expect(tables.followup_enrollment_events[0]).toMatchObject({ organization_id: ORG, enrollment_id: enrollment.id, event_type: "reactivity_opted_out" });
  });

  it.each(["pause", "cancel", "allow"] as const)("handoff %s e inbound comum preservam a pausa manual", async (policy) => {
    const { db, enrollment, tables } = fixture(policy);
    const before = { ...enrollment };
    for (const type of ["message.received", "ai.handoff_triggered", "ai.handoff_resolved"]) {
      expect(await applyReactivityEvent(db, () => NOW, event(type))).toEqual({ matched: true, reacted: 0 });
      expect(enrollment).toEqual(before);
    }
    expect(tables.followup_enrollment_events).toHaveLength(0);
  });

  it("o adapter recusa alterar contato e enrollment de outra organização", async () => {
    const { db, enrollment, tables } = fixture("pause", true);
    expect(await applyReactivityEvent(db, () => NOW, event("message.received", "org-b"))).toEqual({ matched: true, reacted: 0 });
    expect(enrollment.status).toBe("paused_manual");
    expect(tables.followup_enrollment_events).toHaveLength(0);
    // Controle: a mesma fixture reage quando a origem correta chega.
    expect((await applyReactivityEvent(db, () => NOW, event())).reacted).toBe(1);
  });
});
