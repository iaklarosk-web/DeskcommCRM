-- F15-T02 — o aviso `ai.limit_reached` entra no vocabulário de notificações
-- (ADR-036 §2 T02, D54 c).
-- Timestamp criado à mão na sequência da 9027; arquivo aplicado é imutável.
--
-- ─── O que este arquivo acrescenta ──────────────────────────────────────────
--
-- O limite diário de turnos por organização (`ai.limits.daily_turns`, em
-- `tenant_settings`) pausa a IA ao ser atingido; quem administra a organização
-- precisa saber, e o aviso é o 10º evento de §5.16 (a 9021 criou seis, a 9023
-- recriou com nove). Os CHECKs `notifications_event_check` e
-- `email_outbox_event_check` são reconstruídos em UM bloco só, por ADIÇÃO
-- (nenhuma linha atual passa a violar; a lição da 0175 continua valendo).
--
-- Nenhuma tabela nova, nenhuma policy nova. Grants explícitos ao fim (G-54).
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon. Prova: tests/unit/f05-t05-notificacoes-so-aqui.test.ts
-- (a ÚLTIMA definição do CHECK na cadeia lista exatamente o enum) e
-- tests/integration/f05-notificacoes.test.ts (um aviso e um e-mail por evento).

alter table public.notifications drop constraint if exists notifications_event_check;
alter table public.notifications add constraint notifications_event_check
  check (event in (
    'handoff.created','task.assigned','confirmation.requested',
    'customer.replied_while_human','reminder.no_reply','job.blocked',
    'subscription.payment_failed','subscription.blocked','subscription.activated',
    'ai.limit_reached'
  ));

alter table public.email_outbox drop constraint if exists email_outbox_event_check;
alter table public.email_outbox add constraint email_outbox_event_check
  check (event in (
    'handoff.created','task.assigned','confirmation.requested',
    'customer.replied_while_human','reminder.no_reply','job.blocked',
    'subscription.payment_failed','subscription.blocked','subscription.activated',
    'ai.limit_reached'
  ));

-- Grants explícitos (G-54): as duas tabelas são service_only desde a 9021;
-- nada muda, só fica dito.
revoke all on table public.notifications from anon;
revoke all on table public.email_outbox from anon;

do $f15_t02_fim$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['notifications', 'email_outbox'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = ('public.' || v_tabela)::regclass and conname = v_tabela || '_event_check'
                      and pg_get_constraintdef(oid) like '%''ai.limit_reached''%') then
      raise exception '%_event_check não aceita ai.limit_reached', v_tabela;
    end if;
  end loop;
end
$f15_t02_fim$;

notify pgrst, 'reload schema';
