/**
 * A abstração de PROVEDOR do turno SaaS (§5.9, F04-T04; ADR-021 decisão 1).
 *
 * ═══ O que este arquivo ACRESCENTA, e o que ele deliberadamente NÃO troca ═══
 *
 * O motor herdado já resolve provedor e modelo POR ORGANIZAÇÃO, e resolve bem:
 * `resolveOrgLlmConfig` (`lib/agent-engine/edge/llm/credentials.ts:246`) lê a
 * credencial BYOK da org, e `decidirParaOSeam` escolhe o modelo pelo painel de
 * provedores, caindo em `organizations.settings.llm.default_model` quando
 * ninguém opinou. Trocar isso por uma variável de ambiente global tornaria o
 * produto mono-tenant no ponto em que ele mais precisa ser multi-tenant: duas
 * organizações do mesmo self-host passariam a ser obrigadas a usar o mesmo
 * modelo, e a tela "Agente de IA › Provedores" viraria enfeite.
 *
 * §7.5 (F04-T04) pede `AI_PROVIDER` e `AI_CHAT_MODEL`. As duas entram como
 * DECLARAÇÃO DA INSTALAÇÃO, por cima da resolução por organização:
 *
 *   - `AI_CHAT_MODEL` vira `input.model` do seam — exatamente o degrau
 *     "modeloDoCallSite" que `decidirParaOSeam` já prevê, e que continua sujeito
 *     a `enabled_models` da org. AUSENTE, nada é passado e a org decide. É
 *     acréscimo, não substituição: sem a variável o comportamento é o de hoje,
 *     byte a byte.
 *   - `AI_PROVIDER` decide QUAL REGISTRO de provedores o turno usa — o de rede
 *     (`createDefaultRegistry`) ou o mock sem rede (`createFakeRegistry`). Não
 *     decide qual vendor a organização usa; isso continua sendo
 *     `organizations.settings.llm.provider`.
 *
 * ═══ `AI_PROVIDER=mock` é o único valor que muda comportamento ═══
 *
 * §5.9 escreve o vocabulário como `mock|openai`. O instalador herdado já grava
 * nessa MESMA variável `anthropic|openrouter|openai`
 * (`hostgator-setup-kit/install.sh:1620`, lido em
 * `scripts/bootstrap-owner.ts:153`, que a converte em `settings.llm.provider`).
 * Duas grafias para a mesma variável seria uma contradição de nível (a) — e a
 * saída que NÃO inventa uma terceira variável é esta: `mock` significa "não
 * fale com rede nenhuma"; qualquer outro valor significa "use os provedores
 * reais, e quem escolhe entre eles é a organização". Assim `AI_PROVIDER=openai`
 * de §5.9 e `AI_PROVIDER=openai` do instalador querem dizer a mesma coisa, e
 * `scripts/verify.sh:29` (`AI_PROVIDER=mock`) continua sendo a garantia de que
 * a Fase 1 fecha sem tocar em provedor real (D12).
 *
 * ═══ Por que o mock responde por ROTEIRO ═══
 *
 * §5.9 exige mock "determinístico por `case_id`". O roteiro é uma FUNÇÃO do
 * pedido para a saída estruturada: o mesmo prompt dá a mesma resposta, sempre,
 * sem rede e sem chave. `docs/ai-eval/cases.yaml` (F04-T07) é quem vai alimentar
 * essa função com os 30 casos; aqui nasce o contrato que ela vai preencher, e o
 * roteiro padrão é o que responde quando ninguém carregou caso nenhum.
 */
import {
  createDefaultRegistry,
  createFakeRegistry,
  type ProviderRegistry,
} from "@/lib/agent-engine/edge/llm/providers";

import { comoTextoDoProvedor, type SaidaEstruturada } from "./contrato";

/** As chaves de ambiente desta camada — nomes num lugar só. */
export const ENV_PROVEDOR = "AI_PROVIDER" as const;
export const ENV_MODELO = "AI_CHAT_MODEL" as const;

/** O valor de `AI_PROVIDER` que proíbe rede. Todo o resto usa os reais. */
export const PROVEDOR_MOCK = "mock" as const;

/** Só o recorte do ambiente que interessa — teste injeta um objeto, não muta o global. */
export type Ambiente = Readonly<Record<string, string | undefined>>;

/**
 * `process.env` entra por PARÂMETRO com default, nunca lido no meio do turno.
 *
 * Assim o teste não precisa mutar (nem restaurar) o ambiente do processo — que é
 * estado global compartilhado entre arquivos da suíte e a fonte clássica de
 * teste que passa sozinho e falha em conjunto.
 *
 * ⚠️ As DUAS variáveis são nomeadas LITERALMENTE aqui, em vez de devolver
 * `process.env` inteiro. Dois motivos, e os dois são regra:
 *
 *  - §5.9 lista "env vars" entre o que NUNCA entra no contexto da IA. Devolver o
 *    ambiente inteiro deixaria toda variável do processo — chaves incluídas — a
 *    um passo de descuido do prompt. Aqui só existe o que esta camada lê.
 *  - G-27: o inventário de `.env.example` é um `grep` pelo acesso direto a
 *    `process.env.<VARIÁVEL>` (`scripts/env-inventory.sh`). Uma leitura
 *    indexada (`env[CONSTANTE]`) é
 *    invisível para ele, e a variável nasceria sem linha no template — que é
 *    exatamente o defeito que a regra 12 do AGENTS.md existe para impedir.
 */
export function ambientePadrao(): Ambiente {
  return {
    [ENV_PROVEDOR]: process.env.AI_PROVIDER,
    [ENV_MODELO]: process.env.AI_CHAT_MODEL,
  };
}

/** `true` quando a instalação declarou que nenhum byte deve sair (D12). */
export function ehModoMock(env: Ambiente = ambientePadrao()): boolean {
  return (env[ENV_PROVEDOR] ?? "").trim().toLowerCase() === PROVEDOR_MOCK;
}

/**
 * O override declarado de modelo. `undefined` (e não uma string vazia) quando a
 * variável não foi preenchida: `undefined` é o que faz `chamarModelo` OMITIR o
 * campo e deixar a organização decidir.
 */
export function modeloDeclarado(env: Ambiente = ambientePadrao()): string | undefined {
  const valor = (env[ENV_MODELO] ?? "").trim();
  return valor.length > 0 ? valor : undefined;
}

/** O que o roteiro do mock vê. É o prompt REAL que o turno montou, nada mais. */
export interface PedidoAoModelo {
  /** As mensagens como o SDK as entrega, `system` incluído. */
  readonly prompt: readonly { readonly role: string; readonly content: unknown }[];
}

/** Mock determinístico: mesmo pedido, mesma saída, sem rede (§5.9, D12). */
export type Roteiro = (pedido: PedidoAoModelo) => SaidaEstruturada;

/**
 * O roteiro de omissão: confessa que não sabe.
 *
 * `confidence: 0` de propósito — sem caso carregado, a resposta honesta é "não
 * tenho base para isto", e o turno a converte em handoff `low_confidence`. Um
 * mock que responda "ok" com confiança alta faria toda suíte que esquecer de
 * carregar o roteiro passar por um caminho que não existe em produção.
 */
export const roteiroDeOmissao: Roteiro = () => ({
  reply: "",
  intent: "sem_roteiro",
  confidence: 0,
  tool_calls: [],
  handoff: { wanted: false, reason: null },
});

/**
 * Registro FAKE que responde pelo roteiro.
 *
 * Reusa `createFakeRegistry` (`MockLanguageModelV3` do SDK instalado: zero rede,
 * zero chave) e só ALARGA as chaves: o registro de fábrica só declara
 * `anthropic` e `fake`, e uma organização com `settings.llm.provider = 'openai'`
 * cairia em `LlmProviderUnknownError` dentro do mock — um vermelho sobre a
 * configuração do teste, não sobre o produto.
 */
export function criarRegistroMock(roteiro: Roteiro = roteiroDeOmissao): ProviderRegistry {
  const base = createFakeRegistry(async (options) => ({
    content: [
      {
        type: "text" as const,
        text: comoTextoDoProvedor(
          roteiro({
            prompt: options.prompt as unknown as PedidoAoModelo["prompt"],
          }),
        ),
      },
    ],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }));
  const fabrica = base["anthropic"];
  if (fabrica === undefined) {
    throw new Error("createFakeRegistry deixou de declarar o provider anthropic");
  }
  return {
    ...base,
    openai: fabrica,
    google: fabrica,
    openrouter: fabrica,
  };
}

export interface DepsDoProvedor {
  readonly env?: Ambiente;
  /** Roteiro do mock. Ignorado quando `AI_PROVIDER` não é `mock`. */
  readonly roteiro?: Roteiro;
  /** Registro já pronto — o teste de integração injeta o que CONTA chamadas. */
  readonly registry?: ProviderRegistry;
}

/**
 * O registro de provedores deste turno.
 *
 * Fail-closed em favor do mock NÃO acontece aqui de propósito: sem
 * `AI_PROVIDER=mock` a instalação está declarando que quer os provedores reais,
 * e transformar "esqueci de configurar" em "responde do mock" seria o pior tipo
 * de silêncio — o cliente recebendo resposta de brinquedo achando que é a IA.
 */
export function registroDoProvedor(deps: DepsDoProvedor = {}): ProviderRegistry {
  if (deps.registry !== undefined) return deps.registry;
  if (ehModoMock(deps.env ?? ambientePadrao())) {
    return criarRegistroMock(deps.roteiro ?? roteiroDeOmissao);
  }
  return createDefaultRegistry();
}
