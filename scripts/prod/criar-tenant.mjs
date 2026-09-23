/**
 * Cria uma organização (tenant) na PRODUÇÃO pelo painel do dono — o mesmo
 * `POST /api/v1/admin/tenants` da tela `/admin/tenants` (F11-T03: nasce
 * `active/operator` no plano pedido), logado como o `platform_admin` pelo
 * domínio. Idempotente pelo slug: se já existe, só imprime.
 *
 * O `owner_email` é o PRÓPRIO proprietário da plataforma: assim nenhum
 * e-mail sai para terceiros (a rota só convida quando o e-mail é de outra
 * pessoa) e o proprietário convida a equipe da empresa pelo painel quando
 * quiser. Uso:
 *   node scripts/prod/criar-tenant.mjs <slug> "<nome>" [PLAN_A|PLAN_B|PLAN_C]
 * Saída: uma linha `tenant: ...` com id (prefixo), slug, plano e assinatura.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const [slug, nome, planCode = "PLAN_A"] = process.argv.slice(2);
if (!slug || !nome) throw new Error("uso: criar-tenant.mjs <slug> \"<nome>\" [PLAN_X]");

const ENV_FILE = process.env.PROD_ENV_FILE ?? "/srv/secrets/crm-prod.env";
function lerEnv(n) {
  const l = readFileSync(ENV_FILE, "utf8").split("\n").find((x) => x.startsWith(`${n}=`));
  if (!l) throw new Error(`${n} ausente em ${ENV_FILE}`);
  return l.slice(n.length + 1).replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}
const URL_APP = lerEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
function cookieDaSessao(sessao) {
  const valor = `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}`;
  const n = "sb-deskcomm-auth";
  if (encodeURIComponent(valor).length <= 3180) return `${n}=${valor}`;
  const p = [];
  for (let i = 0; i * 3180 < valor.length; i += 1) p.push(`${n}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  return p.join("; ");
}
const r0 = await fetch(`${URL_APP}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: lerEnv("ANON_KEY"), "content-type": "application/json" },
  body: JSON.stringify({ email: lerEnv("OWNER_EMAIL"), password: lerEnv("OWNER_PASSWORD") }),
});
if (!r0.ok) throw new Error(`login do dono: HTTP ${r0.status}`);
const cookie = cookieDaSessao(await r0.json());
async function api(caminho, init = {}) {
  const r = await fetch(`${URL_APP}${caminho}`, { ...init, headers: { cookie, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) } });
  let corpo = null; try { corpo = await r.json(); } catch { corpo = null; }
  return { status: r.status, corpo };
}

// Sem `?q=`: a busca por texto da rota herdada responde 500 em produção
// ("failed to parse logic tree … slug::text.ilike") — achado F08, VARREDURA §B17.
const lista = await api("/api/v1/admin/tenants?limit=100");
if (lista.status !== 200) throw new Error(`listar: HTTP ${lista.status} ${JSON.stringify(lista.corpo?.error).slice(0, 200)}`);
let org = (lista.corpo.data ?? []).find((o) => o.slug === slug);
let criada = false;
if (!org) {
  const r = await api("/api/v1/admin/tenants", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ display_name: nome, slug, plan: "standard", plan_code: planCode, owner_email: lerEnv("OWNER_EMAIL") }),
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`criar: HTTP ${r.status} ${JSON.stringify(r.corpo?.error ?? r.corpo).slice(0, 300)}`);
  org = r.corpo.data?.organization ?? r.corpo.data;
  criada = true;
}
const depois = await api("/api/v1/admin/tenants?limit=100");
const linha = (depois.corpo.data ?? []).find((o) => o.slug === slug) ?? org;
console.info(`tenant: ${criada ? "created" : "existing"} slug=${slug} id=${String(linha.id).slice(0, 8)} plan=${planCode} subscription=${linha.subscription?.status ?? "?"}/${linha.subscription?.plan_code ?? "?"} owner=platform_admin invites_sent=0/0`);
