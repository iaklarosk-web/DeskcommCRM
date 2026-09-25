import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  send: vi.fn(),
  audit: vi.fn(),
  emitir: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3013" } }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.send }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "Local", cor: "#000000" }) }));
vi.mock("@/lib/email/templates/invite", () => ({ buildInviteEmail: () => ({ subject: "Convite", html: "Convite", text: "Convite" }) }));
/**
 * F20 (ADR-045 §2): o convite virou LINHA. `issueInvite` deixou de assinar um
 * token auto-contido e passou a gravar em `team_invites` — então a emissão é
 * dublada aqui, e o ciclo de vida de verdade (revogar, aceitar, expirar) é
 * medido contra o banco em `tests/integration/f20-convites-de-equipe.test.ts`.
 * O que continua sendo desta unit: e-mail que falha NÃO tira o link do
 * operador, e o token nunca entra na auditoria.
 */
vi.mock("@/src/convites/repositorio", () => ({ emitirConvite: h.emitir }));
import { issueInvite } from "./issue-invite";
const input = { email: "guest@example.test", role: "admin" as const,
  organizationId: "a2180000-0000-4000-8000-000000000001", orgName: "Org",
  inviterId: "a2180000-0000-4000-8000-000000000002", inviterName: "Admin", requestId: "test" };
const TOKEN = "aBcD1234_-efGhIj";
const VENCE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  vi.resetAllMocks();
  h.emitir.mockResolvedValue({
    convite: { id: "c0000000-0000-4000-8000-000000000001", token: TOKEN, email: input.email, role: "admin", invited_by: input.inviterId, expires_at: VENCE, created_at: new Date().toISOString() },
    link: `http://localhost:3013/i/${TOKEN}`,
    revogados: 0,
  });
});

it("sem serviço de e-mail continua com link curto, validade e auditoria sem o token", async () => {
  h.send.mockResolvedValue({ ok: false, error: "not_configured" });
  const result = await issueInvite(input);
  expect(result.email_dispatched).toBe(false);
  expect(result.accept_url).toBe(`http://localhost:3013/i/${TOKEN}`);
  expect(result.accept_url.length, "o link do convite tem de caber onde o de 559 chars não cabia").toBeLessThanOrEqual(64);
  expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now());
  // O token é credencial: pode ir no e-mail e na tela de quem convida, nunca no log.
  expect(JSON.stringify(h.audit.mock.calls)).not.toContain(TOKEN);
});

it("falha lançada pelo envio continua com recuperação visível", async () => {
  h.send.mockRejectedValue(new Error("network failure"));
  const result = await issueInvite(input);
  expect(result.email_dispatched).toBe(false);
  expect(result.accept_url).toContain("/i/");
});

it("repetição idempotente reaproveita o convite vivo e não reenvia e-mail nem audita", async () => {
  const args = { ...input, dispatch: false };
  const primeiro = await issueInvite(args);
  const segundo = await issueInvite(args);
  expect(primeiro).toEqual(segundo);
  // `dispatch: false` é a repetição da criação de tenant: ela NÃO pode revogar
  // o link que a pessoa já recebeu (ADR-045 §2).
  expect(h.emitir).toHaveBeenCalledWith(expect.objectContaining({ reaproveitar_vivo: true }));
  expect(h.send).not.toHaveBeenCalled();
  expect(h.audit).not.toHaveBeenCalled();
});
