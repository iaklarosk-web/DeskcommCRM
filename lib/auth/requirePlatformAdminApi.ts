/**
 * A guarda de `platform_admin` para rotas de API (F20-T03).
 *
 * `requirePlatformAdmin()` foi desenhada para PÁGINAS: ela redireciona. Em rota
 * de API o redirect vira exceção, e o padrão que se espalhou foi
 * `try { … } catch { return fail("forbidden", "Platform admin required", 403) }`.
 * Esse catch engole tudo — inclusive a falha de infraestrutura.
 *
 * É o mesmo defeito que a produção mostrou em 21–22/09/2026 (VARREDURA §B25):
 * com o pool do PostgREST travado, a página dizia "Acesso negado … com MFA
 * ativo" a um platform_admin legítimo. A página foi consertada para FALHAR
 * ALTO; as rotas de API continuam com o catch genérico (15 delas, medidas em
 * 23/09) — este helper é o caminho certo para as novas, e a troca das antigas
 * está registrada em §B29.
 *
 * Aqui: negação continua 403; indisponibilidade vira **503 com o motivo**, que
 * é o que distingue "você não pode" de "não deu para saber".
 */
import { fail } from "@/lib/api/wrappers";
import { requirePlatformAdmin, type PlatformAdminContext } from "@/lib/auth/requirePlatformAdmin";

export type GuardaDeAdmin =
  | ({ ok: true } & PlatformAdminContext)
  | { ok: false; response: Response };

export async function requirePlatformAdminApi(requestId: string): Promise<GuardaDeAdmin> {
  try {
    const ctx = await requirePlatformAdmin();
    return { ok: true, ...ctx };
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    if (texto.includes("auth_permissions_unavailable")) {
      return {
        ok: false,
        response: fail(
          "upstream_unavailable",
          "Não foi possível verificar o seu acesso agora. Tente de novo em instantes.",
          503,
          { requestId },
        ),
      };
    }
    return { ok: false, response: fail("forbidden", "Platform admin required", 403, { requestId }) };
  }
}
