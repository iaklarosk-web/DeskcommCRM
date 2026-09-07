/**
 * F01-T01 — TenantContext (docs/DIRETRIZ.md §5.1, D20).
 *
 * Prova, contra o módulo REAL (auth e pool mockados):
 *  - fromSession resolve {organization_id, user_id, role} do JWT validado;
 *  - sem sessão ou sem membership lança TenantResolutionError (nunca null:
 *    quem esquece o catch quebra alto, não vaza query sem tenant);
 *  - withTenant é o único caminho ao Postgres service-role: abre transação,
 *    injeta set_config('app.organization_id', …, true) ANTES do fn, commit no
 *    sucesso, rollback no erro, release SEMPRE;
 *  - ctx sem organization_id UUID é rejeitado antes de tocar o pool.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import type { AuthUser } from "@/lib/auth/types";
import {
  fromSession,
  TenantResolutionError,
  withTenant,
  type TenantCtx,
} from "@/src/tenant-context";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function authUser(): AuthUser {
  return {
    id: USER_ID,
    email: "atendente@example.com",
    full_name: "Atendente",
    avatar_url: null,
    is_platform_admin: false,
    organizations: [
      {
        organization_id: ORG_ID,
        organization_name: "Org de Teste",
        role: "agent",
      },
    ],
  } as unknown as AuthUser;
}

/** Pool fake: grava cada query na ordem, e conta connect/release. */
function fakePool(opts: { failOn?: string } = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let released = 0;
  let connects = 0;
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (opts.failOn && text.includes(opts.failOn)) {
        throw new Error(`falha injetada em: ${opts.failOn}`);
      }
      return { rows: [] };
    }),
    release: vi.fn(() => {
      released += 1;
    }),
  };
  const pool = {
    connect: vi.fn(async () => {
      connects += 1;
      return client;
    }),
  };
  return {
    pool: pool as never,
    client,
    queries,
    get released() {
      return released;
    },
    get connects() {
      return connects;
    },
  };
}

describe("TenantContext", () => {
  beforeEach(() => {
    vi.mocked(loadAuthUser).mockReset();
    vi.mocked(resolveActiveOrg).mockReset();
  });

  describe("fromSession", () => {
    it("resolve organization_id, user_id e role da sessão autenticada", async () => {
      // Arrange
      vi.mocked(loadAuthUser).mockResolvedValue(authUser());
      vi.mocked(resolveActiveOrg).mockResolvedValue({
        orgId: ORG_ID,
        name: "Org de Teste",
        role: "agent",
      });

      // Act
      const ctx = await fromSession();

      // Assert
      expect(ctx).toEqual({
        organization_id: ORG_ID,
        user_id: USER_ID,
        role: "agent",
        source: "session",
      });
    });

    it("lança TenantResolutionError quando não há sessão autenticada", async () => {
      // Arrange
      vi.mocked(loadAuthUser).mockResolvedValue(null);

      // Act + Assert
      const promessa = fromSession();
      await expect(promessa).rejects.toBeInstanceOf(TenantResolutionError);
      await expect(fromSession()).rejects.toMatchObject({
        source: "session",
        reason: "unauthenticated",
      });
    });

    it("lança TenantResolutionError quando o usuário não tem membership", async () => {
      // Arrange
      vi.mocked(loadAuthUser).mockResolvedValue(authUser());
      vi.mocked(resolveActiveOrg).mockResolvedValue(null);

      // Act + Assert
      await expect(fromSession()).rejects.toMatchObject({
        source: "session",
        reason: "no_membership",
      });
    });
  });

  describe("withTenant", () => {
    const ctx: TenantCtx = { organization_id: ORG_ID, source: "session" };

    it("roda fn dentro de transação com set_config ANTES, e commita no sucesso", async () => {
      // Arrange
      const fake = fakePool();

      // Act
      const resultado = await withTenant(ctx, async () => "ok", { pool: fake.pool });

      // Assert — ordem exata: begin → set_config(param) → commit
      expect(resultado).toBe("ok");
      const textos = fake.queries.map((q) => q.text.toLowerCase().trim());
      expect(textos[0]).toBe("begin");
      expect(textos[1]).toContain("set_config('app.organization_id', $1, true)");
      expect(fake.queries[1]?.values).toEqual([ORG_ID]);
      expect(textos[2]).toBe("commit");
      expect(fake.released).toBe(1);
    });

    it("entrega ao fn o MESMO client da transação (não um client novo)", async () => {
      // Arrange
      const fake = fakePool();

      // Act
      await withTenant(
        ctx,
        async (client) => {
          await client.query("select 1");
        },
        { pool: fake.pool },
      );

      // Assert — a query do fn aparece entre set_config e commit, no mesmo client
      const textos = fake.queries.map((q) => q.text.toLowerCase().trim());
      expect(textos).toEqual([
        "begin",
        "select set_config('app.organization_id', $1, true)",
        "select 1",
        "commit",
      ]);
      expect(fake.connects).toBe(1);
    });

    it("faz rollback e propaga o erro quando fn lança — e libera o client", async () => {
      // Arrange
      const fake = fakePool();
      const explosao = new Error("regra de negócio falhou");

      // Act
      const promessa = withTenant(
        ctx,
        async () => {
          throw explosao;
        },
        { pool: fake.pool },
      );

      // Assert
      await expect(promessa).rejects.toBe(explosao);
      const textos = fake.queries.map((q) => q.text.toLowerCase().trim());
      expect(textos).toContain("rollback");
      expect(textos).not.toContain("commit");
      expect(fake.released).toBe(1);
    });

    it("rejeita ctx sem organization_id UUID antes de tocar o pool", async () => {
      // Arrange
      const fake = fakePool();
      const invalido = { organization_id: "deka'; drop table--", source: "session" } as TenantCtx;

      // Act + Assert
      await expect(withTenant(invalido, async () => "nunca", { pool: fake.pool })).rejects.toMatchObject(
        { reason: "invalid_organization_id" },
      );
      expect(fake.connects).toBe(0);
    });

    it("libera o client mesmo quando o próprio commit falha", async () => {
      // Arrange
      const fake = fakePool({ failOn: "commit" });

      // Act
      const promessa = withTenant(ctx, async () => "ok", { pool: fake.pool });

      // Assert
      await expect(promessa).rejects.toThrow("falha injetada");
      expect(fake.released).toBe(1);
    });
  });
});
