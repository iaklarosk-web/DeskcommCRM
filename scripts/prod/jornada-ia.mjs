/**
 * F08-T05 — UM turno real de IA e UM material indexado com embedding real, na
 * produção, pelo caminho do produto (ADR-032 §2).
 *
 * O dono loga pelo domínio (GoTrue atrás do Caddy), cria o agente do
 * onboarding pela API (`POST /api/v1/ai/agents`, versão `anthropic` com
 * `credential_id: null` = chave da instalação), publica e ensaia
 * (`POST …/versions/:vid/test`) — é o que a tela "Testar" do onboarding faz.
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
      },
    }),
  }), "criar agente");
}
const agenteId = agente.id;
let versaoId = agente.published_version_id ?? null;
if (!versaoId) {
  const versoes = exige(await api(cookie, `/api/v1/ai/agents/${agenteId}/versions`), "listar versões");
  const rascunho = (Array.isArray(versoes) ? versoes : []).find((v) => v.status === "draft") ?? (Array.isArray(versoes) ? versoes[0] : null);
  if (!rascunho) throw new Error("agente sem versão para publicar");
  exige(await api(cookie, `/api/v1/ai/agents/${agenteId}/publish`, { method: "POST", body: JSON.stringify({ version_id: rascunho.id }) }), "publicar");
  versaoId = rascunho.id;
}

// ─── 2. o turno real ─────────────────────────────────────────────────────────
const ensaio = exige(await api(cookie, `/api/v1/ai/agents/${agenteId}/versions/${versaoId}/test`, {
  method: "POST",
  body: JSON.stringify({ sample_message: MENSAGEM }),
}), "ensaio");
const texto = String(ensaio.final_text ?? "").trim();
if (ensaio.status && ensaio.status !== "completed") throw new Error(`turno terminou como ${ensaio.status}: ${ensaio.error_code ?? ""} ${ensaio.error_message ?? ""}`);
if (!texto) throw new Error("turno sem texto de resposta");
console.info(`ai_turn: ok status=${ensaio.status ?? "completed"} provider=anthropic model=claude-haiku-4-5 chars=${texto.length} agent=${agenteId.slice(0, 8)} version=${versaoId.slice(0, 8)}`);

// ─── 3. o material com embedding real ───────────────────────────────────────
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
  if (estado.last_index_status === "ok" && Number(estado.chunks_count) >= 1) break;
  if (estado.last_index_status === "failed") throw new Error(`indexação falhou: ${estado.last_index_error ?? "sem detalhe"}`);
  await new Promise((r) => setTimeout(r, 3000));
}
if (!(estado?.last_index_status === "ok" && Number(estado.chunks_count) >= 1)) {
  throw new Error(`material não indexou em 120 s (status=${estado?.last_index_status ?? "?"} chunks=${estado?.chunks_count ?? "?"})`);
}
console.info(`embedding: ok source=${fonteId.slice(0, 8)} status=${estado.last_index_status} chunks=${estado.chunks_count} model=openai/text-embedding-3-small`);
