/**
 * F08-T05 — UM turno real de IA e UM material indexado com embedding real, na
 * produção, pelo caminho do produto (ADR-032 §2).
 *
 * O dono loga pelo domínio (GoTrue atrás do Caddy), cria o agente do
 * onboarding pela API (`POST /api/v1/ai/agents`, versão `anthropic` com
 * `credential_id: null` = chave da instalação) e ensaia a versão em rascunho
 * (`POST …/versions/:vid/test`, dry run) — publicar exige canal WORKING, que
 * só existe com número pareado (D12-4).
 * O turno passa por `run-model-call`, que grava `llm_calls` e
 * `ai_usage_events` na mesma transação (ADR-021). Depois cadastra um FAQ
 * (`POST /api/v1/ai/knowledge/sources`) e espera o `rag-indexer` (worker)
 * indexar com `text-embedding-3-small` da OpenAI → `ai_chunks.embedding`.
 *
 * Idempotente: agente e material são reaproveitados pelo nome. Saída: duas
 * linhas com o que ficou no banco (contagens, modelo, tokens, custo) — nunca
 * a resposta inteira, nunca a chave. Uso:
 *   node scripts/prod/jornada-ia.mjs          (lê /srv/secrets/crm-prod.env)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const ENV_FILE = process.env.PROD_ENV_FILE ?? "/srv/secrets/crm-prod.env";
function lerEnv(nome) {
  const linha = readFileSync(ENV_FILE, "utf8").split("\n").find((l) => l.startsWith(`${nome}=`));
  if (!linha) throw new Error(`${nome} ausente em ${ENV_FILE}`);
  return linha.slice(nome.length + 1).replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}
const URL_APP = lerEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
const ANON_KEY = lerEnv("ANON_KEY");
const NOME_DO_AGENTE = "Assistente KN (F08-T05)";
const NOME_DO_MATERIAL = "FAQ de produção (F08-T05)";
const MENSAGEM = "Olá! Vocês atendem em quais horários e como faço para falar com uma pessoa?";

function cookieDaSessao(sessao) {
  const valor = `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}`;
  const nome = "sb-deskcomm-auth";
  if (encodeURIComponent(valor).length <= 3180) return `${nome}=${valor}`;
  const pedacos = [];
  for (let i = 0; i * 3180 < valor.length; i += 1) pedacos.push(`${nome}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  return pedacos.join("; ");
}

async function login() {
  const r = await fetch(`${URL_APP}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: lerEnv("OWNER_EMAIL"), password: lerEnv("OWNER_PASSWORD") }),
  });
  if (!r.ok) throw new Error(`login do dono falhou: HTTP ${r.status}`);
  const sessao = await r.json();
  if (!sessao.access_token) throw new Error("login sem access_token");
  return cookieDaSessao(sessao);
}

async function api(cookie, caminho, init = {}) {
  const r = await fetch(`${URL_APP}${caminho}`, {
    ...init,
    headers: { cookie, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  let corpo = null;
  try { corpo = await r.json(); } catch { corpo = null; }
  return { status: r.status, corpo };
}
function exige(r, oQue, esperado = [200, 201]) {
  if (!esperado.includes(r.status)) throw new Error(`${oQue}: HTTP ${r.status} ${JSON.stringify(r.corpo?.error ?? r.corpo).slice(0, 300)}`);
  return r.corpo?.data ?? r.corpo;
}

const cookie = await login();

// ─── 0. o canal: a sessão do WAHA REAL, sem número (aguarda o QR do dono) ────
// A versão do agente herdado exige `channel_session_id`
// (`lib/ai/agents/validation.ts`): quem pulou o WhatsApp fica em rascunho e
// não consegue ensaiar. O mesmo `POST /api/v1/onboarding/whatsapp/session`
// da tela cria a sessão no container `waha` (estado SCAN_QR_CODE) e a linha em
// `channel_sessions` — nenhuma mensagem sai; parear é do proprietário (D12-4).
// Sem QR escaneado o WAHA encerra a sessão em ~2 min (QR refs attempts ended →
// FAILED); a LINHA em channel_sessions fica, e é ela que o agente referencia.
// Só cria de novo quando não há linha; reparar/reconectar é a tela de Conexões.
let canal = exige(await api(cookie, "/api/v1/onboarding/whatsapp/session"), "estado do canal");
if (!canal.channel_session_id) {
  canal = exige(await api(cookie, "/api/v1/onboarding/whatsapp/session", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
  }), "criar sessão do WAHA");
}
if (!canal.channel_session_id) throw new Error(`canal sem channel_session_id (status=${canal.status})`);
console.info(`whatsapp_session: row status=${canal.status} session=${canal.session} channel=${String(canal.channel_session_id).slice(0, 8)} paired=0/0`);

// ─── 1. o agente (reaproveitado pelo nome) ───────────────────────────────────
const agentes = exige(await api(cookie, "/api/v1/ai/agents"), "listar agentes");
let agente = (Array.isArray(agentes) ? agentes : []).find((a) => a.name === NOME_DO_AGENTE);
if (!agente) {
  agente = exige(await api(cookie, "/api/v1/ai/agents", {
    method: "POST",
    body: JSON.stringify({
      name: NOME_DO_AGENTE,
      description: "Agente do proprietário para a prova de F08-T05 (turno real de IA).",
      version: {
        system_prompt: "Você atende os clientes da KN Tecnologia, uma empresa de software. Responda em português do Brasil, de forma curta e cordial. Horário de atendimento: dias úteis, das 9h às 18h. Quando a pessoa pedir para falar com alguém, diga que um atendente humano vai assumir.",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        credential_id: null,
        tool_ids: [],
        channel_session_id: canal.channel_session_id,
      },
    }),
  }), "criar agente");
  // A criação responde { agent, version }; a listagem responde o agente direto.
  agente = agente.agent ?? agente;
}
const agenteId = agente.id;
// Publicar exige canal WORKING (número pareado — D12-4, ainda não); o ensaio
// (`/test`, dry run) aceita a versão em RASCUNHO, que é o que o editor usa.
let versaoId = agente.published_version_id ?? null;
if (!versaoId) {
  const versoes = exige(await api(cookie, `/api/v1/ai/agents/${agenteId}/versions`), "listar versões");
  const rascunho = (Array.isArray(versoes) ? versoes : []).find((v) => v.status === "draft") ?? (Array.isArray(versoes) ? versoes[0] : null);
  if (!rascunho) throw new Error("agente sem versão para ensaiar");
  versaoId = rascunho.id;
}

// ─── 2. o material com embedding real (antes do turno: o turno pode esperar a janela) ───────────────────────────────────────
const fontes = exige(await api(cookie, "/api/v1/ai/knowledge/sources"), "listar materiais");
let fonte = (Array.isArray(fontes) ? fontes : []).find((f) => f.name === NOME_DO_MATERIAL);
if (!fonte) {
  fonte = exige(await api(cookie, "/api/v1/ai/knowledge/sources", {
    method: "POST",
    body: JSON.stringify({
      source_type: "faq",
      name: NOME_DO_MATERIAL,
      items: [
        { question: "Qual é o horário de atendimento?", answer: "Dias úteis, das 9h às 18h, horário de Brasília." },
        { question: "Como falo com uma pessoa?", answer: "Peça 'falar com atendente' e um humano assume a conversa." },
        { question: "Vocês emitem nota fiscal?", answer: "Sim, toda contratação recebe nota fiscal de serviço por e-mail." },
      ],
    }),
  }), "criar material");
  if (fonte.indexacao_habilitada === false) throw new Error("indexação desabilitada: sem chave de embedding na instalação");
}
const fonteId = fonte.id;
let estado = null;
for (let i = 0; i < 40; i += 1) {
  estado = exige(await api(cookie, `/api/v1/ai/knowledge/sources/${fonteId}`), "ler material");
  if (estado.last_index_status === "success" && Number(estado.chunks_count) >= 1) break;
  if (estado.last_index_status === "failed") throw new Error(`indexação falhou: ${estado.last_index_error ?? "sem detalhe"}`);
  await new Promise((r) => setTimeout(r, 3000));
}
if (!(estado?.last_index_status === "success" && Number(estado.chunks_count) >= 1)) {
  throw new Error(`material não indexou em 120 s (status=${estado?.last_index_status ?? "?"} chunks=${estado?.chunks_count ?? "?"})`);
}
console.info(`embedding: ok source=${fonteId.slice(0, 8)} status=${estado.last_index_status} chunks=${estado.chunks_count} model=openai/text-embedding-3-small`);

// ─── 3. o turno real ─────────────────────────────────────────────────────────
const ensaio = exige(await api(cookie, `/api/v1/ai/agents/${agenteId}/versions/${versaoId}/test`, {
  method: "POST",
  body: JSON.stringify({ sample_message: MENSAGEM }),
}), "ensaio");
const texto = String(ensaio.final_text ?? "").trim();
const impedimentos = Array.isArray(ensaio.impediments) ? ensaio.impediments : [];
if (ensaio.status !== "ok" || !texto) {
  // Fora da janela de envio (pacing anti-ban do canal, 7h–22h por padrão) o
  // turno ACONTECE (as chamadas ao modelo ficam em ai_usage_events) mas a
  // resposta é agendada, não exposta. Não é falha do provedor: sai com código
  // próprio e a prova repete a jornada dentro da janela.
  if (impedimentos.length && impedimentos.every((i) => i.code === "outside_window")) {
    console.info(`ai_turn: window status=${ensaio.status} provider=anthropic model=claude-haiku-4-5 impediment=outside_window next=${String(impedimentos[0].message ?? "").replace(/.*agende para /, "").slice(0, 40)}`);
    process.exit(2);
  }
  throw new Error(`turno terminou como ${ensaio.status}: impediments=${JSON.stringify(impedimentos).slice(0, 400)} candidates=${(ensaio.candidates ?? []).length} ${ensaio.error_code ?? ""} ${ensaio.error_message ?? ""}`);
}
console.info(`ai_turn: ok status=${ensaio.status} provider=anthropic model=claude-haiku-4-5 chars=${texto.length} agent=${agenteId.slice(0, 8)} version=${versaoId.slice(0, 8)} version_status=draft dry_run=1`);

