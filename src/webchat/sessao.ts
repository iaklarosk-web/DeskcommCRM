/**
 * A sessão do VISITANTE do chat do site (F14, ADR-038 §2 T01; migration 9030).
 *
 * O visitante não tem login: o que o identifica é um token de 32 bytes que
 * vive no navegador dele e cujo SHA-256 vive em `webchat_sessions`. A sessão
 * nasce anônima; a identificação (`identificacao.ts`) a prende a um contato e
 * a uma conversa. Tudo aqui roda com o service pool + `withTenant` — a tabela
 * é service_only (o visitante não tem JWT; policy para `anon` abriria a sessão
 * a quem tivesse a URL).
 *
 * Fail-closed em todo caminho: organização desconhecida, chat desligado
 * (`webchat.enabled=false`, default declarado) e freio batido devolvem um
 * motivo do enum, nunca uma sessão pela metade.
 */
import { createHash, randomBytes } from "node:crypto";

import { incrementCounter } from "@/src/obs/counters";
import { getSettingIn } from "@/src/tenant-config";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import { getServicePool, type ServicePool } from "@/src/tenant-context/db";

import { contagensDoFreio, decidirFreio, type ContagensDoFreio, type MotivoDoFreio } from "./freios";

export interface WebchatDeps {
  pool?: ServicePool;
  /** Sal do hash de IP — vem de `INTERNAL_SECRET` na aplicação; injetado na prova. */
  salDoIp?: string;
}

export interface SessaoDoVisitante {
  readonly id: string;
  readonly organization_id: string;
  readonly contact_id: string | null;
  readonly conversation_id: string | null;
  readonly visitor_name: string | null;
  readonly visitor_contact: string | null;
  readonly ip_hash: string;
  readonly identified_at: string | null;
}

export type MotivoDeRecusaDaSessao = "unknown_organization" | "webchat_disabled" | MotivoDoFreio;

export type ResultadoDaSessao =
  | { readonly ok: true; readonly token: string; readonly sessao: SessaoDoVisitante }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDaSessao };

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashDoIp(ip: string, sal: string): string {
  return createHash("sha256").update(`${sal}\n${ip}`).digest("hex");
}

async function salPadrao(): Promise<string> {
  const { env } = await import("@/lib/env");
  return env.INTERNAL_SECRET;
}

/** A organização dona do slug — pública por natureza (o slug está na URL do site do cliente). */
export async function organizacaoPorSlug(
  slug: string,
  deps: WebchatDeps = {},
): Promise<{ organization_id: string } | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  const pool = deps.pool ?? (await getServicePool());
  const linha = await pool.query<{ id: string }>(
    `select id from public.organizations where slug = $1 and status = 'active' limit 1`,
    [slug],
  );
  const id = linha.rows[0]?.id;
  return id ? { organization_id: id } : null;
}

export async function webchatLigado(db: TenantDb, ctx: TenantCtx): Promise<boolean> {
  return (await getSettingIn(db, ctx, "webchat.enabled")) === true;
}

/**
 * A decisão de abrir sessão, PURA (alvo do mutante 74): chat desligado recusa
 * ANTES de qualquer freio — uma organização que não ligou o chat não tem
 * sessão nenhuma; ligado, os três freios decidem (`decidirFreio`).
 */
export function decidirAberturaDeSessao(entrada: {
  readonly ligado: boolean;
  readonly contagens: ContagensDoFreio;
}): MotivoDeRecusaDaSessao | null {
  if (!entrada.ligado) return "webchat_disabled";
  return decidirFreio(entrada.contagens);
}

export interface PedidoDeSessao {
  readonly slug: string;
  readonly ip: string;
  readonly user_agent?: string | null;
  readonly page_url?: string | null;
}

export async function criarSessao(pedido: PedidoDeSessao, deps: WebchatDeps = {}): Promise<ResultadoDaSessao> {
  const org = await organizacaoPorSlug(pedido.slug, deps);
  if (org === null) {
    incrementCounter("webchat_session_rejected", { reason: "unknown_organization" });
    return { ok: false, reason: "unknown_organization" };
  }
  const ctx: TenantCtx = { organization_id: org.organization_id, source: "webhook" };
  const sal = deps.salDoIp ?? (await salPadrao());
  const ipHash = hashDoIp(pedido.ip, sal);
  return withTenant(
    ctx,
    async (db) => {
      const recusa = decidirAberturaDeSessao({
        ligado: await webchatLigado(db, ctx),
        contagens: await contagensDoFreio(db, ctx.organization_id, ipHash),
      });
      if (recusa !== null) {
        incrementCounter("webchat_session_rejected", { reason: recusa });
        return { ok: false, reason: recusa } as const;
      }
      const token = randomBytes(32).toString("hex");
      const linha = await db.query<SessaoDoVisitante>(
        `insert into public.webchat_sessions (organization_id, token_hash, ip_hash, user_agent, page_url)
         values ($1::uuid, $2::text, $3::text, $4::text, $5::text)
         returning id, organization_id, contact_id, conversation_id, visitor_name, visitor_contact, ip_hash, identified_at::text`,
        [ctx.organization_id, hashDoToken(token), ipHash, pedido.user_agent ?? null, pedido.page_url ?? null],
      );
      const sessao = linha.rows[0];
      if (sessao === undefined) throw new Error("insert de webchat_sessions não devolveu linha");
      incrementCounter("webchat_session_created", {});
      return { ok: true, token, sessao } as const;
    },
    { pool: deps.pool },
  );
}

/**
 * A sessão a que o token pertence — SÓ se for da organização do slug. Token
 * válido de A apresentado ao slug de B é `null` (cross_org_denied): o slug e o
 * token têm de contar a mesma história.
 */
export async function sessaoPorToken(
  slug: string,
  token: string,
  deps: WebchatDeps = {},
): Promise<SessaoDoVisitante | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const org = await organizacaoPorSlug(slug, deps);
  if (org === null) return null;
  const ctx: TenantCtx = { organization_id: org.organization_id, source: "webhook" };
  return withTenant(
    ctx,
    async (db) => {
      const linha = await db.query<SessaoDoVisitante>(
        `update public.webchat_sessions set last_seen_at = now()
          where token_hash = $1 and organization_id = $2
          returning id, organization_id, contact_id, conversation_id, visitor_name, visitor_contact, ip_hash, identified_at::text`,
        [hashDoToken(token), ctx.organization_id],
      );
      return linha.rows[0] ?? null;
    },
    { pool: deps.pool },
  );
}
