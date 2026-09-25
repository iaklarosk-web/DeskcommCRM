/**
 * scripts/smoke.mjs — o smoke do staging (F06-T07) e o p95 de três endpoints (F06-T09).
 *
 * Seis passos, cada um comparando NÚMERO com denominador — nunca "HTTP 200"
 * (G-76, G-12):
 *   1. login por tenant          logins=2/2      (GoTrue, senha do env; cookie SSR montado aqui)
 *   2. clientes = seed           customers[<slug>]=N/seed  (seed + fixture fictícia da F02, ADR-029 §3)
 *   3. produtos = seed           products[<slug>]=N/seed
 *   4. POST de webhook mock      webhook_accepted=1/1 (assinado com WHATSAPP_MOCK_HMAC_SECRET)
 *   5. mensagem no inbox         inbox_new=1 (a mensagem do passo 4, lida pela API da conversa)
 *   6. lembrete listado          reminder_listed=1/1 (orders.recurring_reminder do tenant, ligado)
 * Mais: p95_ms de GET /api/v1/health, /api/v1/contacts, /api/v1/conversations (N amostras cada).
 *
 * Saída (a linha que o BUILD-STATE cita):
 *   smoke: steps=8 pass=8/8 customers[deka]=0 customers[demo2]=1 inbox_new=1 logins=2/2 ... owner_login=1/1 subscriptions[deka]=active/full ...
 *   p95_ms: endpoints=3/3 health=… contacts=… conversations=… samples=20
 *
 * Só chama o que o mock devolve: nada sai para pessoa (WHATSAPP_MODE=mock).
 * Uso: node scripts/smoke.mjs <url-do-app> (ver scripts/smoke.sh).
 * Tenants: SMOKE_TENANTS=<slug,...> (padrão deka,demo2 — a F07-T03 passa o
 * efêmero). O webhook/inbox/lembrete (passos 4–6) usam o PRIMEIRO tenant da
 * lista cujo seed tem cliente com telefone e o lembrete ligado.
 */
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
 * O que cada tenant tem de dado fictício NO BANCO do staging (ADR-029 §3):
 * os blocos do SEED (`docs/tenants/<slug>.seed.yaml`, itens sem sentinela
 * TODO-) mais a fixture fictícia da F02 quando existe
 * (`docs/tenants/<slug>.f02-fixtures.yaml`). O admin que loga é o primeiro
 * `tenant_admin` do seed; o deka não tem usuário no seed (TODO-DEKA, D48) e
 * usa o admin fictício que `seed-users.sh` cria só no staging.
 */
const ADMIN_SO_DE_STAGING = { deka: "admin@deka.staging.test" };
function pendente(v) {
  if (typeof v === "string") return v.startsWith("TODO-");
  if (Array.isArray(v)) return v.some(pendente);
  if (typeof v === "object" && v !== null) return Object.values(v).some(pendente);
  return false;
}
function lerTenant(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`slug inválido: ${slug}`);
  const seed = parseYaml(readFileSync(path.join(RAIZ, `docs/tenants/${slug}.seed.yaml`), "utf8"));
  const admin = (seed.users ?? []).find((u) => u.role === "tenant_admin" && !pendente(u.email))?.email ?? ADMIN_SO_DE_STAGING[slug];
  if (!admin) throw new Error(`${slug}: nenhum tenant_admin utilizável no seed`);
  const conta = (seed.channel_accounts ?? []).find((c) => c.provider === "mock")?.account_ref ?? null;
  const clientes = (seed.customers ?? []).filter((c) => !pendente(c));
  const fixtures = `docs/tenants/${slug}.f02-fixtures.yaml`;
  return {
    email: admin,
    conta,
    seedCustomers: clientes.length,
    seedProducts: (seed.products ?? []).filter((p) => !pendente(p)).length,
    telefone: clientes.find((c) => typeof c.phone === "string" && /^\+\d{8,15}$/.test(c.phone))?.phone?.replace(/^\+/, "") ?? null,
    lembrete: seed.settings?.["orders.recurring_reminder"]?.enabled === true,
    fixtures: existsSync(path.join(RAIZ, fixtures)) ? fixtures : null,
  };
}
const SLUGS = (process.env.SMOKE_TENANTS ?? "deka,demo2").split(",").map((s) => s.trim()).filter(Boolean);
const TENANTS = Object.fromEntries(SLUGS.map((slug) => [slug, lerTenant(slug)]));
// O tenant dos passos 4–6: precisa de cliente com telefone (remetente do
// webhook), conta mock e lembrete ligado.
const ALVO = SLUGS.find((slug) => TENANTS[slug].telefone && TENANTS[slug].conta && TENANTS[slug].lembrete);
if (!ALVO) throw new Error(`nenhum tenant de ${SLUGS.join(",")} tem cliente com telefone, conta mock e lembrete ligado no seed`);

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
  const seed = t.seedCustomers + contagemDaFixture(t.fixtures, "contacts");
  const r = cookies[slug] ? await api("/api/v1/contacts?limit=100", cookies[slug]) : { status: 0, corpo: null };
  const lidos = Array.isArray(r.corpo?.data) ? r.corpo.data.length : -1;
  medidas[`customers[${slug}]`] = `${lidos}/${seed}`;
  if (lidos !== seed) clientesOk = false;
}
passo("clientes = seed", clientesOk, Object.entries(medidas).filter(([k]) => k.startsWith("customers")).map(([k, v]) => `${k}=${v}`).join(" "));

// ─── 3. produtos = seed ─────────────────────────────────────────────────────
let produtosOk = true;
for (const [slug, t] of Object.entries(TENANTS)) {
  const seed = t.seedProducts + contagemDaFixture(t.fixtures, "products");
  const r = cookies[slug] ? await api("/api/v1/products?limit=100", cookies[slug]) : { status: 0, corpo: null };
  const lidos = Array.isArray(r.corpo?.data) ? r.corpo.data.length : -1;
  medidas[`products[${slug}]`] = `${lidos}/${seed}`;
  if (lidos !== seed) produtosOk = false;
}
passo("produtos = seed", produtosOk, Object.entries(medidas).filter(([k]) => k.startsWith("products")).map(([k, v]) => `${k}=${v}`).join(" "));

// ─── 4. POST de webhook mock (cliente do seed do tenant alvo) ───────────────
const corpoUnico = `smoke ${new Date().toISOString()} ${randomUUID().slice(0, 8)}`;
const fixture = JSON.parse(readFileSync(path.join(RAIZ, "tests/fixtures/waha/2026.7.2/message-texto.json"), "utf8"));
const telefone = TENANTS[ALVO].telefone; // o cliente do seed (ADR-029 §3): a mensagem se prende a ele
const idExterno = `false_${telefone}@c.us_SMOKE${Date.now().toString(36).toUpperCase()}`;
const payload = {
  ...fixture,
  session: TENANTS[ALVO].conta,
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
if (cookies[ALVO]) {
  const conversas = await api("/api/v1/conversations?limit=100", cookies[ALVO]);
  const lista = Array.isArray(conversas.corpo?.data) ? conversas.corpo.data : [];
  for (const c of lista) {
    const msgs = await api(`/api/v1/conversations/${c.id}/messages?limit=50`, cookies[ALVO]);
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
      `select count(*) from public.tenant_settings s join public.organizations o on o.id = s.organization_id where o.slug = '${ALVO}' and s.key = 'orders.recurring_reminder' and (s.value->>'enabled')::boolean`],
      { encoding: "utf8" }).trim(),
  );
} catch {
  lembretes = -1;
}
medidas.reminder_listed = `${lembretes}/1`;
passo("lembrete listado", lembretes === 1, `reminder_listed=${lembretes}/1 (orders.recurring_reminder ligado no ${ALVO})`);

// ─── 7. cobrança (F12-T08, ADR-031 §3) ──────────────────────────────────────
// O dono fictício do staging loga e lê a conciliação; cada tenant tem uma
// assinatura que permite uso (`GET /api/v1/billing/subscription` pelo próprio
// tenant_admin); nenhuma organização do staging ficou sem assinatura (D38).
const cookieDoDono = await login("owner@platform.staging.test");
const donoLogou = cookieDoDono ? 1 : 0;
let assinaturasOk = 0;
for (const slug of SLUGS) {
  const r = cookies[slug] ? await api("/api/v1/billing/subscription", cookies[slug]) : { status: 0, corpo: null };
  const acesso = r.corpo?.data?.access?.mode ?? "fail";
  const status = r.corpo?.data?.subscription?.status ?? "none";
  medidas[`subscriptions[${slug}]`] = `${status}/${acesso}`;
  if (r.status === 200 && acesso === "full") assinaturasOk += 1;
}
let semAssinatura = -1;
let organizacoes = -1;
try {
  const [sem, total] = execFileSync("psql", [DB_URL, "-Atc",
    `select (select count(*) from public.organizations o where not exists (select 1 from public.subscriptions s where s.organization_id = o.id)) || '/' || (select count(*) from public.organizations)`],
    { encoding: "utf8" }).trim().split("/").map(Number);
  semAssinatura = sem;
  organizacoes = total;
} catch {
  semAssinatura = -1;
}
medidas.owner_login = `${donoLogou}/1`;
medidas.orgs_without_subscription = `${semAssinatura}/${organizacoes}`;
passo(
  "cobrança: dono loga, assinaturas permitem uso, ninguém sem assinatura",
  donoLogou === 1 && assinaturasOk === SLUGS.length && semAssinatura === 0,
  `owner_login=${medidas.owner_login} ${SLUGS.map((s) => `subscriptions[${s}]=${medidas[`subscriptions[${s}]`]}`).join(" ")} orgs_without_subscription=${medidas.orgs_without_subscription}`,
);

// ─── 8. chat do site (F14-T05, ADR-038 §2 T05) ───────────────────────────────
// `webchat.enabled=false` é o default declarado: em todo tenant do seed a rota
// pública de abrir sessão tem de responder 404 — o chat do site não existe até
// a organização ligar. Mede a RECUSA (fail-closed), não um chat de mentira.
let webchatRecusadas = 0;
for (const slug of SLUGS) {
  const r = await api(`/api/public/webchat/${slug}/session`, "", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  if (r.status === 404) webchatRecusadas += 1;
}
medidas.webchat_disabled_denied = `${webchatRecusadas}/${SLUGS.length}`;
passo("chat do site desligado recusa sessão (default declarado)", webchatRecusadas === SLUGS.length, `webchat_disabled_denied=${medidas.webchat_disabled_denied}`);

// ─── Passo 9 (F18-T05): quem responde o cliente, em cada tenant ───────────
//
// O default declarado da F18 é o motor NOVO — o que tem política por ação,
// teto diário e auditoria. Um ambiente onde alguém deixou `ai.engine=legacy`
// gravado responde sem nenhum dos três, e o smoke é o lugar que percebe isso
// antes do cliente. Lê pela rota da organização, não do banco.
let motorNovo = 0;
for (const slug of SLUGS) {
  const r = await api("/api/v1/settings/ai-autonomy", cookies[slug] ?? "");
  if (r.status === 200 && r.corpo?.data?.engine === "saas") motorNovo += 1;
}
medidas.engine_saas = `${motorNovo}/${SLUGS.length}`;
passo("quem responde o cliente é o motor novo (default declarado)", motorNovo === SLUGS.length, `engine_saas=${medidas.engine_saas}`);

// ─── Passo 10 (F19-T05, ADR-043 §5): o webhook do Stripe nunca aceita sem assinatura ──
//
// Com gateway `stripe` o segredo existe e a rota responde 401 (assinatura
// ausente); com `mock` (produção nesta fase, D57 f) o segredo está vazio e a
// rota responde 503 (fail closed). As duas são "recusado"; 200 é o único
// desfecho que reprova — e é o que apareceria se alguém abrisse a rota.
const stripeSemAssinatura = await fetch(`${URL_APP}/api/v1/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const recusadoStripe = stripeSemAssinatura.status === 401 || stripeSemAssinatura.status === 503 ? 1 : 0;
medidas.webhook_stripe_unsigned_rejected = `${recusadoStripe}/1`;
passo("webhook do Stripe sem assinatura é recusado (401 com gateway stripe, 503 com mock)", recusadoStripe === 1, `webhook_stripe_unsigned_rejected=${medidas.webhook_stripe_unsigned_rejected} status=${stripeSemAssinatura.status}`);

// ─── p95 (F06-T09): medição sem otimizar ────────────────────────────────────
const alvos = [
  ["health", "/api/v1/health", null],
  ["contacts", "/api/v1/contacts?limit=20", cookies[ALVO]],
  ["conversations", "/api/v1/conversations?limit=20", cookies[ALVO]],
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
const porTenant = (prefixo) => SLUGS.map((slug) => `${prefixo}[${slug}]=${medidas[`${prefixo}[${slug}]`]}`).join(" ");
const linha = `smoke: steps=${passos.length} pass=${passou}/${passos.length} ${porTenant("customers")} inbox_new=${medidas.inbox_new} logins=${medidas.logins} ${porTenant("products")} webhook_accepted=${medidas.webhook_accepted} reminder_listed=${medidas.reminder_listed} owner_login=${medidas.owner_login} ${porTenant("subscriptions")} orgs_without_subscription=${medidas.orgs_without_subscription} webchat_disabled_denied=${medidas.webchat_disabled_denied} engine_saas=${medidas.engine_saas} webhook_stripe_unsigned_rejected=${medidas.webhook_stripe_unsigned_rejected} tenants=${SLUGS.join(",")}`;
const linhaP95 = `p95_ms: endpoints=${medidos}/3 health=${p95s.health ?? "fail"} contacts=${p95s.contacts ?? "fail"} conversations=${p95s.conversations ?? "fail"} samples=${AMOSTRAS} url=${URL_APP}`;
process.stdout.write(`${linha}\n${linhaP95}\n`);
process.exit(passou === passos.length && medidos === 3 ? 0 : 1);
