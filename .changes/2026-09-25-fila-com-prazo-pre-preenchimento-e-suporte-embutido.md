---
impacto: capacidade_nova
secao: adicionado
titulo: Fila com prazo de retorno, pré-preenchimento do visitante, temas proibidos na tela e o chat de suporte embutido no produto
---

Para o suporte da KN dentro dos próprios sistemas (uma organização por
produto), o chat do site ganhou:

- **Fila com prazo, por organização** (Configurações › Chat do site): em vez
  de "Sua conversa está na fila para um atendente", o visitante pode ler
  "Recebemos sua pergunta. {empresa} responde por {contato} em até {prazo}".
  O padrão continua a frase antiga; quem quer o retorno combinado escolhe na
  tela e define o prazo (padrão "1 dia útil").
- **Pré-preenchimento**: o site que embute o chat pode definir
  `window.__crmWebchatPrefill = { name, contact }` antes do script; os campos
  chegam preenchidos e continuam editáveis. A identidade continua declarada,
  não autenticada.
- **Temas proibidos na tela de IA**: um por linha; mensagem que toca num deles
  vai para uma pessoa. Antes só dava para gravar pela API.
- **Chat de suporte dentro da área logada**: com `SUPPORT_WEBCHAT_SLUG` no
  `.env` apontando para a organização de suporte, o produto embute o próprio
  chat com nome e e-mail de quem está logado. Vazia (o padrão), nada muda.
- **Casos em espera, todas as organizações**: `GET /api/admin/handoffs`, com o
  mesmo bearer de `GET /api/admin/summary`, lista as conversas que esperam
  uma pessoa, com o link do inbox — só leitura, para a rotina de aviso do dono.
