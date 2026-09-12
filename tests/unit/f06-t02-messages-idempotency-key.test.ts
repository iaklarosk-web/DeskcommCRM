/**
 * F06-T02 — `POST /api/v1/messages` honra `Idempotency-Key` (VARREDURA §B10).
 *
 * O defeito, medido no trace do gate f05-gate-06: o `apiClient` repete o POST
 * após 10 s sem resposta, o handler herdado não lia a chave, e a repetição
 * gravava uma SEGUNDA mensagem — enviada duas vezes ao cliente.
 *
 * A prova reproduz o cenário no ponto exato: a segunda chamada chega quando a
 * primeira já gravou a linha (`queued`, envio em voo). Com a chave, a segunda
 * devolve a MESMA linha e o canal não é chamado de novo: `posts=2 messages=1
 * channel_calls=1`. Sem a chave (guarda de vacuidade), o comportamento herdado
 * continua: duas linhas — que é o que prova que a régua mede o conserto, não o
 * dublê.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { chaveDeIdempotencia, idDaMensagemIdempotente, uuidDeterministico } from "@/lib/api/idempotency";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: vi.fn() }) } }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const OUTRO_USER = "66666666-6666-4666-8666-666666666666";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Row = Record<string, unknown>;

function conversationRow(): Row {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    contacts: { phone_number: "+5519999990000", wa_identity: null, is_blocked: false },
    channel_sessions: { provider: "waha", waha_session_name: "default", status: "WORKING" },
  };
}

/** Tabela em memória com a chave primária de verdade: id repetido é 23505. */
function makeSupabase() {
  const messages: Row[] = [];
  const filtrar = (filtros: Array<(r: Row) => boolean>) => messages.filter((r) => filtros.every((f) => f(r)));
  const from = (table: string) => {
    if (table === "conversations") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conversationRow(), error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (table === "contacts") {
      const cadeia: Record<string, unknown> = {
        eq: () => cadeia,
        then: (resolve: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return { update: () => cadeia } as never;
    }
    if (table !== "messages") throw new Error(`fake: tabela inesperada '${table}'`);
    return {
      insert: (row: Row) => {
        const id = (row.id as string | undefined) ?? `msg-${messages.length + 1}`;
        if (messages.some((m) => m.id === id)) {
          return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "messages_pkey" } }) }) };
        }
        const nova: Row = { external_id: null, ack: null, error_code: null, error_message: null, ...row, id };
        messages.push(nova);
        return { select: () => ({ single: async () => ({ data: { ...nova }, error: null }) }) };
      },
      select: () => {
        const filtros: Array<(r: Row) => boolean> = [];
        const q = {
          eq(col: string, val: unknown) {
            filtros.push((r) => r[col] === val);
            return q;
          },
          single: async () => {
            const alvo = filtrar(filtros)[0];
            return alvo ? { data: { ...alvo }, error: null } : { data: null, error: { message: "not found" } };
          },
        };
        return q;
      },
      update: (patch: Row) => {
        const filtros: Array<(r: Row) => boolean> = [];
        const q = {
          eq(col: string, val: unknown) {
            filtros.push((r) => r[col] === val);
            return q;
          },
          select: () => ({
            maybeSingle: async () => {
              const alvos = filtrar(filtros);
              alvos.forEach((r) => Object.assign(r, patch));
              return { data: alvos[0] ? { ...alvos[0] } : null, error: null };
            },
            single: async () => {
              const alvos = filtrar(filtros);
              alvos.forEach((r) => Object.assign(r, patch));
              return { data: alvos[0] ? { ...alvos[0] } : null, error: null };
            },
          }),
        };
        return q;
      },
      delete: () => {
        const filtros: Array<(r: Row) => boolean> = [];
        const q = {
          eq(col: string, val: unknown) {
            filtros.push((r) => r[col] === val);
            return q;
          },
          neq(col: string, val: unknown) {
            filtros.push((r) => r[col] !== val);
            return q;
          },
          in(col: string, vals: unknown[]) {
            filtros.push((r) => vals.includes(r[col]));
            return q;
          },
          then(resolve: (v: { error: null }) => unknown) {
            for (const alvo of filtrar(filtros)) messages.splice(messages.indexOf(alvo), 1);
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return q;
      },
    };
  };
  const client = { from, rpc: async () => ({ error: null }) };
  return { supabase: client as unknown as SupabaseClient, messages };
}

const input = { conversation_id: CONV, type: "text", body: "oi" } as SendMessageInput;

function canalRespondendo(): ReturnType<typeof vi.fn> {
  vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
  vi.stubEnv("WAHA_API_KEY", "hash123");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: { id: "3EB0ABCDEF0123456789" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("F06-T02 §B10 — Idempotency-Key no POST /api/v1/messages", () => {
  it("dois POSTs com a mesma chave → uma mensagem, uma chamada ao canal", async () => {
    // Arrange
    const fetchMock = canalRespondendo();
    const { supabase, messages } = makeSupabase();
    const chave = chaveDeIdempotencia(new Headers({ "Idempotency-Key": "  abc-123  " }));
    expect(chave).toBe("abc-123");
    const ctx: HandlerCtx = {
      organization_id: ORG,
      actor: { type: "user", id: USER },
      requestId: "req-1",
      internalMessageId: idDaMensagemIdempotente(ORG, USER, chave!),
      idempotentReplay: true,
    };

    // Act — a repetição chega com a primeira já gravada (é o cenário do trace)
    const primeira = await sendMessageHandler(supabase, ctx, input);
    const chamadasDoPrimeiroEnvio = fetchMock.mock.calls.length;
    const segunda = await sendMessageHandler(supabase, { ...ctx, requestId: "req-1-retry" }, input);

    // Assert — o adapter faz mais de uma ida ao canal por envio; o que importa
    // é que a repetição não faz NENHUMA.
    expect(messages, "posts=2 messages=1").toHaveLength(1);
    expect(segunda.id).toBe(primeira.id);
    expect(chamadasDoPrimeiroEnvio).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length, "channel_sends=1/2").toBe(chamadasDoPrimeiroEnvio);
  });

  it("guarda de vacuidade: sem a chave, dois POSTs continuam gravando duas linhas (o defeito herdado)", async () => {
    // Arrange
    const fetchMock = canalRespondendo();
    const { supabase, messages } = makeSupabase();
    const ctx: HandlerCtx = { organization_id: ORG, actor: { type: "user", id: USER }, requestId: "req-2" };

    // Act
    await sendMessageHandler(supabase, ctx, input);
    const chamadasDoPrimeiroEnvio = fetchMock.mock.calls.length;
    await sendMessageHandler(supabase, ctx, input);

    // Assert
    expect(messages).toHaveLength(2);
    expect(fetchMock.mock.calls.length).toBe(chamadasDoPrimeiroEnvio * 2);
    expect(chaveDeIdempotencia(new Headers())).toBeNull();
    expect(chaveDeIdempotencia(new Headers({ "Idempotency-Key": "x".repeat(201) }))).toBeNull();
  });

  it("a mesma chave em outro tenant ou outro atendente é outro id — ninguém recebe a mensagem de ninguém", () => {
    // Arrange / Act
    const a = idDaMensagemIdempotente(ORG, USER, "k");
    const outroUsuario = idDaMensagemIdempotente(ORG, OUTRO_USER, "k");
    const outroTenant = idDaMensagemIdempotente("77777777-7777-4777-8777-777777777777", USER, "k");

    // Assert
    expect(a).toMatch(UUID);
    expect(a).toBe(idDaMensagemIdempotente(ORG, USER, "k"));
    expect(new Set([a, outroUsuario, outroTenant]).size).toBe(3);
    expect(uuidDeterministico("a", "bc")).not.toBe(uuidDeterministico("ab", "c"));
  });
});
