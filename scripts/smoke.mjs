/**
 * scripts/smoke.mjs — o smoke do staging (F06-T07) e o p95 de três endpoints (F06-T09).
 *
 * Seis passos, cada um comparando NÚMERO com denominador — nunca "HTTP 200"
 * (G-76, G-12):
 *   1. login por tenant          logins=2/2      (GoTrue, senha do env; cookie SSR montado aqui)
 *   2. clientes = seed           customers[deka]=Nc/seed customers[demo2]=Nd/seed
 *   3. produtos = seed           products[deka]=Np/seed products[demo2]=Nq/seed
 *   4. POST de webhook mock      webhook_accepted=1/1 (assinado com WHATSAPP_MOCK_HMAC_SECRET)
 *   5. mensagem no inbox         inbox_new=1 (a mensagem do passo 4, lida pela API da conversa)
 *   6. lembrete listado          reminder_listed=1/1 (orders.recurring_reminder do tenant, ligado)
 * Mais: p95_ms de GET /api/v1/health, /api/v1/contacts, /api/v1/conversations (N amostras cada).
 *
 * Saída (a linha que o BUILD-STATE cita):
 *   smoke: steps=6 pass=6/6 customers[deka]=0 customers[demo2]=1 inbox_new=1 logins=2/2 ...
 *   p95_ms: endpoints=3/3 health=… contacts=… conversations=… samples=20
 *
 * Só chama o que o mock devolve: nada sai para pessoa (WHATSAPP_MODE=mock).
 * Uso: node scripts/smoke.mjs <url-do-app> (ver scripts/smoke.sh).
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const URL_APP = (process.argv[2] ?? "http://127.0.0.1:3200").replace(/\/$/, "");
const URL_SUPABASE = (process.env.SMOKE_SUPABASE_URL ?? "http://127.0.0.1:56421").replace(/\/$/, "");
const ENV_FILE = process.env.SMOKE_ENV_FILE ?? "/srv/secrets/crm-staging.env";
const AMOSTRAS = Number(process.env.SMOKE_SAMPLES ?? 20);
const RAIZ = process.cwd();

function lerEnv(nome) {
  const linha = readFileSync(ENV_FILE, "utf8").split("\n").find((l) => l.startsWith(`${nome}=`));
  if (!linha) throw new Error(`${nome} ausente em ${ENV_FILE}`);
  return linha.slice(nome.length + 1).replace(/^'(.*)'$/, "$1");
}
const ANON_KEY = lerEnv("ANON_KEY");
const SENHA = lerEnv("STAGING_SMOKE_PASSWORD");
const HMAC = lerEnv("WHATSAPP_MOCK_HMAC_SECRET");
const DB_URL = process.env.SMOKE_DB_URL ?? `postgresql://postgres:${lerEnv("POSTGRES_PASSWORD")}@127.0.0.1:56422/postgres`;

/**
 * O que cada tenant tem de dado fictício NO BANCO do staging: o
 * `create-tenant.ts` ainda PULA os blocos `customers`/`products` do seed
 * ("entra na fase que adapta a tabela"), então o denominador é a fixture da
 * F02 quando existe (`docs/tenants/<slug>.f02-fixtures.yaml`) e zero quando
 * não existe — o deka não tem fixture (D11: nada da Deka no repositório).
 */
const TENANTS = {
  deka: { email: "admin@deka.staging.test", fixtures: null, conta: "deka-mock" },
  demo2: { email: "admin@demo2.test", fixtures: "docs/tenants/demo2.f02-fixtures.yaml", conta: "demo2-mock" },
};

/** O cookie que `@supabase/ssr` escreve: `base64-` + base64url(JSON da sessão), em pedaços de 3180. */
function cookieDaSessao(sessao) {
  const valor = `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}`;
  const nome = "sb-deskcomm-auth";
  if (encodeURIComponent(valor).length <= 3180) return `${nome}=${valor}`;
  const pedacos = [];
  for (let i = 0; i * 3180 < valor.length; i += 1) pedacos.push(`${nome}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  return pedacos.join("; ");
}

async function login(email) {
  const r = await fetch(`${URL_SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: SENHA }),
  });
  if (!r.ok) return null;
  const sessao = await r.json();
  return sessao.access_token ? cookieDaSessao(sessao) : null;
}

async function api(caminho, cookie, init = {}) {
  const inicio = performance.now();
  const r = await fetch(`${URL_APP}${caminho}`, { ...init, headers: { cookie, accept: "application/json", ...(init.headers ?? {}) } });
  const ms = performance.now() - inicio;
  let corpo = null;
  try {
    corpo = await r.json();
  } catch {
    corpo = null;
  }
  return { status: r.status, corpo, ms };
}

function contagemDaFixture(arquivo, chave) {
  if (!arquivo) return 0;
  const fixture = parseYaml(readFileSync(path.join(RAIZ, arquivo), "utf8"));
  return Array.isArray(fixture?.[chave]) ? fixture[chave].length : 0;
}

function p95(amostras) {
  const ordenadas = [...amostras].sort((a, b) => a - b);
  return Math.round(ordenadas[Math.max(0, Math.ceil(0.95 * ordenadas.length) - 1)]);
}

const passos = [];
const medidas = {};
function passo(nome, ok, detalhe) {
  passos.push({ nome, ok, detalhe });
  process.stderr.write(`[smoke] ${ok ? "ok " : "FALHA"} ${nome}: ${detalhe}\n`);
}

// ─── 1. login por tenant ────────────────────────────────────────────────────
const cookies = {};
for (const [slug, t] of Object.entries(TENANTS)) cookies[slug] = await login(t.email);
const logins = Object.values(cookies).filter(Boolean).length;
medidas.logins = `${logins}/${Object.keys(TENANTS).length}`;
passo("login por tenant", logins === Object.keys(TENANTS).length, `logins=${medidas.logins}`);

// ─── 2. clientes = seed ─────────────────────────────────────────────────────
let clientesOk = true;
for (const [slug, t] of Object.entries(TENANTS)) {
  const seed = contagemDaFixture(t.fixtures, "contacts");
  const r = cookies[slug] ? await api("/api/v1/contacts?limit=100", cookies[slug]) : { status: 0, corpo: null };
  const lidos = Array.isArray(r.corpo?.data) ? r.corpo.data.length : -1;
  medidas[`customers[${slug}]`] = `${lidos}/${seed}`;
  if (lidos !== seed) clientesOk = false;
}
passo("clientes = seed", clientesOk, Object.entries(medidas).filter(([k]) => k.startsWith("customers")).map(([k, v]) => `${k}=${v}`).join(" "));

// ─── 3. produtos = seed ─────────────────────────────────────────────────────
let produtosOk = true;
for (const [slug, t] of Object.entries(TENANTS)) {
  const seed = contagemDaFixture(t.fixtures, "products");
  const r = cookies[slug] ? await api("/api/v1/products?limit=100", cookies[slug]) : { status: 0, corpo: null };
  const lidos = Array.isArray(r.corpo?.data) ? r.corpo.data.length : -1;
  medidas[`products[${slug}]`] = `${lidos}/${seed}`;
  if (lidos !== seed) produtosOk = false;
}
passo("produtos = seed", produtosOk, Object.entries(medidas).filter(([k]) => k.startsWith("products")).map(([k, v]) => `${k}=${v}`).join(" "));

// ─── 4. POST de webhook mock (demo2, cliente do seed) ───────────────────────
const corpoUnico = `smoke ${new Date().toISOString()} ${randomUUID().slice(0, 8)}`;
const fixture = JSON.parse(readFileSync(path.join(RAIZ, "tests/fixtures/waha/2026.7.2/message-texto.json"), "utf8"));
const telefone = "5500000000102"; // o contato fictício Alfa do demo2 (seed-users.sh dá o telefone)
const idExterno = `false_${telefone}@c.us_SMOKE${Date.now().toString(36).toUpperCase()}`;
const payload = {
  ...fixture,
  session: TENANTS.demo2.conta,
  payload: {
    ...fixture.payload,
    id: idExterno,
    from: `${telefone}@c.us`,
    body: corpoUnico,
    timestamp: Math.floor(Date.now() / 1000),
    _data: { ...fixture.payload._data, key: { ...fixture.payload._data.key, id: idExterno.split("_").pop() }, message: { conversation: corpoUnico } },
  },
};
const bruto = JSON.stringify(payload);
const assinatura = createHmac("sha256", HMAC).update(bruto).digest("hex");
const rw = await fetch(`${URL_APP}/api/v1/webhooks/saas/mock`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-webhook-hmac": `sha256=${assinatura}` },
  body: bruto,
});
// Envelope `{ data: {...} }` de `ok()` (lib/api/wrappers.ts).
const webhook = (await rw.json().catch(() => null))?.data ?? null;
const aceito = rw.status === 200 && webhook?.accepted === true && webhook?.replay === false ? 1 : 0;
medidas.webhook_accepted = `${aceito}/1`;
passo("POST de webhook mock", aceito === 1, `status=${rw.status} accepted=${webhook?.accepted} replay=${webhook?.replay} in_service_window=${webhook?.in_service_window ?? "n/a"}`);

// ─── 5. mensagem no inbox ───────────────────────────────────────────────────
let inboxNovas = 0;
if (cookies.demo2) {
  const conversas = await api("/api/v1/conversations?limit=100", cookies.demo2);
  const lista = Array.isArray(conversas.corpo?.data) ? conversas.corpo.data : [];
  for (const c of lista) {
    const msgs = await api(`/api/v1/conversations/${c.id}/messages?limit=50`, cookies.demo2);
    const itens = Array.isArray(msgs.corpo?.data) ? msgs.corpo.data : [];
    inboxNovas += itens.filter((m) => m.body === corpoUnico).length;
  }
}
medidas.inbox_new = `${inboxNovas}`;
passo("mensagem no inbox", inboxNovas === 1, `inbox_new=${inboxNovas} (a mensagem do passo 4, pela API da conversa)`);

// ─── 6. lembrete listado ────────────────────────────────────────────────────
let lembretes = -1;
try {
  lembretes = Number(
    execFileSync("psql", [DB_URL, "-Atc",
      "select count(*) from public.tenant_settings s join public.organizations o on o.id = s.organization_id where o.slug = 'demo2' and s.key = 'orders.recurring_reminder' and (s.value->>'enabled')::boolean"],
      { encoding: "utf8" }).trim(),
  );
} catch {
  lembretes = -1;
}
medidas.reminder_listed = `${lembretes}/1`;
passo("lembrete listado", lembretes === 1, `reminder_listed=${lembretes}/1 (orders.recurring_reminder ligado no demo2)`);

// ─── p95 (F06-T09): medição sem otimizar ────────────────────────────────────
const alvos = [
  ["health", "/api/v1/health", null],
  ["contacts", "/api/v1/contacts?limit=20", cookies.demo2],
  ["conversations", "/api/v1/conversations?limit=20", cookies.demo2],
];
const p95s = {};
for (const [nome, caminho, cookie] of alvos) {
  const amostras = [];
  for (let i = 0; i < AMOSTRAS; i += 1) {
    const r = await api(caminho, cookie ?? "");
    if (r.status >= 200 && r.status < 300) amostras.push(r.ms);
  }
  p95s[nome] = amostras.length === AMOSTRAS ? p95(amostras) : null;
}
const medidos = Object.values(p95s).filter((v) => v !== null).length;

const passou = passos.filter((p) => p.ok).length;
const linha = `smoke: steps=${passos.length} pass=${passou}/${passos.length} customers[deka]=${medidas["customers[deka]"]} customers[demo2]=${medidas["customers[demo2]"]} inbox_new=${medidas.inbox_new} logins=${medidas.logins} products[deka]=${medidas["products[deka]"]} products[demo2]=${medidas["products[demo2]"]} webhook_accepted=${medidas.webhook_accepted} reminder_listed=${medidas.reminder_listed}`;
const linhaP95 = `p95_ms: endpoints=${medidos}/3 health=${p95s.health ?? "fail"} contacts=${p95s.contacts ?? "fail"} conversations=${p95s.conversations ?? "fail"} samples=${AMOSTRAS} url=${URL_APP}`;
process.stdout.write(`${linha}\n${linhaP95}\n`);
process.exit(passou === passos.length && medidos === 3 ? 0 : 1);
