/**
 * G3-01 — claim/transfer/release com evento auditável (spec 13 §3.1, spec 04 §9).
 *
 * Prova, contra os Route Handlers REAIS (auth e Supabase mockados):
 *  - claim com dono inesperado → 409 state_conflict, NENHUM movimento e NENHUM
 *    audit de claim;
 *  - claim livre → 200 e o movimento `assumir` pela máquina de estados;
 *  - release: rpc com reason='release', expected = caller;
 *  - transfer: imediata (G1-06d), Zod valida to_user_id, destino viewer/não-membro
 *    → 422, audita conversation.transferred com motivo em metadata.
 *
 * ─── O QUE MUDOU EM F03-T09, E POR QUE AS ASSERÇÕES MUDARAM JUNTO ───────────
 *
 * Antes, claim e transfer chamavam `fn_conversation_assign` DIRETO, e este
 * arquivo espiava a chamada pelo dublê de `supabase.rpc`. Desde F03-T09 quem
 * move a conversa é `transition()` (§5.6, ADR-016) — que continua chamando a
 * MESMA RPC, pelo efeito de atribuição, mas por dentro de uma transação própria
 * sobre o pool de service-role, longe do client do request.
 *
 * Então o que este arquivo pode observar da BORDA mudou de lugar: a asserção
 * "a rota pediu atribuição com reason=claim" virou "a rota pediu o movimento
 * `assumir` à autoridade de evento". O invariante não foi enfraquecido — ele
 * subiu uma camada, e a ponta de baixo (evento -> RPC herdada) é provada pelos
 * testes de `src/conversation` e pela jornada `tests/e2e/f03-inbox.spec.ts`.
 * Toda expectativa de COMPORTAMENTO (409, 422, 404, audit com motivo) continua
 * exatamente como estava.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { moverPeloInbox } from "@/lib/inbox/acoes-d16";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: vi.fn(() => false),
}));
/**
 * A autoridade de evento é DUBLADA aqui de propósito: ela abre transação no
 * Postgres, e este arquivo é um teste de BORDA HTTP — subir banco para provar
 * que a rota devolve 422 sem `to_user_id` seria trocar o que ele mede.
 * `ctxDoInbox` e `erroDeApiDaTransicao` são reproduzidos com a forma real para
 * que a rota continue exercitando o caminho inteiro dela.
 */
vi.mock("@/lib/inbox/acoes-d16", () => ({
  ctxDoInbox: (organization_id: string, user_id: string, role?: string) => ({
    organization_id,
    user_id,
    role,
    source: "session" as const,
  }),
  moverPeloInbox: vi.fn(async () => ({ from: "waiting_human", to: "human_handling" })),
  erroDeApiDaTransicao: () => null,
}));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface StubState {
  /**
   * A linha de `conversations` que o client do request enxerga — é ela que a
   * rota lê ANTES (lock otimista) e DEPOIS (corpo da resposta) do movimento.
   * `null` = conversa fora do tenant ou inexistente.
   */
  conversation: Record<string, unknown> | null;
  assignRows: Array<Record<string, unknown>>;
  rpcCalls: RpcCall[];
  targetMember: { role: string } | null;
}

const CONV_ROW = {
  id: CONV_ID,
  organization_id: ORG_ID,
  status: "claimed",
  assigned_to_user_id: AGENT_ID,
};

function makeSupabaseStub(state: StubState) {
  const leitura = {
    select: () => leitura,
    eq: () => leitura,
    maybeSingle: async () => ({ data: state.conversation, error: null }),
  };
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "fn_conversation_assign") return { data: state.assignRows, error: null };
      return { data: null, error: null };
    },
    from: () => leitura,
  };
}

function makeAdminStub(state: StubState) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: () => Promise.resolve({ data: state.targetMember, error: null }),
  };
  return { from: () => chain };
}

function agentSession(state: StubState) {
  const user: AuthUser = {
    id: AGENT_ID,
    email: "agent@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "agent" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, name: "Org", role: "agent" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(makeSupabaseStub(state) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createAdminClient).mockReturnValue(makeAdminStub(state) as any);
}

function stubState(overrides: Partial<StubState> = {}): StubState {
  return {
    conversation: { ...CONV_ROW, assigned_to_user_id: null },
    assignRows: [CONV_ROW],
    rpcCalls: [],
    targetMember: { role: "agent" },
    ...overrides,
  };
}

/** O movimento que a rota pediu à autoridade de evento, se pediu algum. */
function movimento(indice = 0) {
  return vi.mocked(moverPeloInbox).mock.calls[indice];
}

function postReq(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONV_ID}/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: CONV_ID }) };

function assignCall(state: StubState): RpcCall | undefined {
  return state.rpcCalls.find((c) => c.fn === "fn_conversation_assign");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isServiceRoleConfigured).mockReturnValue(false);
});

describe("POST /claim — idempotência do claim atômico", () => {
  it("claim duplicado (outro dono já assumiu) → 409 state_conflict, sem audit e sem movimento", async () => {
    // O lock otimista é a PORTA: a conversa já tem dono e o corpo não o esperava.
    const state = stubState({
      conversation: { ...CONV_ROW, assigned_to_user_id: TARGET_ID },
    });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/claim/route");
    const res = await POST(postReq("claim", {}), params);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("state_conflict");
    expect(vi.mocked(audit).mock.calls.some(([e]) => e.action === "conversation.claimed")).toBe(
      false,
    );
    // Recusar depois de mover seria pior que não recusar: o dono já teria trocado.
    expect(vi.mocked(moverPeloInbox)).not.toHaveBeenCalled();
  });

  it("claim livre → 200 e o movimento `assumir` pela máquina de estados", async () => {
    const state = stubState();
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/claim/route");
    const res = await POST(postReq("claim", { expected_assignee: null }), params);
    expect(res.status).toBe(200);
    expect(movimento()?.[1]).toBe(CONV_ID);
    expect(movimento()?.[2]).toBe("assumir");
    expect(movimento()?.[3]).toMatchObject({ kind: "attendant", userId: AGENT_ID });
    expect(movimento()?.[0]).toMatchObject({ organization_id: ORG_ID, user_id: AGENT_ID });
    // A rota não fala mais com a RPC de atribuição: quem fala é `transition()`.
    expect(assignCall(state)).toBeUndefined();
  });

  it("conversa fora do tenant → 404 antes de qualquer movimento", async () => {
    const state = stubState({ conversation: null });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/claim/route");
    const res = await POST(postReq("claim", {}), params);
    expect(res.status).toBe(404);
    expect(vi.mocked(moverPeloInbox)).not.toHaveBeenCalled();
  });
});

describe("POST /release — solta com evento na mesma transação", () => {
  it("release → rpc com reason='release' e expected = caller", async () => {
    const state = stubState({
      assignRows: [{ ...CONV_ROW, status: "open", assigned_to_user_id: null }],
    });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/release/route");
    const res = await POST(postReq("release", {}), params);
    expect(res.status).toBe(200);
    expect(assignCall(state)?.args).toMatchObject({
      p_to_user_id: null,
      p_reason: "release",
      p_expected_assignee: AGENT_ID,
      p_enforce_expected: true,
    });
  });
});

describe("POST /transfer — reatribuição imediata (G1-06d)", () => {
  it("body sem to_user_id → 422, nenhum movimento", async () => {
    const state = stubState();
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/transfer/route");
    const res = await POST(postReq("transfer", {}), params);
    expect(res.status).toBe(422);
    expect(vi.mocked(moverPeloInbox)).not.toHaveBeenCalled();
    expect(assignCall(state)).toBeUndefined();
  });

  it("transfer ok → 200, movimento `transferir` com o destino, audit com motivo", async () => {
    const state = stubState({
      conversation: { ...CONV_ROW, assigned_to_user_id: TARGET_ID },
    });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/transfer/route");
    const res = await POST(
      postReq("transfer", { to_user_id: TARGET_ID, reason: "cliente pediu o financeiro" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(movimento()?.[1]).toBe(CONV_ID);
    expect(movimento()?.[2]).toBe("transferir");
    // Imediata (G1-06d): o destino é o do corpo, sem expectativa de dono atual.
    expect(movimento()?.[3]).toMatchObject({
      kind: "attendant",
      userId: AGENT_ID,
      targetUserId: TARGET_ID,
    });
    expect(assignCall(state)).toBeUndefined();
    const entry = vi
      .mocked(audit)
      .mock.calls.map(([e]) => e)
      .find((e) => e.action === "conversation.transferred");
    expect(entry).toMatchObject({
      actorUserId: AGENT_ID,
      organizationId: ORG_ID,
      resourceId: CONV_ID,
      metadata: { to_user_id: TARGET_ID, note: "cliente pediu o financeiro" },
    });
  });

  it("destino viewer → 422 unprocessable_entity, nenhum movimento", async () => {
    vi.mocked(isServiceRoleConfigured).mockReturnValue(true);
    const state = stubState({ targetMember: { role: "viewer" } });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/transfer/route");
    const res = await POST(postReq("transfer", { to_user_id: TARGET_ID }), params);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unprocessable_entity");
    expect(vi.mocked(moverPeloInbox)).not.toHaveBeenCalled();
    expect(assignCall(state)).toBeUndefined();
  });

  it("conversa inexistente → 404 not_found", async () => {
    const state = stubState({ conversation: null });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/transfer/route");
    const res = await POST(postReq("transfer", { to_user_id: TARGET_ID }), params);
    expect(res.status).toBe(404);
  });
});

// Este teste isola o handler; autoridade de suporte é exercitada na suíte própria.
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/impersonate/support")>(),
  requireSupportWrite: vi.fn(async () => null),
  authenticatedSessionId: vi.fn(async () => "f2200000-0000-4000-8000-000000000099"),
}));
