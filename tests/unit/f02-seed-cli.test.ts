import { describe, expect, it } from "vitest";

import { F02FixtureError } from "../../src/tenant-config/f02-fixtures";
import { parseF02FixtureArgs } from "../../scripts/f02-fixture-args";

describe("F02-T07 — argumentos opt-in", () => {
  it("preserva o comportamento sem argumentos adicionais", () => {
    expect(parseF02FixtureArgs([])).toBeUndefined();
  });

  it("aceita o par explícito em qualquer ordem", () => {
    expect(
      parseF02FixtureArgs([
        "--fictional-fixtures",
        "fixture.yaml",
        "--sandbox-marker",
        "sandbox-marker-com-16",
      ]),
    ).toEqual({ fixturePath: "fixture.yaml", sandboxMarker: "sandbox-marker-com-16" });
    expect(
      parseF02FixtureArgs([
        "--sandbox-marker",
        "sandbox-marker-com-16",
        "--fictional-fixtures",
        "fixture.yaml",
      ]),
    ).toEqual({ fixturePath: "fixture.yaml", sandboxMarker: "sandbox-marker-com-16" });
  });

  it.each([
    [["--fictional-fixtures", "fixture.yaml"], "fixture_cli_pair_required"],
    [["--sandbox-marker", "sandbox-marker-com-16"], "fixture_cli_pair_required"],
    [["--fictional-fixtures"], "fixture_cli_value_missing"],
    [["--desconhecido", "x"], "fixture_unknown_cli_argument"],
    [
      [
        "--fictional-fixtures",
        "a.yaml",
        "--fictional-fixtures",
        "b.yaml",
        "--sandbox-marker",
        "sandbox-marker-com-16",
      ],
      "fixture_duplicate_cli_argument",
    ],
  ])("recusa combinação incompleta/ambígua %#", (args, code) => {
    expect(() => parseF02FixtureArgs(args)).toThrowError(new F02FixtureError(code));
  });
});
