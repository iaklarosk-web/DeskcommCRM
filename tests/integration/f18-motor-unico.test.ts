/**
 * F18 — um motor de IA só (ADR-040; ADR-041 §2).
 *
 * Grava a linha `engine:` do bloco (`gravarLinhaDoVerify`) no ÚLTIMO caso, com
 * todos os campos medidos aqui — cada um com denominador (G-14). Roda no
 * Postgres descartável do `test:integration`, com o provedor de IA dublado.
 *
 * T00 (este arquivo, parte 1) — as duas objeções do `contraponto` viradas
 * teste, antes de a fase crescer:
 *
 *   objeção 2 (herança): com `ai.engine=saas` e uma versão PUBLICADA do agente
 *   herdado, o turno SaaS usa o `system_prompt` DAQUELA versão e restringe a
 *   busca no acervo às fontes que ela declara. Se isto não desse certo, a fase
 *   dobraria de tamanho — por isso é o primeiro caso escrito.
 *
 *   objeção 1 (fail-closed): ferramenta DECLARADA pela versão publicada e
 *   ausente do catálogo não some em silêncio — o turno devolve
 *   `handoff/tool_missing` com o nome dela no dossiê. Nome que o modelo
 *   inventou continua descartado e contado, porque inventar não é falta de
 *   produto.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import {
  comoTextoDoProvedor,
  motorDaOrganizacao,
  textoDaMensagemDeEntrada,
  declaradasForaDoCatalogo,
  herancaDoAgentePublicado,
  instrucoesDoSistema,
  montarContexto,
  responderTurno,
} from "@/src/ai";
import { toolsFor } from "@/src/actions/catalog";
import { setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";

import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import { CFG_LLM, semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG_A = "f1800001-0000-4000-8000-00000000000a";
const ADMIN_A = "f1800001-1000-4000-8000-00000000000a";
const CONTATO_A = "f1800001-2000-4000-8000-00000000000a";
const CONVERSA_A = "f1800001-4000-4000-8000-00000000000a";
const AGENTE_A = "f1800001-5000-4000-8000-00000000000a";
const VERSAO_A = "f1800001-6000-4000-8000-00000000000a";

/** O prompt que SÓ existe na versão publicada — é ele que a prova procura. */
const PROMPT_DA_VERSAO = "Fale como a recepção de uma clínica: frases curtas, sempre confirme o horário.";
/** O prompt da organização, que a herança tem de vencer. */
const PROMPT_DA_ORGANIZACAO = "Fale como um vendedor animado de loja de suco.";
/** Ferramenta declarada pelo agente e que o catálogo NÃO tem (fila de espera). */
const FERRAMENTA_NA_FILA = "crm_add_case_note";

const TENANT_A: ConfigDeTenant = {
  org: ORG_A,
  slug: "f18-motor-a",
  usuario: ADMIN_A,
  sessao: "f1800001-3000-4000-8000-00000000000a",
  conta: "f18-motor-a-conta",
  contatos: [{ id: CONTATO_A, nome: "Cliente da F18", telefone: "+5519990000018" }],
  conversas: [{ id: CONVERSA_A, contato: CONTATO_A, estado: "ai_handling", statusLegado: "ai_handling" }],
  produtos: [],
  materiais: [],
  settings: {
    "ai.enabled": true,
    "ai.system_prompt": PROMPT_DA_ORGANIZACAO,
    "ai.confidence_threshold": 0.6,
  },
};
const ctxAdminA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
const ctxJobA: TenantCtx = { organization_id: ORG_A, source: "job" };

const medidas = {
  saas_turns: 0,
  legacy_turns: 0,
  volta_atras: 0,
  heranca_prompt: 0,
  heranca_acervo: 0,
  fora_do_catalogo_negado: 0,
  fora_do_catalogo_total: 0,
  inventadas_descartadas: 0,
};

/** Um provedor dublado que pede as tools que o teste mandar. */
function registroQuePede(tools: readonly string[]) {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    return {
      content: [
        {
          type: "text" as const,
          text: comoTextoDoProvedor({
            reply: "",
            confidence: 0.9,
            intent: "registrar_no_caso",
            handoff: { wanted: false, reason: null },
            tool_calls: tools.map((name) => ({ name, input: {} })),
          }),
        },
      ],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    };
  });
  return { registry, estado };
}

async function publicarAgente(tools: readonly string[], fontes: readonly string[]): Promise<void> {
  const canal = (
    await pool.query<{ channel_session_id: string }>(
      `select channel_session_id from public.conversations where organization_id=$1 and id=$2`,
      [ORG_A, CONVERSA_A],
    )
  ).rows[0]?.channel_session_id;
  if (canal === undefined) throw new Error("conversa semeada sem channel_session_id");
  await pool.query(
    `insert into public.ai_agents(id,organization_id,name,system_prompt)
     values($1,$2,'Atendente herdado da F18',$3)`,
    [AGENTE_A, ORG_A, PROMPT_DA_ORGANIZACAO],
  );
  await pool.query(
    `insert into public.ai_agent_versions
       (id,organization_id,agent_id,version_number,system_prompt,provider,model,
        channel_session_id,status,published_at,tool_ids,knowledge_source_ids)
     values($1,$2,$3,1,$4,'anthropic','claude-haiku-4-5',$5,'published',now(),$6::text[],$7::uuid[])`,
    [VERSAO_A, ORG_A, AGENTE_A, PROMPT_DA_VERSAO, canal, tools, fontes],
  );
  await pool.query(`update public.ai_agents set published_version_id=$1 where id=$2`, [
    VERSAO_A,
    AGENTE_A,
  ]);
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT_A);
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("F18-T00 — herança do agente publicado (objeção 2)", () => {
  it("sem agente publicado, o turno usa a persona da organização e o acervo inteiro", async () => {
    const heranca = await herancaDoAgentePublicado(ctxJobA, { pool });
    expect(heranca).toBeNull();

    const contexto = await montarContexto(
      ctxJobA,
      { conversation_id: CONVERSA_A, mensagem_do_cliente: "bom dia" },
      { pool },
    );
    expect(contexto.heranca).toBeNull();
    expect(instrucoesDoSistema(contexto)).toContain(PROMPT_DA_ORGANIZACAO);
    console.info("f18-t00-heranca: sem_agente=1/1 persona_da_organizacao=1/1");
  });

  it("com versão publicada e ai.engine=saas, o prompt DA VERSÃO vence o da organização", async () => {
    const fonteDaVersao = randomUUID();
    await publicarAgente([FERRAMENTA_NA_FILA, "crm_search_products"], [fonteDaVersao]);

    const heranca = await herancaDoAgentePublicado(ctxJobA, { pool });
    expect(heranca?.version_id).toBe(VERSAO_A);
    expect(heranca?.system_prompt).toBe(PROMPT_DA_VERSAO);
    expect(heranca?.fontes).toEqual([fonteDaVersao]);

    const contexto = await montarContexto(
      ctxJobA,
      { conversation_id: CONVERSA_A, mensagem_do_cliente: "queria marcar" },
      { pool },
    );
    const instrucoes = instrucoesDoSistema(contexto);
    expect(instrucoes).toContain(PROMPT_DA_VERSAO);
    expect(instrucoes).not.toContain(PROMPT_DA_ORGANIZACAO);
    medidas.heranca_prompt += 1;

    // A busca ficou restrita à fonte da versão: `fontes_consultadas` é 1 (a
    // declarada), não o acervo inteiro da organização.
    expect(contexto.acervo.fontes_consultadas).toBe(1);
    medidas.heranca_acervo += 1;
    console.info(
      `f18-t00-heranca: prompt_da_versao=1/1 fontes_da_versao=${contexto.acervo.fontes_consultadas}/1`,
    );
  });

  it("com ai.engine=legacy a herança NÃO é lida: quem atende é o motor herdado", async () => {
    await setSetting(ctxAdminA, "ai.engine", "legacy", "tenant_admin", { pool });
    const contexto = await montarContexto(
      ctxJobA,
      { conversation_id: CONVERSA_A, mensagem_do_cliente: "oi" },
      { pool },
    );
    expect(contexto.heranca).toBeNull();
    expect(instrucoesDoSistema(contexto)).toContain(PROMPT_DA_ORGANIZACAO);
    await setSetting(ctxAdminA, "ai.engine", "saas", "tenant_admin", { pool });
    console.info("f18-t00-heranca: legacy_sem_heranca=1/1");
  });
});

describe("F18-T01 — o despacho escolhe o motor pela chave da organização", () => {
  it("o padrão declarado é o motor novo, e `legacy` é volta atrás por organização", async () => {
    expect(await motorDaOrganizacao(ctxJobA, { pool })).toBe("saas");

    await setSetting(ctxAdminA, "ai.engine", "legacy", "tenant_admin", { pool });
    expect(await motorDaOrganizacao(ctxJobA, { pool })).toBe("legacy");
    medidas.legacy_turns += 1;

    // Valor fora do vocabulário não pode significar "escolha o outro motor":
    // o schema é a catraca e o padrão declarado é o que vale.
    await pool.query(
      `update public.tenant_settings set value=$1::jsonb where organization_id=$2 and key='ai.engine'`,
      [JSON.stringify("vendaval"), ORG_A],
    );
    expect(await motorDaOrganizacao(ctxJobA, { pool })).toBe("saas");

    await setSetting(ctxAdminA, "ai.engine", "saas", "tenant_admin", { pool });
    medidas.volta_atras += 1;
    console.info("f18-t01-despacho: padrao_saas=1/1 legacy=1/1 valor_estranho_cai_no_padrao=1/1 volta_atras=1/1");
  });

  it("o texto do turno sai da MENSAGEM gravada, e mensagem de saída não vira turno", async () => {
    const entrada = randomUUID();
    const canal = (
      await pool.query<{ channel_session_id: string }>(
        `select channel_session_id from public.conversations where organization_id=$1 and id=$2`,
        [ORG_A, CONVERSA_A],
      )
    ).rows[0]?.channel_session_id;
    await pool.query(
      `insert into public.messages
         (id, organization_id, conversation_id, channel_session_id, contact_id,
          type, direction, status, body, sent_via)
       values ($1,$2,$3,$4,$5,'text','inbound','received','quero remarcar minha consulta','crm')`,
      [entrada, ORG_A, CONVERSA_A, canal, CONTATO_A],
    );
    expect(await textoDaMensagemDeEntrada(pool, ORG_A, entrada)).toBe("quero remarcar minha consulta");

    const saida = randomUUID();
    await pool.query(
      `insert into public.messages
         (id, organization_id, conversation_id, channel_session_id, contact_id,
          type, direction, status, body, sent_via)
       values ($1,$2,$3,$4,$5,'text','outbound','sent','posso te ajudar?','crm')`,
      [saida, ORG_A, CONVERSA_A, canal, CONTATO_A],
    );
    expect(await textoDaMensagemDeEntrada(pool, ORG_A, saida)).toBeNull();
    expect(await textoDaMensagemDeEntrada(pool, ORG_A, randomUUID())).toBeNull();
    medidas.saas_turns += 1;
    console.info("f18-t01-despacho: texto_da_entrada=1/1 saida_nao_vira_turno=1/1 inexistente=1/1");
  });
});

describe("F18-T00 — ferramenta declarada e não migrada (objeção 1)", () => {
  it("o inventário sabe dizer o que a versão declara e o catálogo não tem", async () => {
    const heranca = await herancaDoAgentePublicado(ctxJobA, { pool });
    const cobertas = new Set(toolsFor(ctxJobA, "ai").map((t) => t.name));
    const faltando = declaradasForaDoCatalogo(heranca, cobertas);
    expect(faltando).toContain(FERRAMENTA_NA_FILA);
    medidas.fora_do_catalogo_total += 1;
    console.info(`f18-t00-fila: declaradas_fora=${faltando.length}`);
  });

  it("o modelo pede a ferramenta da fila e o turno devolve handoff/tool_missing com o nome dela", async () => {
    const { registry } = registroQuePede([FERRAMENTA_NA_FILA]);
    const resultado = await responderTurno(
      ctxJobA,
      { conversation_id: CONVERSA_A, mensagem_do_cliente: "anota no meu caso que eu liguei" },
      { pool, cfg: CFG_LLM, registry },
    );
    expect(resultado.status).toBe("handoff");
    expect(resultado.motivo).toBe("tool_missing");

    const dossie = await pool.query<{ reason: string; pending_action: string | null }>(
      `select reason, pending_action from public.handoffs
        where organization_id=$1 and conversation_id=$2
        order by created_at desc limit 1`,
      [ORG_A, CONVERSA_A],
    );
    expect(dossie.rows[0]?.reason).toBe("tool_missing");
    expect(dossie.rows[0]?.pending_action).toBe(FERRAMENTA_NA_FILA);
    medidas.fora_do_catalogo_negado += 1;

    const linha =
      `engine: saas_turns=${medidas.saas_turns} legacy_turns=${medidas.legacy_turns} volta_atras=${medidas.volta_atras}/1 ` +
      `heranca_prompt=${medidas.heranca_prompt}/1 heranca_acervo=${medidas.heranca_acervo}/1 ` +
      `fora_do_catalogo_negado=${medidas.fora_do_catalogo_negado}/${medidas.fora_do_catalogo_total} ` +
      `inventadas_descartadas=${medidas.inventadas_descartadas}/1`;
    console.info(linha);
    gravarLinhaDoVerify("engine", linha);
  });
});
