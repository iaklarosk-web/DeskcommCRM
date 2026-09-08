// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { gravarLinhaDoVerify } from "../lib/verify-metrics";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
function temporary() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-metrics-"));
  directories.push(dir);
  return dir;
}

it("publica no diretório da mesma execução, inclusive quando personalizado", () => {
  const dir = temporary();
  vi.stubEnv("VERIFY_LOG_DIR", path.join(dir, "corrida com espaço"));
  gravarLinhaDoVerify("rbac", "rbac: roles=3 denied_expected=17 denied_actual=17");
  expect(readFileSync(path.join(dir, "corrida com espaço/metrics/rbac.line"), "utf8"))
    .toBe("rbac: roles=3 denied_expected=17 denied_actual=17\n");
});
it("falha de escrita da evidência obrigatória não fica silenciosa", () => {
  const file = path.join(temporary(), "arquivo");
  writeFileSync(file, "não é diretório");
  vi.stubEnv("VERIFY_LOG_DIR", file);
  expect(() => gravarLinhaDoVerify("rbac", "rbac: roles=3")).toThrow();
});
it("o nome da métrica não permite sair da pasta de evidências", () => {
  vi.stubEnv("VERIFY_LOG_DIR", temporary());
  expect(() => gravarLinhaDoVerify("../escape", "qualquer")).toThrow("Nome de métrica inválido");
});
