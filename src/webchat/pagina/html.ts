/**
 * O HTML da página do visitante `/chat/<slug>` (F14, ADR-038 §2 T02).
 *
 * Servido por Route Handler — e não por uma página React — por UMA razão:
 * o cabeçalho `Content-Security-Policy: frame-ancestors`, que decide QUAIS
 * sites podem embutir este chat (`webchat.allowed_origins`, por organização),
 * só existe se a resposta o carregar, e uma página do App Router não emite
 * cabeçalho. A página é pequena (um balão de conversa), autocontida (sem
 * dependência do app, sem cookie de sessão) e sem dado de mentira: tudo o que
 * ela mostra vem das rotas públicas, por polling de 3 s (ADR-038 §5).
 *
 * O token da sessão vive em `localStorage` sob a chave do slug; a página o
 * manda no cabeçalho `x-webchat-token`. Nada do produto é exposto além do
 * nome da organização.
 *
 * F24 (Suporte KN, 25/09/2026), o que a página passou a fazer:
 *  - O id da mensagem (`client_message_id`, o árbitro da reentrega) é UUID v4
 *    SEMPRE. `crypto.randomUUID` só existe em contexto seguro, e um iframe
 *    https dentro de uma página http NÃO é contexto seguro (medido:
 *    `isSecureContext=false`); o fallback antigo não era UUID, o servidor
 *    respondia 422 e o visitante lia "tente de novo" para sempre.
 *  - Rede que falha e servidor que recusa são avisos DIFERENTES
 *    (`semRede` × `recusada`): antes o `fetch` rejeitado nem chegava a mostrar
 *    aviso (a promessa morria sem `catch`).
 *  - Fila com prazo (`fila.modo = retorno`): "Recebemos sua pergunta.
 *    {empresa} responde por {contato} em até {prazo}." no lugar de "na fila
 *    para um atendente"; `{contato}` é o que a sessão devolve em
 *    `visitor_contact` (o que a pessoa informou na identificação).
 *  - Pré-preenchimento (`preenchimento`): `value=` nos dois campos da
 *    identificação, que continuam `required` e editáveis. Identidade
 *    DECLARADA, não autenticada.
 */
import { TEXTOS_DA_PAGINA, type IdiomaDaPagina } from "./textos";

export interface ConfiguracaoDaFila {
  readonly modo: "atendente" | "retorno";
  readonly prazo: string;
}

export interface Preenchimento {
  readonly name?: string;
  readonly contact?: string;
}

export interface DadosDaPagina {
  readonly slug: string;
  readonly nomeDaOrganizacao: string;
  readonly idioma: IdiomaDaPagina;
  /** Ausente = `atendente`, o comportamento de sempre. */
  readonly fila?: ConfiguracaoDaFila;
  readonly preenchimento?: Preenchimento;
}

const FILA_PADRAO: ConfiguracaoDaFila = { modo: "atendente", prazo: "1 dia útil" };

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** JSON que pode entrar em `<script>`: `<` nunca fecha a tag. */
function paraScript(valor: unknown): string {
  return JSON.stringify(valor).replace(/</g, "\\u003c");
}

function atributoValue(valor: string | undefined): string {
  return valor === undefined ? "" : ` value="${escapar(valor)}"`;
}

export function htmlDaPagina(dados: DadosDaPagina): string {
  const t = TEXTOS_DA_PAGINA[dados.idioma];
  const nome = escapar(dados.nomeDaOrganizacao);
  const textos = paraScript(t);
  const fila = paraScript(dados.fila ?? FILA_PADRAO);
  const nomeNoScript = paraScript(dados.nomeDaOrganizacao);
  const preenchido = dados.preenchimento ?? {};
  return `<!doctype html>
<html lang="${dados.idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${nome} — ${escapar(t.titulo ?? "")}</title>
<style>
  :root { color-scheme: light; --fundo: #f6f7f9; --papel: #ffffff; --texto: #1c1f26; --suave: #5b6270; --linha: #e3e6eb; --marca: #1f6feb; --marca-texto: #ffffff; --visitante: #e8f0fe; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--fundo); color: var(--texto); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .chat { display: flex; flex-direction: column; height: 100%; max-width: 480px; margin: 0 auto; background: var(--papel); }
  header { padding: 14px 16px; border-bottom: 1px solid var(--linha); display: flex; align-items: center; gap: 10px; }
  header .nome { font-weight: 600; }
  header .estado { font-size: 12px; color: var(--suave); margin-left: auto; }
  main { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 82%; padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; word-break: break-word; }
  .msg.visitor { align-self: flex-end; background: var(--marca); color: var(--marca-texto); border-bottom-right-radius: 4px; }
  .msg.ai, .msg.human, .msg.automation { align-self: flex-start; background: var(--visitante); border-bottom-left-radius: 4px; }
  .msg .autor { display: block; font-size: 11px; color: var(--suave); margin-bottom: 2px; }
  .msg.visitor .autor { color: rgba(255,255,255,.8); }
  .aviso { font-size: 12.5px; color: var(--suave); background: var(--fundo); border: 1px solid var(--linha); border-radius: 10px; padding: 8px 10px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--linha); }
  form.ident { flex-direction: column; }
  input, textarea { flex: 1; font: inherit; padding: 10px 12px; border: 1px solid var(--linha); border-radius: 10px; background: var(--papel); color: var(--texto); }
  textarea { resize: none; min-height: 42px; max-height: 120px; }
  button { font: inherit; font-weight: 600; padding: 10px 14px; border: 0; border-radius: 10px; background: var(--marca); color: var(--marca-texto); cursor: pointer; }
  button[disabled] { opacity: .6; cursor: default; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="chat" data-slug="${escapar(dados.slug)}">
  <header><span class="nome">${nome}</span><span class="estado" data-estado></span></header>
  <main data-mensagens aria-live="polite"></main>
  <form class="ident" data-form-ident hidden>
    <input name="name" required minlength="2" maxlength="120" autocomplete="name"${atributoValue(preenchido.name)} data-nome>
    <input name="contact" required minlength="5" maxlength="200" autocomplete="email"${atributoValue(preenchido.contact)} data-contato>
    <button type="submit" data-continuar></button>
  </form>
  <form data-form-msg hidden>
    <textarea name="body" required maxlength="4000" rows="1" data-corpo></textarea>
    <button type="submit" data-enviar></button>
  </form>
</div>
<script>
(function () {
  var T = ${textos};
  var FILA = ${fila};
  var EMPRESA = ${nomeNoScript};
  var raiz = document.querySelector('.chat');
  var slug = raiz.getAttribute('data-slug');
  var base = '/api/public/webchat/' + slug;
  var chave = 'webchat:' + slug + ':token';
  var main = raiz.querySelector('[data-mensagens]');
  var estado = raiz.querySelector('[data-estado]');
  var formIdent = raiz.querySelector('[data-form-ident]');
  var formMsg = raiz.querySelector('[data-form-msg]');
  var visto = null, token = null, identificado = false, pendente = [], timer = null, avisoHorario = null;

  raiz.querySelector('[data-nome]').placeholder = T.nome;
  raiz.querySelector('[data-contato]').placeholder = T.contato;
  raiz.querySelector('[data-continuar]').textContent = T.continuar;
  raiz.querySelector('[data-corpo]').placeholder = T.escrever;
  raiz.querySelector('[data-enviar]').textContent = T.enviar;

  // UUID v4 em qualquer contexto: randomUUID só existe em contexto seguro
  // (iframe https dentro de página http NÃO é), getRandomValues existe em
  // todo navegador vivo, e Math.random fecha o que sobrar.
  function uuid() {
    var c = (typeof crypto !== 'undefined' && crypto) ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16), i;
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = '';
    for (i = 0; i < 16; i++) h += (b[i] + 256).toString(16).slice(1);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function aviso(texto, nome) {
    var el = document.createElement('div');
    el.className = 'aviso';
    if (nome) el.setAttribute('data-aviso', nome);
    el.textContent = texto;
    main.appendChild(el);
    main.scrollTop = main.scrollHeight;
    return el;
  }
  function bolha(m) {
    if (main.querySelector('[data-message-id="' + m.id + '"]')) return; // cursor inclusivo: a última vista pode voltar
    var el = document.createElement('div');
    el.className = 'msg ' + m.author;
    el.setAttribute('data-message-id', m.id);
    var autor = document.createElement('span');
    autor.className = 'autor';
    autor.textContent = m.author === 'visitor' ? T.voce : m.author === 'ai' ? T.assistente : T.atendente;
    el.appendChild(autor);
    el.appendChild(document.createTextNode(m.body));
    main.appendChild(el);
    main.scrollTop = main.scrollHeight;
  }
  // status 0 = a rede falhou (fetch rejeitado): não é recusa do servidor.
  function pedir(caminho, opcoes) {
    opcoes = opcoes || {};
    var headers = { 'content-type': 'application/json' };
    if (token) headers['x-webchat-token'] = token;
    return fetch(base + caminho, { method: opcoes.method || 'GET', headers: headers, body: opcoes.body ? JSON.stringify(opcoes.body) : undefined })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, json: j }; }, function () { return { status: r.status, json: null }; });
      }, function () { return { status: 0, json: null }; });
  }
  function horaLocal(iso, tz) {
    try { return new Intl.DateTimeFormat(document.documentElement.lang, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)); }
    catch (e) { return iso; }
  }
  function textoDaFila(d) {
    if (FILA.modo !== 'retorno') return T.aguardandoHumano;
    var contato = (d && typeof d.visitor_contact === 'string' && d.visitor_contact) ? d.visitor_contact : T.seuContato;
    return T.retornoCombinado.replace('{empresa}', EMPRESA).replace('{contato}', contato).replace('{prazo}', FILA.prazo);
  }
  function mostrarHorario(d) {
    if (d.human_available) { if (avisoHorario) { avisoHorario.remove(); avisoHorario = null; } estado.textContent = ''; return; }
    var texto = T.foraDoHorario.replace('{hora}', horaLocal(d.next_human_at, d.window && d.window.timezone));
    if (!avisoHorario) avisoHorario = aviso(texto, 'fora-do-horario'); else avisoHorario.textContent = texto;
    estado.textContent = d.waiting_human ? textoDaFila(d) : '';
  }
  function ler() {
    if (!token) return Promise.resolve();
    return pedir('/messages' + (visto ? '?after=' + encodeURIComponent(visto) : '')).then(function (r) {
      if (r.status === 404) { token = null; try { localStorage.removeItem(chave); } catch (e) {} return abrir(); }
      if (r.status !== 200 || !r.json || !r.json.data) return;
      var d = r.json.data;
      identificado = !!d.identified;
      formIdent.hidden = identificado;
      formMsg.hidden = !identificado;
      (d.messages || []).forEach(function (m) { bolha(m); visto = m.created_at; });
      mostrarHorario(d);
      if (d.waiting_human && !raiz.querySelector('[data-aviso="fila"]')) aviso(textoDaFila(d), 'fila');
    });
  }
  function abrir() {
    return pedir('/session', { method: 'POST', body: { page_url: document.referrer || location.href } }).then(function (r) {
      if (r.status !== 201) { aviso(r.status === 429 ? T.muitasMensagens : r.status === 0 ? T.semRede : T.indisponivel, 'indisponivel'); return; }
      token = r.json.data.token;
      try { localStorage.setItem(chave, token); } catch (e) {}
      formIdent.hidden = false;
      return ler();
    });
  }
  formIdent.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var botao = formIdent.querySelector('button'); botao.disabled = true;
    pedir('/identify', { method: 'POST', body: { name: raiz.querySelector('[data-nome]').value, contact: raiz.querySelector('[data-contato]').value } })
      .then(function (r) {
        botao.disabled = false;
        if (r.status !== 200) { aviso(r.status === 0 ? T.semRede : T.erro, r.status === 0 ? 'sem-rede' : 'erro'); return; }
        identificado = true; formIdent.hidden = true; formMsg.hidden = false;
        var fila = pendente.splice(0); fila.forEach(enviar);
        raiz.querySelector('[data-corpo]').focus();
      });
  });
  function enviar(corpo) {
    return pedir('/messages', { method: 'POST', body: { client_message_id: uuid(), body: corpo } }).then(function (r) {
      if (r.status === 0) { aviso(T.semRede, 'sem-rede'); return; }
      if (r.status === 429) { aviso(T.muitasMensagens, 'freio'); return; }
      if (r.status !== 202) { aviso(T.recusada, 'recusada'); return; }
      return ler();
    });
  }
  formMsg.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var campo = raiz.querySelector('[data-corpo]');
    var corpo = campo.value.trim();
    if (!corpo) return;
    campo.value = '';
    if (!identificado) { pendente.push(corpo); formIdent.hidden = false; return; }
    enviar(corpo);
  });
  aviso(T.boasVindas, 'boas-vindas');
  try { token = localStorage.getItem(chave); } catch (e) { token = null; }
  (token ? ler() : abrir()).then(function () { timer = setInterval(ler, 3000); });
})();
</script>
</body>
</html>`;
}
