/**
 * F08-T01 — a régua estática do stack de PRODUÇÃO (ADR-032, ADR-033).
 *
 * §7.9 pede "configuração sem placeholders" e "jornadas reais". Metade disso
 * é medida contra o stack de pé (`scripts/prod/prova.sh` → linha `prod:`);
 * esta metade é lida do disco e vale em todo gate, mesmo com a produção
 * derrubada: o `compose.prod.yml` não pode carregar dublê (`waha-mock`,
 * `mailpit`, `AI_PROVIDER=mock`, `WHATSAPP_MODE=mock`, `SENTRY_DSN: off`),
 * não pode publicar porta em `0.0.0.0`, tem `mem_limit` em todo serviço e
 * lê os segredos SÓ do env de produção. E os scripts/runbook que o compose
 * cita existem (régua `documentacao-aponta-para-o-que-existe`).
 *
 * `F08_COMPOSE_PROD` aponta o teste para outra cópia do compose — é o que o
 * mutante 65 usa para provar que a régua fica vermelha com um mock dentro.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const COMPOSE = process.env.F08_COMPOSE_PROD ?? path.join(RAIZ, "compose.prod.yml");

interface Servico {
  image?: string;
  build?: unknown;
  container_name?: string;
  mem_limit?: string;
  restart?: string;
  env_file?: string | string[];
  environment?: Record<string, string | number | boolean>;
  ports?: string[];
  networks?: string[];
  logging?: unknown;
}
interface Compose {
  services: Record<string, Servico>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, { name?: string }>;
}

const compose = parse(readFileSync(COMPOSE, "utf8")) as Compose;
const servicos = Object.entries(compose.services);
const PRODUTO = ["app", "worker", "worker-saida", "worker-lembrete"];
const PORTAS_PERMITIDAS = new Set(["3300", "56431", "56432"]);
const DUBLES = /\b(mock|placeholder|staging|example\.test|localhost|mailpit)\b/i;

function env(nome: string): Record<string, string> {
  const s = compose.services[nome];
  if (!s) throw new Error(`serviço ${nome} ausente`);
  return Object.fromEntries(Object.entries(s.environment ?? {}).map(([k, v]) => [k, String(v)]));
}

describe("F08-T01 — compose.prod.yml: sem dublê, sem porta pública, com teto de memória e segredos só do env de produção", () => {
  it("declara os 14 serviços da produção e NENHUM dublê (waha-mock, mailpit)", () => {
    const nomes = servicos.map(([n]) => n).sort();
    expect(nomes).toEqual(["app", "auth", "db", "kong", "realtime", "redis", "rest", "scheduler", "srh", "storage", "waha", "worker", "worker-lembrete", "worker-saida"]);
    expect(nomes).not.toContain("waha-mock");
    expect(nomes).not.toContain("mailpit");
  });

  it("todo serviço tem mem_limit, restart, logging rotacionado, rede crm-prod e container_name crm-prod-*", () => {
    const faltas: string[] = [];
    for (const [nome, s] of servicos) {
      if (!s.mem_limit) faltas.push(`${nome}: sem mem_limit`);
      if (s.restart !== "unless-stopped") faltas.push(`${nome}: restart=${s.restart}`);
      if (!s.logging) faltas.push(`${nome}: sem logging`);
      if (!s.networks?.includes("prod")) faltas.push(`${nome}: fora da rede prod`);
      if (!s.container_name?.startsWith("crm-prod-")) faltas.push(`${nome}: container_name=${s.container_name}`);
    }
    expect(faltas, faltas.join("\n")).toEqual([]);
    expect(compose.networks?.prod?.name).toBe("crm-prod");
    expect(`${servicos.length}/${servicos.length}`).toBe("14/14");
  });

  it("nenhuma porta em 0.0.0.0: só 127.0.0.1 e o IP do Tailscale, e só 3300/56431/56432", () => {
    const publicadas = servicos.flatMap(([nome, s]) => (s.ports ?? []).map((p) => `${nome}: ${p}`));
    expect(publicadas.length).toBe(6);
    for (const linha of publicadas) {
      const [, mapa] = linha.split(": ");
      const partes = mapa!.split(":");
      expect(partes.length, linha).toBe(3);
      expect(["127.0.0.1", "${PROD_BIND_IP}"], linha).toContain(partes[0]);
      expect(PORTAS_PERMITIDAS.has(partes[1]!), linha).toBe(true);
    }
  });

  it("app e workers usam provedores REAIS, o env de produção e nenhum override de SENTRY_DSN/NEXT_PUBLIC_APP_URL", () => {
    for (const nome of PRODUTO) {
      const s = compose.services[nome]!;
      const e = env(nome);
      expect(s.env_file, nome).toBe("/srv/secrets/crm-prod.env");
      expect(e.WHATSAPP_MODE, nome).toBe("waha");
      expect(e.AI_PROVIDER, nome).toBe("anthropic");
      expect(e.APP_NAME, nome).toBe("${PLATFORM_NAME}");
      expect(e.SENTRY_DSN, `${nome}: SENTRY_DSN vem do env_file (ADR-032 §1 D12-6), nunca sobrescrito`).toBeUndefined();
      expect(e.NEXT_PUBLIC_APP_URL, nome).toBeUndefined();
      expect(e.WAHA_API_BASE_URL, nome).toBe("http://waha:3000");
      expect(e.WAHA_API_KEY, `${nome}: a chave vem do env_file`).toBeUndefined();
      expect(e.NEXT_PUBLIC_SUPABASE_URL, nome).toBe("http://kong:8000");
    }
    expect(env("app").NEXT_PUBLIC_SUPABASE_URL_BROWSER).toBe("${NEXT_PUBLIC_APP_URL}");
  });

  it("nenhum valor de environment é dublê/placeholder (mock, placeholder, staging, example.test, localhost, mailpit)", () => {
    const achados: string[] = [];
    for (const [nome, s] of servicos) {
      for (const [k, v] of Object.entries(s.environment ?? {})) {
        if (DUBLES.test(String(v))) achados.push(`${nome}.${k}=${String(v)}`);
      }
      if (s.image && /:latest$/.test(s.image)) achados.push(`${nome}.image sem tag pinada`);
    }
    expect(achados, achados.join("\n")).toEqual([]);
  });

  it("GoTrue manda e-mail pela Resend por SMTP e, com o BLOCKER-PROD aberto, mantém o cadastro público desligado (D13)", () => {
    const e = env("auth");
    expect(e.GOTRUE_SMTP_HOST).toBe("smtp.resend.com");
    expect(e.GOTRUE_SMTP_USER).toBe("resend");
    expect(e.GOTRUE_SMTP_PASS).toBe("${RESEND_API_KEY}");
    expect(e.GOTRUE_SMTP_ADMIN_EMAIL).toBe("${RESEND_FROM_EMAIL}");
    expect(e.GOTRUE_DISABLE_SIGNUP).toBe("true");
    expect(e.API_EXTERNAL_URL).toBe("${NEXT_PUBLIC_APP_URL}/auth/v1");
    expect(e.GOTRUE_SITE_URL).toBe("${NEXT_PUBLIC_APP_URL}");
  });

  it("o WAHA real está de pé com tag pinada, dashboard desligado, HMAC e chave hasheada; o webhook vai ao app pela rede do compose", () => {
    const s = compose.services["waha"]!;
    const e = env("waha");
    expect(s.image).toBe("devlikeapro/waha:latest-2026.7.2");
    expect(e.WAHA_DASHBOARD_ENABLED).toBe("false");
    expect(e.WAHA_API_KEY).toBe("sha512:${WAHA_API_KEY_SHA512}");
    expect(e.WHATSAPP_HOOK_HMAC).toBe("${WAHA_HMAC_SECRET}");
    expect(e.WHATSAPP_HOOK_URL).toBe("http://app:3000/api/v1/webhooks/waha");
    expect(e.WHATSAPP_DEFAULT_ENGINE).toBe("NOWEB");
  });

  it("os scripts e o runbook que o compose cita existem (documentação aponta para o que existe)", () => {
    const esperados = [
      "scripts/prod/_env.sh", "scripts/prod/secrets.sh", "scripts/prod/up.sh", "scripts/prod/down.sh", "scripts/prod/status.sh",
      "scripts/prod/backup.sh", "scripts/prod/restore.sh", "scripts/prod/prova.sh", "scripts/prod/bootstrap-owner.sh",
      "scripts/prod/backup-diario.sh", "scripts/prod/jornada-sentry.ts", "scripts/prod/jornada-ia.mjs", "scripts/prod/jornada-email.sh", "scripts/prod/jornada-email.ts", "scripts/prod/criar-tenant.mjs",
      "scripts/prod/vars-obrigatorias.txt", "scripts/staging/Dockerfile.staging", "scripts/staging/kong.template.yml", "docs/ops/prod.md",
    ];
    const faltam = esperados.filter((f) => !existsSync(path.join(RAIZ, f)));
    expect(faltam, faltam.join(", ")).toEqual([]);
    const runbook = readFileSync(path.join(RAIZ, "docs/ops/prod.md"), "utf8");
    for (const s of ["scripts/prod/up.sh", "scripts/prod/down.sh", "scripts/prod/backup.sh", "scripts/prod/restore.sh", "scripts/prod/prova.sh", "scripts/prod/bootstrap-owner.sh"]) {
      expect(runbook, `runbook não cita ${s}`).toContain(s);
    }
    expect(`${esperados.length - faltam.length}/${esperados.length}`).toBe("19/19");
  });
});
