import { describe, expect, it } from "vitest";

import { orderCommandSchema } from "@/src/crm/orders/commands";

import { F02FixtureError } from "../../src/tenant-config/f02-fixtures";
import { assertSandboxMarker, fixtureOrderCommandHash } from "../../scripts/f02-fixture-writer";

const USER = "a7070000-1000-4000-8000-000000000001";

describe("F02-T07 — cercas puras do writer", () => {
  it("exige marcador longo e igualdade com o valor lido do próprio banco", () => {
    expect(() => assertSandboxMarker("curto", "curto")).toThrowError(
      new F02FixtureError("sandbox_marker_too_short"),
    );
    expect(() => assertSandboxMarker("sandbox-marker-com-16", null)).toThrowError(
      new F02FixtureError("sandbox_marker_mismatch"),
    );
    expect(() => assertSandboxMarker("sandbox-marker-com-16", "outro-marker-com-16")).toThrowError(
      new F02FixtureError("sandbox_marker_mismatch"),
    );
    expect(() =>
      assertSandboxMarker("sandbox-marker-com-16", "sandbox-marker-com-16"),
    ).not.toThrow();
  });

  it("hash canônico não inclui a chave de idempotência, mas fixa ator e corpo", () => {
    const command = orderCommandSchema.parse({
      command: "confirm_order",
      idempotency_key: "fixture:a",
      order_id: "a7070000-2000-4000-8000-000000000001",
      expected_revision: 1,
    });
    const sameBody = orderCommandSchema.parse({ ...command, idempotency_key: "fixture:b" });
    const changedBody = orderCommandSchema.parse({ ...command, expected_revision: 2 });
    expect(fixtureOrderCommandHash(command, USER)).toEqual(fixtureOrderCommandHash(sameBody, USER));
    expect(fixtureOrderCommandHash(command, USER)).not.toEqual(
      fixtureOrderCommandHash(changedBody, USER),
    );
    expect(fixtureOrderCommandHash(command, USER)).not.toEqual(
      fixtureOrderCommandHash(command, "b7070000-1000-4000-8000-000000000002"),
    );
    expect(fixtureOrderCommandHash(command, USER)).toHaveLength(32);
  });
});
