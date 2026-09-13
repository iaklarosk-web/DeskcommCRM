# Efeitos e limpeza da prova F02 diária/conferência

Esta prova só usa o sandbox descartável guardado por `f02E2eSandbox()`: URL
loopback, marcador `F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable` e service
role fornecidos pelo runner. Não inicia serviços, não envia mensagens, não
chama IA, filas, workers, cobrança nem qualquer endpoint externo.

Cada jornada A/B cria dois usuários e duas organizações fictícias. Na organização alvo da jornada cria três pedidos confirmados com 200 + 200 + 101 itens, além de
eventos e recibos de conferência. A impressão usa o DTO já carregado. O PDF Chromium é obrigatório: a extração com pdfjs verifica todas as 501 linhas e mais de uma página.

O `finally` chama `cleanupF02Orders()`. Após o cascade de organização, a prova
conta zero em `crm_orders`, `crm_order_check_events` e
`crm_order_check_command_receipts`. O anexo `sandbox-cleanup` registra as
contagens; qualquer erro ou linha restante reprova a jornada. O gate só pode
registrar `daily_checks_e2e: pass=2/2` com as duas jornadas concluídas.
