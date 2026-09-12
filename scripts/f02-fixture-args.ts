import { F02FixtureError } from "../src/tenant-config/f02-fixtures";

export interface F02FixtureCliOptions {
  fixturePath: string;
  sandboxMarker: string;
}

/** Sem argumentos novos, devolve undefined e preserva o create-tenant atual. */
export function parseF02FixtureArgs(args: readonly string[]): F02FixtureCliOptions | undefined {
  if (args.length === 0) return undefined;
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== "--fictional-fixtures" && flag !== "--sandbox-marker") {
      throw new F02FixtureError("fixture_unknown_cli_argument");
    }
    if (!value || value.startsWith("--")) {
      throw new F02FixtureError("fixture_cli_value_missing");
    }
    if (found.has(flag)) throw new F02FixtureError("fixture_duplicate_cli_argument");
    found.set(flag, value);
  }
  const fixturePath = found.get("--fictional-fixtures");
  const sandboxMarker = found.get("--sandbox-marker");
  if (!fixturePath || !sandboxMarker) {
    throw new F02FixtureError("fixture_cli_pair_required");
  }
  return { fixturePath, sandboxMarker };
}
