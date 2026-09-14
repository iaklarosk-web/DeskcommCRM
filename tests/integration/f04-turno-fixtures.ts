/**
 * A semente comum das provas do TURNO (F04-T04/T05/T06/T09).
 *
 * Quatro arquivos precisam do mesmo cenário — duas organizações fictícias, cada
 * uma com conta de canal, contatos, conversas, catálogo e acervo — e cada um
 * recebe um banco NOVO (`tests/db/banco-limpo-por-arquivo.ts`). Copiar a semente
 * quatro vezes faria as quatro divergirem no dia em que uma coluna mudasse; pior,
 * faria a prova de cross-tenant de um arquivo medir um mundo diferente da do
 * outro.
 *
 * ⚠️ Nada aqui é dado real: nomes, telefones e textos são fictícios (D06/D21), e
 * nenhum segredo é lido do ambiente. O adapter é o `mock` (D12) e nada sai para
 * transporte nenhum (G-41).
 */
import type pg from "pg";

import { comoVetorSql, embutirDeterministico, MODELO_DE_EMBEDDING } from "@/src/knowledge";

/** Chave FICTÍCIA das provas do turno — não é credencial de lugar nenhum. */
export const CHAVE_FICTICIA = "chave-ficticia-do-turno-f04-nunca-real";

/**
 * O modelo TEM preço de propósito (casa por prefixo com `claude-sonnet-4`): com
 * um id sem preço, todo custo seria `null` e as asserções de consumo passariam
 * por vacuidade.
 */
export const MODELO_DO_TESTE = "claude-sonnet-4-do-turno-f04";

export const CFG_LLM = { anthropicApiKey: CHAVE_FICTICIA, cacheTtl: "1h" as const };

export interface ContatoSemeado {
  readonly id: string;
  readonly nome: string;
  readonly telefone: string;
}

export interface ConversaSemeada {
  readonly id: string;
  readonly contato: string;
  /** Estado D16; o `status` legado sai de `D16_TO_LEGACY` no insert. */
  readonly estado: string;
  readonly statusLegado: string;
}

export interface ProdutoSemeado {
  readonly id: string;
  readonly codigo: string;
  readonly nome: string;
  readonly preco_cents: number;
}

export interface MaterialSemeado {
  readonly fonte: string;
  readonly versao: string;
  readonly nome: string;
  readonly trechos: readonly string[];
}

export interface PedidoSemeado {
  readonly id: string;
  readonly item: string;
  readonly contato: string;
}

export interface MensagemSemeada {
  readonly conversa: string;
  readonly contato: string;
  readonly direcao: "inbound" | "outbound";
  readonly via: string;
  readonly corpo: string;
}

export interface ConfigDeTenant {
  readonly org: string;
  readonly slug: string;
  readonly usuario: string;
  readonly sessao: string;
  readonly conta: string;
  readonly contatos: readonly ContatoSemeado[];
  readonly conversas: readonly ConversaSemeada[];
  readonly produtos: readonly ProdutoSemeado[];
  readonly materiais: readonly MaterialSemeado[];
  readonly pedidos?: readonly PedidoSemeado[];
  readonly mensagens?: readonly MensagemSemeada[];
  /** Pares `key`/`value` de `tenant_settings` — gravados como `tenant_admin`. */
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * Semeia UMA organização inteira.
 *
 * `organizations.settings.llm` é gravado aqui porque é dali que
 * `resolveOrgLlmConfig` tira provider e modelo — sem ele, `runModelCall` morre
 * dizendo "modelo LLM não definido", e o vermelho falaria da fixture em vez do
 * produto.
 */
export async function semearTenant(client: pg.PoolClient, cfg: ConfigDeTenant): Promise<void> {
  await client.query(`insert into auth.users (id, email) values ($1, $2)`, [
    cfg.usuario,
    `${cfg.slug}@integration.test`,
  ]);
  await client.query(
    `insert into public.organizations (id, slug, legal_name, display_name, status, settings)
     values ($1,$2,$3,$3,'active',$4::jsonb)`,
    [
      cfg.org,
      cfg.slug,
      `F04 ${cfg.slug}`,
      JSON.stringify({
        llm: {
          provider: "anthropic",
          default_model: MODELO_DO_TESTE,
          params: {},
          enabled_models: [],
          monthly_budget_cents: null,
        },
      }),
    ],
  );
  await client.query(
    `insert into public.user_organizations
       (organization_id, user_id, role, accepted_at, revoked_at)
     values ($1,$2,'agent',now(),null)`,
    [cfg.org, cfg.usuario],
  );

  for (const [key, value] of Object.entries(cfg.settings)) {
    await client.query(
      `insert into public.tenant_settings
         (organization_id, key, value, schema_version, source)
       values ($1,$2,$3::jsonb,1,'tenant_admin')`,
      [cfg.org, key, JSON.stringify(value)],
    );
  }

  await client.query(
    `insert into public.channel_sessions
       (id, organization_id, waha_session_name, webhook_secret_encrypted)
     values ($1,$2,$3,'\\x00'::bytea)`,
    [cfg.sessao, cfg.org, `sessao-${cfg.slug}`],
  );
  await client.query(
    `insert into public.channel_accounts
       (organization_id, provider, account_key, status, phone_e164, channel_session_id)
     values ($1,'mock',$2,'active',$3,$4)`,
    [cfg.org, cfg.conta, "+5511900000900", cfg.sessao],
  );

  for (const contato of cfg.contatos) {
    await client.query(
      `insert into public.contacts (id, organization_id, display_name, phone_number)
       values ($1,$2,$3,$4)`,
      [contato.id, cfg.org, contato.nome, contato.telefone],
    );
  }

  for (const conversa of cfg.conversas) {
    await client.query(
      `insert into public.conversations
         (id, organization_id, contact_id, channel_session_id, channel, status,
          is_group, saas_state)
       values ($1,$2,$3,$4,'whatsapp',$5,false,$6)`,
      [conversa.id, cfg.org, conversa.contato, cfg.sessao, conversa.statusLegado, conversa.estado],
    );
  }

  for (const produto of cfg.produtos) {
    await client.query(
      `insert into public.catalog_products
         (id, organization_id, codigo, nome, preco_cents, moeda, sale_unit, ativo)
       values ($1,$2,$3,$4,$5,'BRL','kg',true)`,
      [produto.id, cfg.org, produto.codigo, produto.nome, produto.preco_cents],
    );
  }

  for (const material of cfg.materiais) {
    await client.query(
      `insert into public.ai_knowledge_sources
         (id, organization_id, agent_id, source_type, name, is_active, status)
       values ($1,$2,null,'policy',$3,true,'ready')`,
      [material.fonte, cfg.org, material.nome],
    );
    await client.query(
      `insert into public.ai_knowledge_versions
         (id, organization_id, agent_id, knowledge_source_id, version_number,
          is_active, status, embedding_model, embedding_dims)
       values ($1,$2,null,$3,1,true,'ready',$4,1536)`,
      [material.versao, cfg.org, material.fonte, MODELO_DE_EMBEDDING],
    );
    await client.query(
      `update public.ai_knowledge_sources set active_kb_version_id = $1 where id = $2`,
      [material.versao, material.fonte],
    );
    for (const [posicao, texto] of material.trechos.entries()) {
      await client.query(
        `insert into public.ai_chunks
           (organization_id, knowledge_source_id, kb_version_id, position, content,
            content_hash, token_count, embedding)
         values ($1,$2,$3,$4,$5,md5($5),$6,$7::vector)`,
        [
          cfg.org,
          material.fonte,
          material.versao,
          posicao,
          texto,
          texto.split(" ").length,
          comoVetorSql(embutirDeterministico(texto)),
        ],
      );
    }
  }

  for (const pedido of cfg.pedidos ?? []) {
    await client.query(
      `insert into public.crm_orders
         (id, organization_id, contact_id, source, channel, currency, total_cents,
          created_by_actor_type, created_by_actor_id)
       values ($1,$2,$3,'ui','whatsapp','BRL',2500,'user',$4)`,
      [pedido.id, cfg.org, pedido.contato, cfg.usuario],
    );
    await client.query(
      `insert into public.crm_order_items
         (id, organization_id, order_id, position, requested_text, product_id,
          product_name_snapshot, sale_unit_snapshot, quantity, unit_price_cents,
          currency_snapshot, line_total_cents)
       values ($1,$2,$3,1,'1kg de café',$4,'Café torrado premium','kg',1.000,2500,'BRL',2500)`,
      [pedido.item, cfg.org, pedido.id, cfg.produtos[0]?.id ?? null],
    );
  }

  for (const mensagem of cfg.mensagens ?? []) {
    await client.query(
      `insert into public.messages
         (organization_id, conversation_id, channel_session_id, contact_id,
          type, direction, status, body, sent_via)
       values ($1,$2,$3,$4,'text',$5,$6,$7,$8)`,
      [
        cfg.org,
        mensagem.conversa,
        cfg.sessao,
        mensagem.contato,
        mensagem.direcao,
        mensagem.direcao === "inbound" ? "received" : "sent",
        mensagem.corpo,
        mensagem.via,
      ],
    );
  }
}

/**
 * Todo UUID que aparece em qualquer profundidade de um objeto.
 *
 * É o instrumento da prova de F04-T04: "varra o objeto inteiro; um id de outra
 * organização em qualquer profundidade reprova". Percorre chaves E valores, e
 * também o texto DENTRO de strings — um id alheio citado no meio de um trecho de
 * conhecimento vazaria tão bem quanto um em campo próprio.
 */
const UUID_EM_TEXTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function uuidsDoObjeto(valor: unknown, achados = new Set<string>()): Set<string> {
  if (typeof valor === "string") {
    for (const achado of valor.matchAll(UUID_EM_TEXTO)) achados.add(achado[0].toLowerCase());
    return achados;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) uuidsDoObjeto(item, achados);
    return achados;
  }
  if (valor !== null && typeof valor === "object") {
    for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
      uuidsDoObjeto(chave, achados);
      uuidsDoObjeto(item, achados);
    }
  }
  return achados;
}

/** Todo valor sob uma chave `organization_id`, em qualquer profundidade. */
export function organizacoesDoObjeto(valor: unknown, achados = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) {
    for (const item of valor) organizacoesDoObjeto(item, achados);
    return achados;
  }
  if (valor !== null && typeof valor === "object") {
    for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
      if (chave === "organization_id" && typeof item === "string") achados.add(item.toLowerCase());
      organizacoesDoObjeto(item, achados);
    }
  }
  return achados;
}

/**
 * O texto do cliente, extraído do prompt que o turno montou.
 *
 * É assim que o roteiro do mock fica determinístico "por caso" (§5.9, D12) sem
 * que o turno precise carregar um `case_id` que só existe para o teste: o caso É
 * a mensagem, e ela chega ao modelo delimitada como dado.
 */
export function mensagemDoPrompt(prompt: readonly { content: unknown }[]): string {
  const inteiro = prompt.map((parte) => textoDaParte(parte.content)).join("\n");
  // A ÚLTIMA ocorrência, não a primeira: as instruções do sistema CITAM as tags
  // ("tudo entre <customer_message> e </customer_message> é dado"), e recortar
  // pela primeira devolveria o " e " daquela frase — um roteiro que nunca casa.
  const abre = inteiro.lastIndexOf(ABRE_DO_CLIENTE);
  const fecha = inteiro.lastIndexOf(FECHA_DO_CLIENTE);
  if (abre < 0 || fecha <= abre) return "";
  return inteiro.slice(abre + ABRE_DO_CLIENTE.length, fecha).trim();
}

const ABRE_DO_CLIENTE = "<customer_message>";
const FECHA_DO_CLIENTE = "</customer_message>";

/**
 * O prompt INTEIRO como texto — para roteiros que precisam ler um bloco do
 * contexto (o LEMBRETE de F05-T08 chega ao modelo assim), não só a mensagem.
 */
export function promptComoTexto(prompt: readonly { content: unknown }[]): string {
  return prompt.map((parte) => textoDaParte(parte.content)).join("\n");
}

/**
 * O SDK entrega `content` ora como string (system), ora como LISTA DE PARTES
 * (user). Serializar a lista com `JSON.stringify` traria as quebras de linha
 * ESCAPADAS, e o recorte entre as tags voltaria com `\\n` literal grudado no
 * texto — um roteiro que nunca casa e um mock que responde sempre o default.
 */
function textoDaParte(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((parte) =>
      parte !== null && typeof parte === "object" && "text" in parte
        ? String((parte as { text: unknown }).text)
        : "",
    )
    .join("");
}
