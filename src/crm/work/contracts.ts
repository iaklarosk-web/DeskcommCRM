import { z } from "zod";

const uuid = z.uuid().transform((id) => id.toLowerCase());
const priority = z.enum(["low", "medium", "high", "urgent"]);
const status = z.enum(["pending", "in_progress", "done", "cancelled"]);
const nullableDescription = z.string().max(5000).nullable().optional();
const nullableDueDate = z.string().datetime({ offset: true }).nullable().optional();

const commandBase = z.strictObject({ command_id: uuid });

export const linkedTaskCommandSchema = z.discriminatedUnion("command", [
  commandBase.extend({
    command: z.literal("create_linked_task"),
    order_id: uuid,
    title: z.string().trim().min(1).max(255),
    description: nullableDescription,
    due_date: nullableDueDate,
    priority: priority.default("medium"),
    assigned_to: uuid.nullable().optional(),
  }),
  commandBase
    .extend({
      command: z.literal("edit_linked_task"),
      task_id: uuid,
      expected_revision: z.number().int().positive(),
      title: z.string().trim().min(1).max(255).optional(),
      description: nullableDescription,
      due_date: nullableDueDate,
      priority: priority.optional(),
      assigned_to: uuid.nullable().optional(),
    })
    .refine(
      ({
        command: _command,
        command_id: _commandId,
        task_id: _taskId,
        expected_revision: _rev,
        ...edit
      }) => Object.keys(edit).length > 0,
      { message: "Nada para alterar." },
    ),
  commandBase.extend({
    command: z.literal("set_linked_task_status"),
    task_id: uuid,
    expected_revision: z.number().int().positive(),
    status,
  }),
]);

export type LinkedTaskCommand = z.infer<typeof linkedTaskCommandSchema>;
export type LinkedTaskCommandResult = {
  task_id: string;
  task_revision: number;
  status: z.infer<typeof status>;
};

export const createCrmNoteSchema = z.strictObject({
  id: uuid,
  contact_id: uuid,
  order_id: uuid.nullable().optional(),
  body: z.string().trim().min(1).max(4096),
});
export type CreateCrmNote = z.infer<typeof createCrmNoteSchema>;
