/**
 * F08-T06 — UM e-mail real ao PROPRIETÁRIO pela camada de e-mail do produto
 * (`lib/email/resend.ts`, a mesma dos convites e dos avisos de LGPD), dentro
 * do container do worker (env resolvido pelo compose). Destinatário =
 * `OWNER_EMAIL`, e só ele. A Resend responde o id do envio — é a evidência;
 * o corpo nunca é impresso. `scripts/prod/jornada-email.sh` chama isto depois
 * do `/auth/v1/recover` (o caminho SMTP do GoTrue).
 */
import { fromAddress, sendEmail } from "@/lib/email/resend";

async function main(): Promise<void> {
  const destino = (process.env.OWNER_EMAIL ?? "").trim();
  if (!destino) throw new Error("OWNER_EMAIL vazio: o único destinatário permitido é o proprietário");
  const from = fromAddress("CRM OS");
  if (!from) throw new Error("RESEND_FROM_EMAIL vazio (D12-5)");
  const quando = new Date().toISOString();
  const r = await sendEmail({
    to: destino,
    subject: `[CRM OS] F08-T06 — e-mail real da produção inicial (${quando.slice(0, 16)}Z)`,
    fromName: "CRM OS",
    text: `Este é o e-mail de prova da produção inicial do CRM OS (F08-T06), enviado pela Resend em ${quando}. Nenhuma ação é necessária.`,
    html: `<p>Este é o e-mail de prova da produção inicial do CRM OS (F08-T06), enviado pela Resend em ${quando}.</p><p>Nenhuma ação é necessária.</p>`,
    tags: [{ name: "fase", value: "f08-t06" }],
  });
  if (!r.ok || !r.id) {
    console.error(`email_api: FALHOU error=${r.error ?? "?"} details=${(r.details ?? "").slice(0, 120)}`);
    process.exit(1);
  }
  console.info(`email_api: ok id=${r.id} from=${from.replace(/^.*<(.*)>$/, "$1")} via=lib/email/resend.ts`);
}

void main();
