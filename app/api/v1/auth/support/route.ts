import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readSupportContext } from "@/lib/impersonate/support";
import { ok, fail } from "@/lib/api/wrappers";
import { registrarRequisicaoDe } from "@/src/obs/log";
export async function GET(req?: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return fail("unauthenticated", "Entre novamente.", 401);
  const support = await readSupportContext(db);
  // F06-T01: assinatura da sessão de suporte — a organização é a acompanhada, se houver.
  registrarRequisicaoDe(req ?? { headers: new Headers(), method: "GET" }, {
    outcome: "allowed",
    organization_id: support?.organization_id ?? null,
    scope: "unresolved",
    actor_id: user.id,
    status: 200,
  });
  return ok({ signature: support ? `${support.id}:${support.access_mode}:${support.status}` : "normal" });
}
