import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TEST_DB_PORT inválido");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260909191659_9009_crm_tarefas_legado_seguro.sql"),
  "utf8",
);

type QueryOutcome =
  | { side: "task" | "contact"; ok: true }
  | { side: "task" | "contact"; ok: false; error: Error & { code?: string } };

async function waitUntilBlocked(blockedPid: number, blockerPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(
      "select $2::integer = any(pg_blocking_pids($1::integer)) as blocked",
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("anonimização não bloqueou na tarefa dentro de 5s");
}

afterAll(async () => pool.end());

describe.sequential("segurança de tarefas legadas no upgrade", () => {
  it("reverte reparo, audit, trigger e FK juntos quando o audit falha", async () => {
    const orgA = "f0300002-0000-4000-8000-000000000001";
    const orgB = "f0300002-0000-4000-8000-000000000002";
    const contactB = "f0300002-1000-4000-8000-000000000001";
    const taskA = "f0300002-2000-4000-8000-000000000001";

    await pool.query(
      `insert into organizations(id,slug,legal_name,display_name) values
        ($1,'t03-safety-a','T03 Safety A','T03 Safety A'),
        ($2,'t03-safety-b','T03 Safety B','T03 Safety B')`,
      [orgA, orgB],
    );
    await pool.query(
      "insert into contacts(id,organization_id,display_name) values($1,$2,'Contato B')",
      [contactB, orgB],
    );
    await pool.query("alter table crm_tasks drop constraint crm_tasks_contact_tenant_fkey");
    await pool.query("drop trigger trg_crm_tasks_guard_anonymized_contact on crm_tasks");
    await pool.query(
      `insert into crm_tasks(id,organization_id,title,description,contact_id)
       values($1,$2,'Texto deve sobreviver à falha','Descrição deve sobreviver',$3)`,
      [taskA, orgA, contactB],
    );
    await pool.query(`
      create function public.test_f02_reject_legacy_repair_audit()
      returns trigger language plpgsql as $$
      begin
        if new.action='crm_task.updated'
           and new.metadata->>'reason'='cross_tenant_legacy_contact' then
          raise exception 'legacy repair audit failure probe';
        end if;
        return new;
      end $$;
      create trigger test_f02_reject_legacy_repair_audit
      before insert on public.api_audit_log
      for each row execute function public.test_f02_reject_legacy_repair_audit();
    `);

    try {
      await expect(pool.query(migration)).rejects.toThrow("legacy repair audit failure probe");
      const unchanged = await pool.query(
        `select contact_id,title,description from crm_tasks
          where organization_id=$1 and id=$2`,
        [orgA, taskA],
      );
      expect(unchanged.rows).toEqual([
        {
          contact_id: contactB,
          title: "Texto deve sobreviver à falha",
          description: "Descrição deve sobreviver",
        },
      ]);
      const catalog = await pool.query<{ fk: boolean; guard: boolean; audits: number }>(
        `select
          exists(select 1 from pg_constraint where conrelid='crm_tasks'::regclass
            and conname='crm_tasks_contact_tenant_fkey') fk,
          exists(select 1 from pg_trigger where tgrelid='crm_tasks'::regclass
            and tgname='trg_crm_tasks_guard_anonymized_contact' and not tgisinternal) guard,
          (select count(*)::int from api_audit_log where resource_id=$1
            and metadata->>'reason'='cross_tenant_legacy_contact') audits`,
        [taskA],
      );
      expect(catalog.rows[0]).toEqual({ fk: false, guard: false, audits: 0 });
    } finally {
      await pool.query("drop trigger test_f02_reject_legacy_repair_audit on api_audit_log");
      await pool.query("drop function public.test_f02_reject_legacy_repair_audit()");
      await pool.query(migration);
    }

    const repaired = await pool.query(
      `select contact_id,title,description from crm_tasks
        where organization_id=$1 and id=$2`,
      [orgA, taskA],
    );
    expect(repaired.rows).toEqual([
      {
        contact_id: null,
        title: "Texto deve sobreviver à falha",
        description: "Descrição deve sobreviver",
      },
    ]);
  });

  it("corrida UPDATE de tarefa versus anonimização nunca confirma contato anonimizado com PII", async () => {
    const org = "f0300002-3000-4000-8000-000000000001";
    const contact = "f0300002-3100-4000-8000-000000000001";
    const task = "f0300002-3200-4000-8000-000000000001";
    await pool.query(
      "insert into organizations(id,slug,legal_name,display_name) values($1,'t03-safety-race','T03 Safety Race','T03 Safety Race')",
      [org],
    );
    await pool.query(
      "insert into contacts(id,organization_id,display_name) values($1,$2,'Titular da corrida')",
      [contact, org],
    );
    await pool.query(
      "insert into crm_tasks(id,organization_id,title,description,contact_id) values($1,$2,'Texto inicial','Descrição inicial',$3)",
      [task, org, contact],
    );

    const taskClient = await pool.connect();
    const contactClient = await pool.connect();
    try {
      await taskClient.query("begin");
      await contactClient.query("begin");
      await taskClient.query("set local deadlock_timeout='100ms'");
      await contactClient.query("set local deadlock_timeout='100ms'");
      const taskPid = (await taskClient.query<{ pid: number }>("select pg_backend_pid() pid"))
        .rows[0]!.pid;
      const contactPid = (await contactClient.query<{ pid: number }>("select pg_backend_pid() pid"))
        .rows[0]!.pid;

      await taskClient.query("select id from crm_tasks where id=$1 for update", [task]);
      const contactQuery = contactClient
        .query(
          "update contacts set is_anonymized=true,anonymized_at=clock_timestamp() where id=$1",
          [contact],
        )
        .then<QueryOutcome>(() => ({ side: "contact", ok: true }))
        .catch<QueryOutcome>((error: Error & { code?: string }) => ({
          side: "contact",
          ok: false,
          error,
        }));

      await waitUntilBlocked(contactPid, taskPid);
      const taskQuery = taskClient
        .query(
          "update crm_tasks set title='PII concorrente',description='PII concorrente' where id=$1",
          [task],
        )
        .then<QueryOutcome>(() => ({ side: "task", ok: true }))
        .catch<QueryOutcome>((error: Error & { code?: string }) => ({
          side: "task",
          ok: false,
          error,
        }));

      const first = await Promise.race([taskQuery, contactQuery]);
      expect(first.ok, "o primeiro desfecho precisa ser a vítima do deadlock").toBe(false);
      if (first.ok) throw new Error("corrida terminou sem detectar o ciclo de locks");
      expect(first.error.code).toBe("40P01");

      if (first.side === "task") {
        await taskClient.query("rollback");
        expect(await contactQuery).toMatchObject({ side: "contact", ok: true });
        await contactClient.query("commit");
      } else {
        await contactClient.query("rollback");
        expect(await taskQuery).toMatchObject({ side: "task", ok: true });
        await taskClient.query("commit");
      }
    } finally {
      await taskClient.query("rollback").catch(() => undefined);
      await contactClient.query("rollback").catch(() => undefined);
      taskClient.release();
      contactClient.release();
    }

    const finalState = await pool.query<{
      is_anonymized: boolean;
      title: string;
      description: string | null;
    }>(
      `select c.is_anonymized,t.title,t.description
         from contacts c
         join crm_tasks t on t.organization_id=c.organization_id and t.contact_id=c.id
        where c.id=$1 and t.id=$2`,
      [contact, task],
    );
    expect(finalState.rows).toHaveLength(1);
    const row = finalState.rows[0]!;
    expect(
      !row.is_anonymized || (row.title === "Tarefa anonimizada" && row.description === null),
      "corrida confirmou contato anonimizado com PII na tarefa",
    ).toBe(true);
  });
});
