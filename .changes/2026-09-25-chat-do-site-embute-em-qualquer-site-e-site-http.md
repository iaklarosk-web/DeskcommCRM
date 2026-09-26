---
impacto: nada_mudou
secao: corrigido
titulo: O chat do site abre em qualquer site que o embute, inclusive site http, e responde mesmo com só rascunhos de agente
---

Três defeitos do chat do site, achados num teste visual em produção:

- O script `/embed/<slug>.js` montava o iframe com o endereço interno do
  servidor (`0.0.0.0:3000`) quando o app roda atrás do proxy. O balão aparecia
  no site do cliente e o clique abria uma janela em branco. Agora o script usa
  a origem pública da requisição (o que o proxy encaminhou, depois o `Host`,
  depois `NEXT_PUBLIC_APP_URL`). A página do chat também deixou de receber o
  `X-Frame-Options: DENY` global — quem decide quais sites podem embuti-la é o
  `frame-ancestors` por organização, como sempre foi a intenção.
- Em site **http**, o envio da mensagem falhava sempre com "Não foi possível
  enviar": o navegador não oferece `crypto.randomUUID` fora de contexto seguro
  e o id da mensagem saía inválido. A página gera UUID por outro caminho, e os
  avisos passaram a distinguir "sem conexão" de "a mensagem não foi aceita".
- Uma organização que só tinha **rascunhos** de agente (criados e nunca
  publicados) ficava em silêncio: o portão do worker contava o rascunho como
  "tem agente" e pulava o turno. Agora só conta agente que já foi publicado;
  pausar continua parando o gasto.

Nada a fazer na instalação.
