/**
 * O acervo da organização visto pela tela de IA do `tenant_admin` (F04-T10,
 * §5.10).
 *
 * `GET` lista o que o tenant tem; `POST` recebe UM documento e o indexa na
 * hora. Os dois passam por `src/knowledge/` — nenhuma escrita solta em
 * `ai_knowledge_sources` mora aqui.
 *
 * ─── O que é política de BORDA e por isso mora nesta rota ─────────────────
 *
 * Tamanho do arquivo, extensão aceita e "isto é texto legível?" são perguntas
 * sobre o que chega pela rede, não sobre o acervo. `src/knowledge/ingestao.ts`
 * recebe TEXTO e não sabe o que é upload — é o que o mantém testável sem HTTP.
 *
 * Fase 1 aceita só texto puro (`.txt`, `.md`): extrair PDF exige o extrator
 * herdado (`lib/ai/rag/extractors/`) e a fila de indexação, que é o caminho do
 * agente de lead (`/app/ai/knowledge/sources`) e continua valendo para quem
 * precisa dele. A tela do tenant entrega o caso simples inteiro, síncrono e
 * verificável, em vez de um caso rico pela metade.
 */
import { getRequestId } from "@/lib/api/request-id";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  DocumentoGrandeDemais,
  DocumentoVazio,
  ingerirDocumento,
  listarAcervo,
} from "@/src/knowledge";
import type { TenantCtx } from "@/src/tenant-context";

export const dynamic = "force-dynamic";

/** Teto de bytes do arquivo. Texto puro; um manual inteiro cabe folgado. */
export const BYTES_MAXIMOS = 512 * 1024;

/** As extensões que esta rota sabe ler sem extrator externo. */
export const EXTENSOES_DE_TEXTO = [".txt", ".md"] as const;

function contexto(authz: Awaited<ReturnType<typeof requireRole>>): TenantCtx {
  if (!authz.ok) throw new Error("authz_required");
  return {
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    role: authz.org.role,
    source: "session",
  };
}

function extensaoAceita(nomeDoArquivo: string): boolean {
  const minusculo = nomeDoArquivo.toLowerCase();
  return EXTENSOES_DE_TEXTO.some((extensao) => minusculo.endsWith(extensao));
}

export async function GET(req?: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", {
    requestId,
    resource: "ai_knowledge",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  try {
    return ok(await listarAcervo(contexto(authz)), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler o acervo.", 500, { requestId });
  }
}

const formularioSchema = z.object({
  file: z.instanceof(File),
  name: z.string().max(4096).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const suporteNegado = await requireSupportWrite();
  if (suporteNegado) return suporteNegado;
  const authz = await requireRole("admin", {
    requestId,
    resource: "ai_knowledge",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;

  const formulario = await req.formData().catch(() => null);
  // F06-T02: o formulário passa por schema — arquivo obrigatório, nome opcional.
  const lido = formularioSchema.safeParse({
    file: formulario?.get("file") ?? undefined,
    name: formulario?.get("name") ?? undefined,
  });
  if (!lido.success) {
    return fail("validation_failed", "Envie um arquivo de texto.", 422, { requestId });
  }
  const arquivo = lido.data.file;
  const nomeInformado = lido.data.name;
  if (!extensaoAceita(arquivo.name)) {
    return fail(
      "validation_failed",
      `Formato não aceito aqui. Envie ${EXTENSOES_DE_TEXTO.join(" ou ")}.`,
      422,
      { requestId },
    );
  }
  if (arquivo.size > BYTES_MAXIMOS) {
    return fail("validation_failed", "Arquivo grande demais para esta tela.", 422, { requestId });
  }

  const nome =
    typeof nomeInformado === "string" && nomeInformado.trim().length > 0
      ? nomeInformado.trim().slice(0, 120)
      : arquivo.name.slice(0, 120);

  try {
    const material = await ingerirDocumento(contexto(authz), {
      nome,
      conteudo: await arquivo.text(),
    });
    return ok(material, { status: 201, requestId });
  } catch (erro) {
    if (erro instanceof DocumentoVazio) {
      return fail("validation_failed", "O arquivo não tem texto aproveitável.", 422, {
        requestId,
      });
    }
    if (erro instanceof DocumentoGrandeDemais) {
      return fail("validation_failed", "O documento tem trechos demais para esta tela.", 422, {
        requestId,
      });
    }
    return fail("internal_error", "Não foi possível indexar o documento.", 500, { requestId });
  }
}
