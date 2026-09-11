/**
 * HMAC do webhook WAHA — módulo-folha, pelo mesmo motivo de `jid.ts`.
 *
 * `lib/waha/webhook-auth.ts` precisava só desta função e a importava de
 * `ingest.ts`, que arrasta efeitos pós-entrada e, por transitividade,
 * `@react-pdf/renderer`. Como `src/channels/waha.ts` -> `webhook-auth.ts` está
 * no caminho de import do worker de saída, essa cadeia impedia o worker de
 * subir como processo solto (G-71). Aqui só entram `node:crypto` e nada mais.
 *
 * Comparação em tempo constante de propósito: `===` sobre a assinatura vaza,
 * pelo tempo, quantos bytes iniciais o atacante acertou.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyHmacSha512(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const got = signatureHeader.replace(/^sha512=/i, "").trim();
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
