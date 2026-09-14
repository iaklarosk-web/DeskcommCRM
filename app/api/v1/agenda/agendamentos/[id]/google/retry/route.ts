import { requireSupportWrite } from "@/lib/impersonate/support";
import { POST as resolve } from "../resolver/route";
import { registrarRequisicaoDe } from "@/src/obs/log";
/** Retentativa usa exatamente as mesmas guardas; nunca faz HTTP no request humano. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  // F06-T01: o tenant é resolvido pelo resolver delegado (que loga por conta
  // própria); esta linha registra a entrada da retentativa.
  registrarRequisicaoDe(req, { outcome: "accepted", scope: "unresolved" });
  const body: unknown = await req.json().catch(() => null);
  return resolve(
    new Request(req, {
      body: JSON.stringify({
        ...(typeof body === "object" && body !== null ? body : {}),
        choice: "retry",
      }),
    }),
    context,
  );
}
