# ADR-049 — F23: identidade visual própria do CRM OS

**Data:** 2026-09-25 · **Estado:** aceito · **Fase:** F23 · Decisões do proprietário em mensagens de 25/09 (§3).

## Contexto

O produto herdou do DeskcommCRM a identidade visual inteira: paleta Sage sobre
neutros greige, barra lateral clara e uma tela de entrar centrada, sem marca e
sem apresentação. Os outros OS da KN (PDV, Oferta, Transportes, Marketing)
seguem um molde só na tela de entrar — formulário à esquerda, painel escuro de
apresentação à direita em tela larga — e dois deles usam trilho lateral escuro.
O proprietário pediu, em 25/09, a primeira tela "igual aos outros OS" e uma
estética própria para o sistema inteiro.

A estrutura herdada é boa e fica: tokens em `app/globals.css` com temas claro
e escuro desenhados separadamente, régua de contraste extraída do próprio CSS
(`lib/branding/contraste.ts`), marca da instalação por camadas, densidade
Aerada, Atkinson Hyperlegible para texto e IBM Plex Mono para dado. O que muda
é o que se vê, não como se mede.

## Decisão

1. **Paleta "Marinho & Turquesa"** (direção B da prancha de 25/09): tinta
   azul-marinho, neutros areia quentes no claro e marinho no escuro, turquesa
   como cor de ação. A rampa do accent é `rampaDeSemente("#0b7374")`, a mesma
   derivação que a Sage usava — 11 paradas, accent no 600 (claro) e no 400
   (escuro). Estados (success, warning, error, info) ficam como estavam.
2. **Tipografia mantida**: Atkinson Hyperlegible e IBM Plex Mono. A Manrope da
   KN foi considerada e recusada pelo proprietário: a Atkinson distingue 0/O
   e 1/l, o que importa num CRM.
3. **Trilho lateral escuro nos dois temas**, como PDV e Oferta: um escopo de
   tokens `[data-trilho="escuro"]` no `globals.css`, aplicado ao `<aside>` da
   barra e à folha do celular. Nenhuma classe `dark:` nos filhos.
4. **Marca no padrão dos OS**: símbolo + nome tipográfico, com o sufixo "OS"
   em accent quando vem maiúsculo e separado por espaço
   (`lib/branding/wordmark.ts`). Sem símbolo próprio por enquanto.
5. **Tela de entrar no molde da casa** (commit `269bd60f9`): casca
   `app/(public)/layout.tsx`, painel `PainelDeApresentacao` com preço vindo de
   `plans` (D14) e trial de `BILLING_TRIAL_DAYS`. Cadastro, recuperação e MFA
   herdam a casca.
6. **Sem redesenho de telas.** A troca chega às 150 telas pelos tokens. As
   classes de cor escritas à mão que sobraram (amber, red, emerald, yellow)
   são semânticas — aviso, erro, sucesso, faixa da plataforma — e valem em
   qualquer paleta; não foram tocadas.

## Consequências medidas

- Régua (`extrairRegua` sobre o CSS novo): os mesmos 6 papéis por tema, 18 pares
  no claro e 26 no escuro, **0 reprovas**. Accent sobre fundo 5,13:1; anel de
  foco 3,53:1 sobre o fundo e 3,20:1 sobre a superfície elevada (piso 3,0).
- Agenda: a accent nova (196°) engoliu duas trilhas de pessoa. Trilha 4 virou
  verde `#3a9460` (155°, ΔE 0,122 da accent) e trilha 5 azul `#1f6fb0` (248°,
  ΔE 0,108); pior par entre trilhas 0,1122 (antes 0,1192). No escuro só a
  trilha 4 mudou (`#45c78a`). Faixa vetada passa a 175–215°.
- `--color-info` fica a ΔE simulado 0,036 da accent no tema escuro (piso da
  reconciliação 0,05). Não há teste do produto sobre isso; info sempre carrega
  ícone. Fica registrado como o ponto mais próximo da paleta.
- `lib/branding/regua-do-produto.ts` regenerada; os três literais de
  `branding-contraste.test.ts` que mediam a Sage à mão foram remedidos.
- O showcase `/design` ganha a paleta `marinho` como padrão; a Sage continua
  lá como herança.

## Decisões do proprietário (§3)

25/09/2026, em resposta às sete perguntas da prancha: primeira tela = login;
direção B; manter Atkinson e Plex Mono; trilho escuro sim; textos, preço e
trial na tela pública sim; sem símbolo, padrão dos OS; escopo do sistema por
recomendação do agente (aceita: tokens + trilho + varredura, sem redesenho).
