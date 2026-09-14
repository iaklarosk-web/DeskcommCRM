# ADR-009 — Entrega final comercial e entrevista do proprietário

## Contexto
A diretriz original detalhava o piloto até staging, mas chamava a expansão de Fase 2 sem decompor a entrega comercial. Em 08/09/2026 o proprietário pediu que o projeto entendesse o que significa estar completamente pronto. As respostas abaixo são requisitos; sugestões de custo e profundidade de módulos permanecem propostas.

## Decisão
- Entrega final: SaaS online comercial com marca do proprietário, seu login/painel de administração da plataforma e logins próprios dos clientes. O cliente ganha acesso operacional após confirmação de assinatura/pagamento.
- Onboarding completo pela plataforma: cadastro, contratação, conexão WhatsApp e configuração guiada de IA; ajuda opcional.
- Primeiro CRM completo e versátil. Segmentos ainda não escolhidos. ERP e adjacentes serão avaliados depois, inclusive como projetos separados que se comunicam com o CRM.
- Autonomia de IA configurável por empresa/ação, com execução permitida, aprovação humana e transferência/bloqueio. Conservar limites de autorização e auditoria.
- Primeira versão comercial: WhatsApp e chat do site, com agenda de clientes/equipe dentro do CRM e Google Agenda sincronizada. Demais canais podem vir depois. E-mail transacional continua necessário à autenticação e cobrança.
- Deka não usará API oficial agora. WAHA segue no piloto.
- A data que organiza os pedidos do dia ainda deve ser confirmada com a Deka; o proprietário pediu expressamente mantê-la como pendência. Não assumir criação, produção ou entrega como regra operacional aprovada.
- Atraso de assinatura: aviso e prazo de regularização, seguido de bloqueio de novas operações; preservar dados e acesso à cobrança. Dias de carência ainda não escolhidos.
- Prazo desejado: começar o quanto antes; nenhuma data calendário foi fixada. O proprietário pediu recomendação de orçamento mensal para revisar depois; os valores recomendados não autorizam gastos nem contratam serviços.
- Ampliar a diretriz para F00–F17, preservando IDs F00–F07 e o gate comercial da segunda empresa. F07 é marco técnico; F17 é aceite comercial da versão. F02 ganha T10–T13 para lista, impressão, conferência e prova integrada.

## Alternativas rejeitadas
- Tratar o piloto Deka ou uma aplicação em staging como SaaS comercial concluído.
- Exigir Instagram/e-mail de entrada para o primeiro aceite, contrariando a prioridade informada.
- Escolher nicho, preço, gateway, dias de carência, detalhes de sincronização ou orçamento sem resposta do proprietário.
- Liberar CRM apenas pela página de retorno do checkout, sem confirmação confiável do pagamento.

## Consequências
F11/F12 precisam fechar juntas administração, onboarding e ativação paga. F14 cobre os canais confirmados e agenda; a F15 entrega autonomia configurável. Escopo de white-label por tenant, templates e domínios por cliente será definido antes da F16: a marca da plataforma está confirmada, revenda com marca de cada cliente ainda não. Datas, orçamento, planos/preços, dias de carência, regras detalhadas de agenda e metas do piloto permanecem decisões abertas. Esta atualização registra planejamento, sem construir todo o SaaS nem autorizar produção.

## Data
2026-09-08

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-009-entrega-comercial-e-entrevista.md`).
