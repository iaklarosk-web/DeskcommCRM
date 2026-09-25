/**
 * `GET /api/v1/billing/retorno?checkout=ok|cancelado` (F19-T05) — a PÁGINA-PONTE
 * da volta do Checkout do Stripe, pelo mesmo motivo da volta do Google
 * (`app/api/v1/agenda/google/callback/route.ts`): a navegação que sai de
 * `checkout.stripe.com` é cross-site, o cookie de sessão é `SameSite=Strict`
 * e não viaja nela — um redirect direto para `/app/billing` cairia em
 * `/login?next=…` com a pessoa logada. MEDIDO na bancada (Stripe falso em
 * outra origem): as sete jornadas de checkout paravam no login.
 *
 * A ponte responde 200 no nosso origin e o `location.replace` seguinte é
 * disparado por um documento nosso: initiator same-site ⇒ o cookie viaja.
 * Público por natureza (sem sessão ainda) e ancorado em `PUBLIC_PATHS`; o
 * único dado de fora é a allowlist `ok|cancelado` — o resto vira `ok`.
 * Não escreve nada: quem ativa é o webhook (D38).
 */
import { NextResponse, type NextRequest } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { env } from "@/lib/env";
import { registrarRequisicao } from "@/src/obs/log";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest): NextResponse {
  // Flag literal, validada por igualdade: qualquer outra coisa vira "ok".
  const checkout = req.nextUrl.searchParams.get("checkout") === "cancelado" ? "cancelado" : "ok";
  registrarRequisicao({ request_id: getRequestId(req), organization_id: null, scope: "unresolved", outcome: "accepted", path: "/api/v1/billing/retorno", method: "GET", status: 200 });
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const destino = new URL(`/app/billing?checkout=${checkout}`, base).toString();
  const seguro = destino.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return new NextResponse(
    `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex">` +
      `<noscript><meta http-equiv="refresh" content="0;url=${seguro}"></noscript>` +
      `<title>Voltando…</title></head><body>` +
      `<p>Voltando para a sua assinatura…</p>` +
      `<script>location.replace(${JSON.stringify(destino)})</script>` +
      `<noscript><p><a href="${seguro}">Continuar</a></p></noscript>` +
      `</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
