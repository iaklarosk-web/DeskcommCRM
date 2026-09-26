/**
 * A ORIGEM PÚBLICA de uma requisição — o esquema e o host que o NAVEGADOR
 * usou — para montar URL absoluta que sai do servidor: o script de embed do
 * chat do site (`/embed/<slug>.js`), o link direto e o código de embed que a
 * tela de configuração mostra.
 *
 * Por que existe (F24, Suporte KN, 25/09/2026): `request.nextUrl.origin`
 * atrás do proxy é a origem INTERNA do Next (`https://0.0.0.0:3000`, o host
 * de escuta do standalone). O script de embed servido em produção montava o
 * iframe com esse endereço: em qualquer site externo o balão aparecia e o
 * clique abria um iframe que não carregava (defeito 0a do teste visual).
 *
 * A escada, do mais fiel ao menos:
 *  1. `x-forwarded-proto` + `x-forwarded-host` — o que o proxy (Caddy)
 *     encaminhou; o Caddy sobrescreve o que o cliente mandou, então é
 *     confiável nesta stack. Lista com vários saltos: vale o primeiro.
 *  2. `Host` da requisição, com o esquema encaminhado (ou o da URL) — o Caddy
 *     passa o Host original adiante; é o que uma chamada direta (`verify.sh`,
 *     `curl 127.0.0.1:3000`) traz. Host de ESCUTA (`0.0.0.0`, `[::]`) não é
 *     origem de ninguém e é ignorado.
 *  3. `NEXT_PUBLIC_APP_URL` (o `padrao`), quando é uma URL.
 *  4. A origem da URL interna — o comportamento antigo, só quando nada acima
 *     serviu.
 *
 * Host malformado (`evil.test/<script>`, espaço, aspas) é recusado em vez de
 * entrar em `<script>`/JSON servido: o valor vira parte de código.
 */
const HOST_VALIDO = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(:\d{1,5})?$/i;
const HOSTS_DE_ESCUTA = new Set(["0.0.0.0", "[::]", "::"]);

export interface RequisicaoComOrigem {
  readonly headers: Headers;
  readonly url: string;
}

export interface OpcoesDeOrigem {
  /** `NEXT_PUBLIC_APP_URL` — o degrau 3 da escada. Vazio ou inválido = pulado. */
  readonly padrao?: string;
}

function primeiroValor(bruto: string | null): string | null {
  const valor = bruto?.split(",")[0]?.trim() ?? "";
  return valor.length > 0 ? valor : null;
}

function hostAceitavel(bruto: string | null): string | null {
  if (bruto === null || !HOST_VALIDO.test(bruto)) return null;
  const semPorta = bruto.replace(/:\d{1,5}$/, "").toLowerCase();
  return HOSTS_DE_ESCUTA.has(semPorta) ? null : bruto;
}

function esquemaAceitavel(bruto: string | null): "http" | "https" | null {
  const valor = bruto?.toLowerCase();
  return valor === "http" || valor === "https" ? valor : null;
}

export function origemPublica(req: RequisicaoComOrigem, opcoes: OpcoesDeOrigem = {}): string {
  const interna = new URL(req.url);
  const esquema = esquemaAceitavel(primeiroValor(req.headers.get("x-forwarded-proto"))) ?? (interna.protocol === "https:" ? "https" : "http");

  const encaminhado = hostAceitavel(primeiroValor(req.headers.get("x-forwarded-host")));
  if (encaminhado !== null) return `${esquema}://${encaminhado}`;

  const host = hostAceitavel(primeiroValor(req.headers.get("host")));
  if (host !== null) return `${esquema}://${host}`;

  const padrao = opcoes.padrao?.trim() ?? "";
  if (padrao.length > 0) {
    try {
      return new URL(padrao).origin;
    } catch {
      // não é URL: segue para o último degrau
    }
  }
  return interna.origin;
}
