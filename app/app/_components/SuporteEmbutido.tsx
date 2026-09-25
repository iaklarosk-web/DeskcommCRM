"use client";
/**
 * O chat de suporte da KN embutido na área logada do PRÓPRIO CRM-OS
 * (F24-T03, Suporte KN, 25/09/2026): o mesmo script `/embed/<slug>.js` que
 * qualquer cliente põe no site dele, apontando para a organização de suporte
 * deste produto (`suporte-crm-os`). Liga só quando `SUPPORT_WEBCHAT_SLUG`
 * está definida na instalação; sem ela, nada é montado.
 *
 * Usa o contrato do pré-preenchimento (F24-T02): nome e e-mail de quem está
 * logado vão em `window.__crmWebchatPrefill` ANTES de o script entrar. A
 * identidade continua declarada (o CRM de suporte não confere a sessão daqui);
 * a fase 2 do suporte, com identidade autenticada, é outra construção.
 *
 * O `src` é relativo (`/embed/<slug>.js`): o script vem da mesma origem em que
 * a área logada está aberta, e é ele quem resolve a origem pública do iframe.
 * Ao desmontar (logout leva a `/login`), o que o script deixou no `<body>` —
 * balão, janela e a guarda `__crmWebchat` — sai junto.
 */
import { useEffect } from "react";

const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{1,62}$/;

interface JanelaComSuporte extends Window {
  __crmWebchat?: boolean;
  __crmWebchatPrefill?: { name?: string; contact?: string };
}

/** Só um slug de organização válido liga o embed; vazio, indefinido ou lixo = desligado. */
export function slugDoSuporte(bruto: string | null | undefined): string | null {
  const slug = (bruto ?? "").trim();
  return SLUG_VALIDO.test(slug) ? slug : null;
}

export function SuporteEmbutido({ slug, nome, contato }: { slug: string; nome: string | null; contato: string }) {
  useEffect(() => {
    const janela = window as JanelaComSuporte;
    const prefill: { name?: string; contact?: string } = {};
    const nomeLimpo = (nome ?? "").trim();
    const contatoLimpo = contato.trim();
    if (nomeLimpo.length > 0) prefill.name = nomeLimpo;
    if (contatoLimpo.length > 0) prefill.contact = contatoLimpo;
    janela.__crmWebchatPrefill = prefill;

    const script = document.createElement("script");
    script.src = `/embed/${slug}.js`;
    script.async = true;
    script.dataset.suporteEmbutido = slug;
    document.body.appendChild(script);

    return () => {
      script.remove();
      document.getElementById("crm-webchat-balao")?.remove();
      document.getElementById("crm-webchat-janela")?.remove();
      delete janela.__crmWebchat;
      delete janela.__crmWebchatPrefill;
    };
  }, [slug, nome, contato]);
  return null;
}
