/**
 * F01-T07 — invariante 1 da §5.4: toda rota /api/v1 tem gate de PAPEL
 * (requireRole/requirePlatformAdmin), ou é pública declarada (PUBLIC_PATHS —
 * auth mora dentro da rota), ou está na dívida datada abaixo.
 *
 * O middleware (proxy.ts) já autentica a SESSÃO de tudo que não é público —
 * esta varredura mede a granularidade de papel, não porta aberta. Mesma
 * mecânica da rls-completude: a lista de dívida é a FOTOGRAFIA de 2026-09-07
 * (as rotas herdadas que fazem auth por sessão + RLS sem gate de papel,
 * achado 3 da auditoria A / ADR-003) — rota NOVA nunca entra aqui: ganha
 * requireRole ou entra em PUBLIC_PATHS com justificativa. Reduzir esta lista
 * (dando gate a uma rota e removendo a linha) é o caminho; engordá-la reprova.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_PATHS } from "@/lib/auth/public-paths";

const RAIZ = path.resolve(__dirname, "../..");

/** Fotografia 2026-09-07 (24 rotas): sessão+RLS sem gate de papel. */
const DIVIDA_CONHECIDA = new Set([
  "app/api/v1/ai/providers/[provider]/models/route.ts",
  "app/api/v1/auth/realtime-token/route.ts",
  "app/api/v1/channel-sessions/[id]/qr/route.ts",
  "app/api/v1/channels/partner/templates/media/route.ts",
  "app/api/v1/channels/partner/templates/route.ts",
  "app/api/v1/contacts/[id]/avatar/route.ts",
  "app/api/v1/contacts/[id]/crm-summary/route.ts",
  "app/api/v1/contacts/[id]/timeline/route.ts",
  "app/api/v1/contacts/duplicates/route.ts",
  "app/api/v1/conversations/[id]/messages/route.ts",
  "app/api/v1/conversations/[id]/retention/route.ts",
  "app/api/v1/conversations/counts/route.ts",
  "app/api/v1/conversations/route.ts",
  "app/api/v1/leads/[id]/timeline/route.ts",
  "app/api/v1/leads/proposals/route.ts",
  "app/api/v1/mcp/tools/route.ts",
  "app/api/v1/messages/[id]/media/route.ts",
  "app/api/v1/onboarding/whatsapp/qr/route.ts",
  "app/api/v1/onboarding/whatsapp/session/route.ts",
  "app/api/v1/pipelines/[id]/board/route.ts",
  "app/api/v1/system/update/route.ts",
  "app/api/v1/system/version/route.ts",
  "app/api/v1/team/[user_id]/role/route.ts",
  "app/api/v1/team/[user_id]/route.ts",
]);

function rotasApiV1(): string[] {
  return execFileSync("git", ["ls-files", "app/api/v1/**/route.ts"], {
    cwd: RAIZ,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function urlDaRota(arquivo: string): string {
  return (
    "/" +
    arquivo
      .replace(/^app\//, "")
      .replace(/\/route\.ts$/, "")
      // segmento dinâmico vira um literal qualquer — o PUBLIC_PATHS ancora por
      // prefixo/forma, não pelo valor do parâmetro
      .replace(/\[[^\]]+\]/g, "x")
  );
}

describe("rotas /api/v1 — gate de papel (§5.4 invariante 1)", () => {
  const rotas = rotasApiV1();

  it("a varredura enxerga o App Router de verdade", () => {
    expect(rotas.length).toBeGreaterThan(200);
  });

  it("toda rota tem gate, é pública declarada, ou está na dívida datada", () => {
    const foraDoLugar: string[] = [];
    for (const rota of rotas) {
      const codigo = readFileSync(path.join(RAIZ, rota), "utf8");
      const temGate = /requireRole\(|requirePlatformAdmin\(/.test(codigo);
      const ePublica = PUBLIC_PATHS.some((re) => re.test(urlDaRota(rota)));
      const eDivida = DIVIDA_CONHECIDA.has(rota);
      if (!temGate && !ePublica && !eDivida) foraDoLugar.push(rota);
    }
    expect(
      foraDoLugar,
      "rota /api/v1 sem gate de papel, fora de PUBLIC_PATHS e fora da dívida datada — rota nova ganha requireRole/requirePlatformAdmin ou entra em PUBLIC_PATHS com justificativa; a dívida NÃO cresce",
    ).toEqual([]);
  });

  it("a dívida só encolhe: rota que ganhou gate sai da lista", () => {
    const jaResolvidas = [...DIVIDA_CONHECIDA].filter((rota) => {
      const p = path.join(RAIZ, rota);
      try {
        return /requireRole\(|requirePlatformAdmin\(/.test(readFileSync(p, "utf8"));
      } catch {
        return true; // rota sumiu do repo: sai da lista também
      }
    });
    expect(
      jaResolvidas,
      "rota da dívida já tem gate (ou não existe mais) — remova a linha da DIVIDA_CONHECIDA para a régua voltar a apertar",
    ).toEqual([]);
  });
});
