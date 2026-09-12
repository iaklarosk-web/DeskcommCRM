/**
 * GET /api/v1/cron/storage-redaction
 *
 * Drains the LGPD `storage_redaction_queue` (one batch per call). Designed
 * to run from a scheduled cron (Vercel Cron / external cron) every few
 * minutes. Idempotent: rows transition pending → deleted | failed | skipped.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fail-closed when
 * secret missing). Mirrors `app/api/v1/cron/kb-conversations-batch/route.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { drainStorageRedactionQueue } from "@/lib/lgpd/storage-redaction-queue";
import { registrarRequisicaoDe } from "@/src/obs/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";

  const cronSecret = env.INTERNAL_CRON_SECRET;
  const fallbackSecret = env.INTERNAL_SECRET;
  const accepted: string[] = [];
  if (cronSecret) accepted.push(cronSecret);
  if (fallbackSecret) accepted.push(fallbackSecret);

  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  // F06-T01: linha api.request da rota global de cron (sem organização por desenho).
  registrarRequisicaoDe(req, { scope: "cron", outcome: "allowed", request_id: requestId, status: 200 });

  // F06-T02: entrada por schema; inválido cai no padrão, como antes.
  const consulta = z
    .object({ limit: z.coerce.number().int().positive().optional() })
    .safeParse(Object.fromEntries(new URL(req.url).searchParams));
  const limit =
    consulta.success && consulta.data.limit !== undefined
      ? Math.min(consulta.data.limit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const stats = await drainStorageRedactionQueue({ limit });

  return ok(stats, { requestId });
}
