// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("o gate reprova violações e conserva os resultados reais do runner", () => {
  const result = spawnSync(process.execPath, ["--test", "tests/verify/gate.cases.mjs"], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain("# fail 0");
}, 35_000);
