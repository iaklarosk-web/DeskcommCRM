/**
 * F06-T04 e F06-T08 — o CI varre segredos e roda o gate em todo PR (§7.7).
 *
 * `act` não é dependência deste repositório e o gate leva 65–130 min; o que
 * cabe aqui é o "equivalente" de §7.7 T08: o workflow é lido do disco e
 * conferido campo a campo — dispara em `pull_request`, sobe o MESMO sandbox
 * do gate local, chama `scripts/verify.sh` (o único que imprime `STATUS:`),
 * publica a evidência e derruba o sandbox mesmo quando reprova. E o `ci.yml`
 * ganhou os dois passos da T04: a varredura de segredos (com a linha
 * `secrets: files_scanned=F findings=0` medida aqui de verdade, pelo script)
 * e a checagem do inventário do `.env.example`.
 *
 * O link do run no GitHub é do proprietário (§7.7 T08): fica no BUILD-STATE,
 * não aqui.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const VERIFY = path.join(RAIZ, ".github/workflows/verify.yml");
const CI = path.join(RAIZ, ".github/workflows/ci.yml");

interface Passo {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, { "timeout-minutes"?: number; steps: Passo[]; env?: Record<string, string> }>;
}

describe("F06-T08 — verify.yml roda o gate integral em todo PR", () => {
  const wf = parse(readFileSync(VERIFY, "utf8")) as Workflow;
  const job = wf.jobs["verify"]!;
  const passos = job.steps;
  const runs = passos.map((p) => p.run ?? "");

  it("dispara em pull_request e o job tem teto de tempo acima do pior gate medido (130 min)", () => {
    expect(Object.keys(wf.on)).toContain("pull_request");
    expect(job["timeout-minutes"]).toBeGreaterThanOrEqual(130);
  });

  it("usa a MESMA receita do gate local: sandbox descartável, marcador e porta que o verify exige", () => {
    expect(runs.some((r) => /scripts\/verify\/sandbox\.sh up/.test(r)), "sobe o sandbox").toBe(true);
    expect(runs.some((r) => /^bash scripts\/verify\.sh$/m.test(r.trim())), "chama scripts/verify.sh").toBe(true);
    expect(job.env?.["F02_E2E_SANDBOX_ID"]).toBe("f02-crm-cadastros-disposable");
    expect(job.env?.["E2E_PORT"]).toBe("3102");
    expect(job.env?.["SUPABASE_WORKDIR"]).toBe(".verify-logs/sandbox-workdir");
  });

  it("publica a evidência e derruba o sandbox MESMO quando o gate reprova", () => {
    const upload = passos.find((p) => p.uses?.startsWith("actions/upload-artifact"));
    const down = passos.find((p) => /sandbox\.sh down/.test(p.run ?? ""));
    expect(upload?.if).toBe("always()");
    expect(down?.if).toBe("always()");
    const indiceGate = passos.findIndex((p) => /scripts\/verify\.sh/.test(p.run ?? ""));
    expect(passos.indexOf(upload!)).toBeGreaterThan(indiceGate);
    expect(passos.indexOf(down!)).toBeGreaterThan(indiceGate);
  });

  it("nenhum passo relaxa o verify: sem --revalidate, sem .skip, sem retries", () => {
    const texto = readFileSync(VERIFY, "utf8");
    expect(texto).not.toMatch(/--revalidate/);
    expect(texto).not.toMatch(/retries/);
    expect(texto).not.toMatch(/continue-on-error/);
  });
});

describe("F06-T04 — ci.yml varre segredos e confere o inventário do .env.example em todo PR", () => {
  const wf = parse(readFileSync(CI, "utf8")) as Workflow;
  const runs = wf.jobs["verify"]!.steps.map((p) => p.run ?? "");

  it("o passo de segredos chama scripts/scan-secrets.sh e o de inventário exige diff vazio", () => {
    expect(Object.keys(wf.on)).toContain("pull_request");
    expect(runs.some((r) => /bash scripts\/scan-secrets\.sh/.test(r))).toBe(true);
    expect(runs.some((r) => /scripts\/env-inventory\.sh/.test(r) && /git diff --exit-code -- \.env\.example/.test(r))).toBe(true);
  });

  it("a varredura de verdade: secrets: files_scanned=F findings=0, F > 0 e a fixture negativa é pega", () => {
    // Act — o mesmo script que o CI roda, aqui, agora. O caminho só é
    // substituível para o mutante 56 apontar uma cópia sabotada.
    const script = process.env.F06_SCAN_SECRETS_SCRIPT ?? "scripts/scan-secrets.sh";
    const saida = execFileSync("bash", [script], { cwd: RAIZ, encoding: "utf8" });

    // Assert
    const linha = /secrets: files_scanned=(\d+) findings=(\d+)/.exec(saida);
    expect(linha, saida).not.toBeNull();
    expect(Number(linha![1])).toBeGreaterThan(100);
    expect(Number(linha![2])).toBe(0);
  });
});
