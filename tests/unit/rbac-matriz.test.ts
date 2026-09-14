/**
 * F01-T07 — rbac (§5.4, D15/ADR-003). O DoD deriva TUDO da matriz: D =
 * células "nega", cada uma testada com o 403 do gate, declarando a identidade
 * usada (o valor herdado que a produz, via ADR-003).
 */
import { describe, expect, it } from "vitest";

import { gravarLinhaDoVerify } from "../lib/verify-metrics";

import {
  can,
  MATRIZ,
  PAPEIS_D15,
  PAPEL_HERDADO,
  papelD15DoHerdado,
  RbacDeniedError,
  requirePermission,
  type PapelD15,
  type Permissao,
} from "@/src/rbac/matrix";

/** A identidade herdada que PRODUZ cada papel D15 (declarada no caso, DoD). */
const IDENTIDADE: Record<PapelD15, string> = {
  platform_admin: "linha em platform_admins (is_platform_admin=true)",
  tenant_admin: "user_organizations.role='admin'",
  attendant: "user_organizations.role='agent'",
};

const PERMISSOES = Object.keys(MATRIZ) as Permissao[];

describe("rbac — matriz D15 (roles=3)", () => {
  it("roles=3 e toda permissão tem célula para os três papéis", () => {
    expect(PAPEIS_D15).toHaveLength(3);
    for (const p of PERMISSOES) {
      for (const papel of PAPEIS_D15) {
        expect(typeof MATRIZ[p][papel], `${p} × ${papel}`).toBe("boolean");
      }
    }
  });

  it("denied_expected=denied_actual: CADA célula 'nega' devolve 403 do gate", () => {
    // Arrange — D derivado da matriz, nunca digitado
    const negadas: Array<{ papel: PapelD15; permissao: Permissao }> = [];
    for (const permissao of PERMISSOES) {
      for (const papel of PAPEIS_D15) {
        if (!MATRIZ[permissao][papel]) negadas.push({ papel, permissao });
      }
    }
    const deniedExpected = negadas.length;

    // Act
    let deniedActual = 0;
    for (const { papel, permissao } of negadas) {
      expect(can(papel, permissao), `${permissao} × ${papel} (${IDENTIDADE[papel]})`).toBe(false);
      try {
        requirePermission(papel, permissao);
      } catch (e) {
        expect(e).toBeInstanceOf(RbacDeniedError);
        expect((e as RbacDeniedError).status).toBe(403);
        expect((e as RbacDeniedError).code).toBe("forbidden_role");
        deniedActual += 1;
      }
    }

    // Assert — a linha do VERIFY
    expect(deniedActual).toBe(deniedExpected);
    const linha = `rbac: roles=3 denied_expected=${deniedExpected} denied_actual=${deniedActual}`;
    console.log(linha);
    gravarLinhaDoVerify("rbac", linha);
    expect(deniedExpected).toBeGreaterThan(10);
  });

  it("toda célula 'permite' passa no gate sem lançar", () => {
    for (const permissao of PERMISSOES) {
      for (const papel of PAPEIS_D15) {
        if (MATRIZ[permissao][papel]) {
          expect(() => requirePermission(papel, permissao), `${permissao} × ${papel}`).not.toThrow();
          expect(can(papel, permissao)).toBe(true);
        }
      }
    }
  });

  it("tradução ADR-003 nas duas direções (leitura e gravação)", () => {
    // leitura: herdado → D15
    expect(papelD15DoHerdado("admin")).toBe("tenant_admin");
    expect(papelD15DoHerdado("agent")).toBe("attendant");
    expect(papelD15DoHerdado("manager"), "manager vira tenant_admin até a Fase 2 (ADR-003)").toBe(
      "tenant_admin",
    );
    expect(papelD15DoHerdado("viewer"), "viewer é descartado na Fase 1").toBeNull();
    expect(papelD15DoHerdado(undefined)).toBeNull();
    expect(papelD15DoHerdado("viewer", true), "platform_admins vence membership").toBe(
      "platform_admin",
    );
    // gravação: D15 → herdado (o que o CHECK do banco aceita)
    expect(PAPEL_HERDADO.tenant_admin).toBe("admin");
    expect(PAPEL_HERDADO.attendant).toBe("agent");
  });

  it("papel nenhum (viewer/sem membership) não pode NADA", () => {
    for (const permissao of PERMISSOES) {
      expect(can(null, permissao), permissao).toBe(false);
      expect(() => requirePermission(null, permissao)).toThrow(RbacDeniedError);
    }
  });
});
