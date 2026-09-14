/**
 * Leitura de identidade do fio WAHA — e por que ela mora num MÓDULO-FOLHA.
 *
 * Estas funções são puras: recebem o chatId ou o payload já validado pelo
 * schema e devolvem identidade, telefone ou ponteiro de mídia. Nada de banco,
 * nada de efeito. Viviam em `lib/waha/ingest.ts`, que é o oposto: ele importa
 * auditoria, saúde de conexão, efeitos pós-entrada, escalação e o disparador
 * local do pipeline.
 *
 * ─── O que a mudança de casa conserta, medido ───────────────────────────────
 *
 * `src/channels/inbound-parse.ts` precisa só destas quatro funções. Importando-as
 * de `ingest.ts`, arrastava junto a cadeia
 * `pos-entrada.ts` -> `kick-local-pipeline.ts` -> `register-handlers.ts` ->
 * `workers/lgpd-export-worker.ts` -> `@react-pdf/renderer`, que em Node puro
 * estoura `ERR_PACKAGE_PATH_NOT_EXPORTED: './en-us'`. Consequência observada:
 * `workers/saida-worker.ts` NÃO subia como processo solto, e G-71 manda provar
 * justamente isso (`cd /tmp && node /abs/worker.js`).
 *
 * O comportamento não muda em nada: `ingest.ts` reexporta o que era dele, e
 * quem já importava de lá continua importando de lá. É mudança de endereço,
 * não de contrato — e a suíte herdada de `lib/waha/` é quem prova isso.
 */
import type { WahaPayload } from "@/lib/waha/envelope";

export type ChatIdentity =
  | { kind: "phone"; phone: string; lid: null }
  | { kind: "lid"; phone: null; lid: string } // lid = somente dígitos
  | { kind: "group"; phone: null; lid: null }
  | { kind: "unknown"; phone: null; lid: null };

/**
 * Corta o chatId no `@` do sufixo — o que `replace(/@.*$/, "")` fazia aqui, sem
 * o custo quadrático que fez o CodeQL apontar as duas linhas (js/polynomial-redos,
 * alertas #6 e #7).
 *
 * ⚠️ NÃO troque por `indexOf("@")` nem por `lastIndexOf("@")`: nenhum dos dois é
 * equivalente. `.` não casa terminador de linha e `$` (sem /m) só casa no fim da
 * string, então o `@` que a regex achava é o PRIMEIRO **depois do ÚLTIMO
 * terminador de linha**. Em `"@@@\n@lid"` a regex devolvia `"@@@\n"`; `indexOf`
 * devolveria `""` e `lastIndexOf`, `"@@@\n@"`. Medido por varredura exaustiva
 * (37.449 strings, alfabeto `{@ a \n \r LS PS + espaço}`): esta formulação diverge
 * em 0; `indexOf` em 11.760; `lastIndexOf` em 11.798.
 *
 * Os quatro terminadores são exatamente os que `.` não casa (`\n \r U+2028 U+2029`
 * — NEL, TAB e NBSP casam, então não entram). Escritos como escape de propósito:
 * a versão com o caractere cru é indistinguível a olho da versão corrompida por
 * um copy-paste, e `tsc`/`eslint` dão verde nas duas — só a semântica muda
 * (4.582 divergências em 37.449).
 *
 * Por que era caro: o motor reinicia a tentativa a partir de CADA `@`, e quando há
 * um terminador de linha no meio todas falham — O(n²). O `endsWith("@lid")` acima
 * NÃO protege: `"@".repeat(n) + "\n@lid"` passa por ele. Medido nesta função,
 * `String.replace` sendo síncrono (trava o event loop do processo inteiro, todos
 * os tenants): 64 KB de `from` custam ~2,9 s; 256 KB, ~48 s. A entrada é externa —
 * `payload.from` vem do corpo do webhook, e `WAHA_WEBHOOK_REQUIRE_SIGNATURE` é
 * `false` por padrão. Esta varredura é linear: 1 MB em 0,7 ms.
 *
 * O que MUDOU desde que isto foi escrito: o corpo chegava por
 * `JSON.parse(rawBody) as WahaEnvelope` — cast, sem validação —, então `from`
 * podia nem ser string e o `.endsWith` acima lançava. Hoje o contrato é um
 * schema (`lib/waha/envelope.ts`) e a rota recusa antes de chegar aqui. O
 * TAMANHO continua livre, que é por isso que esta função segue linear.
 */
function semSufixoDeChat(chatId: string): string {
  const aposQuebra =
    Math.max(
      chatId.lastIndexOf("\n"),
      chatId.lastIndexOf("\r"),
      chatId.lastIndexOf("\u2028"),
      chatId.lastIndexOf("\u2029"),
    ) + 1;
  const arroba = chatId.indexOf("@", aposQuebra);
  return arroba === -1 ? chatId : chatId.slice(0, arroba);
}

/**
 * Resolve um chatId WAHA em identidade canônica:
 *  - `{number}@c.us` | `@s.whatsapp.net` -> phone E.164 ("+55...")
 *  - `{lid}@lid` -> lid (somente dígitos; número protegido pelo WhatsApp)
 *  - `@g.us` -> group (skip binding CRM — descarte ESPERADO, por doutrina)
 *  - qualquer outra coisa -> unknown (descarte que DEIXA RASTRO)
 *
 * A quarta variante existe porque este `return` final classificava tudo o que
 * não reconhecia como "grupo", e o ingest descarta grupo: "não sei ler isto"
 * virava "descarta calado" — a mesma família do defeito que sumia com a mensagem
 * digitada no celular (PR #108), inclusive o mesmo sintoma de webhook devolvendo
 * 200 sem erro. `@newsletter` e `@broadcast` já existem em produção e caíam
 * aqui; o próximo formato do WhatsApp reproduziria o caso inteiro.
 *
 * Grupo e desconhecido têm o MESMO desfecho (não viram contato) e naturezas
 * opostas: um é decisão de produto, o outro é buraco de conhecimento. Só o
 * segundo é anomalia, então só ele emite evento.
 */

export function parseChatId(chatId: string): ChatIdentity {
  if (chatId.endsWith("@g.us")) return { kind: "group", phone: null, lid: null };
  if (chatId.endsWith("@lid")) {
    return { kind: "lid", phone: null, lid: semSufixoDeChat(chatId) };
  }
  if (chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net")) {
    // `replace(/^\+/, "")` fica: é ancorado em `^`, casa 1 caractere, O(1) — não é
    // o que o CodeQL apontou.
    const digits = semSufixoDeChat(chatId).replace(/^\+/, "");
    return { kind: "phone", phone: "+" + digits, lid: null };
  }
  return { kind: "unknown", phone: null, lid: null };
}

/** URL da mídia: WAHA novo (payload.media.url) com fallback legado (payload.mediaUrl). */
export function mediaUrlOf(p: WahaPayload): string | null {
  return p.mediaUrl ?? p.media?.url ?? null;
}

/** MIME da mídia: idem (payload.media.mimetype é o campo do NOWEB atual). */
export function mediaMimeOf(p: WahaPayload): string | null {
  return p.mimetype ?? p.media?.mimetype ?? null;
}

/**
 * O telefone REAL de quem escreveu, quando o chat chega como `@lid`.
 *
 * `from` vem opaco (`70192801575156@lid`), mas `_data.key.remoteJidAlt` traz
 * `558183647258@s.whatsapp.net`. Em grupo, o equivalente é `participantAlt`.
 *
 * Devolve E.164 (`+55…`) ou null. **Só aceita o que parece telefone**: o campo é
 * de fora, e um valor estranho aqui viraria `phone_number` — que é chave de
 * reencontro de contato e endereço de envio. Na dúvida, nulo: contato sem
 * telefone é incômodo, contato com telefone ERRADO manda mensagem para
 * estranho.
 */
export function telefoneAlternativoDe(p: WahaPayload): string | null {
  const bruto = p._data?.key?.remoteJidAlt ?? p._data?.key?.participantAlt ?? null;
  if (!bruto) return null;
  // ⚠️ `endsWith`/`indexOf` e NÃO regex — este valor vem de FORA (é campo de
  // webhook) e a versão com `/@(s\.whatsapp\.net|c\.us)$/` foi apontada pelo
  // CodeQL como ReDoS de severidade alta: o motor tenta casar a partir de CADA
  // `@` da string, então um payload com milhares deles faz o tempo explodir e
  // trava o processo que ingere as mensagens de todo mundo.
  //
  // Comparação de sufixo literal é linear e diz exatamente a mesma coisa. Um
  // teto de tamanho vem antes, porque nem trabalho linear sobre entrada
  // arbitrária é de graça.
  //
  // Só sufixos de NÚMERO: `@lid` significaria que o campo repetiu a identidade
  // opaca, e `@g.us` é grupo — nenhum dos dois é telefone de pessoa.
  if (bruto.length > 128) return null;
  if (!bruto.endsWith("@s.whatsapp.net") && !bruto.endsWith("@c.us")) return null;
  const semSufixo = bruto.slice(0, bruto.indexOf("@"));
  let digitos = "";
  for (const ch of semSufixo) {
    if (ch >= "0" && ch <= "9") digitos += ch;
  }
  // Faixa E.164: 8 a 15 dígitos. Fora disso não é número discável, e o CHECK
  // `contacts_phone_e164_format` recusaria — falhar aqui é melhor que abortar a
  // ingestão inteira da mensagem lá na frente.
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `+${digitos}`;
}
