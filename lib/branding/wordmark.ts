/**
 * O wordmark da fachada: "CRM OS" vira `CRM` + `OS` em destaque.
 *
 * É o padrão dos OS da KN (PDV OS, Transportes OS, Oferta OS): o sufixo "OS"
 * ganha a cor de acento e o resto fica no texto. Aqui o nome NÃO é literal —
 * vem de `branding().name`, que o revendedor troca pelo `.env` ou pela tela de
 * marca — então a divisão tem de ser uma regra, e a regra tem de ser estreita:
 *
 * - só "OS" MAIÚSCULO e separado por espaço conta como sufixo. "Kairos",
 *   "Carlos Móveis" e "CRMOS" ficam inteiros: um `/os$/i` pintaria a metade de
 *   um nome próprio, e a marca de quem instalou não pode virar piada de cor.
 * - o resultado preserva o nome COMPLETO no DOM (corpo + espaço + sufixo):
 *   `tests/e2e/icone-da-marca.spec.ts` procura o nome exato na tela e o cruza
 *   com o título da aba. Quem renderiza isto junta as duas partes com um
 *   espaço, nunca coladas.
 */
export interface Wordmark {
  readonly corpo: string;
  readonly sufixo: string | null;
}

const SUFIXO_OS = /^(.*\S)\s+(OS)$/;

export function dividirWordmark(nome: string): Wordmark {
  const limpo = nome.trim();
  const casou = SUFIXO_OS.exec(limpo);
  if (!casou) return { corpo: limpo, sufixo: null };
  return { corpo: casou[1]!, sufixo: casou[2]! };
}
