const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestWithHeaders = {
  readonly headers: Headers;
};

/**
 * Retorna o identificador validado que o proxy encaminhou à rota.
 * Chamadas diretas ao handler, sem proxy, continuam recebendo um UUID novo.
 */
export function getRequestId(request?: RequestWithHeaders): string {
  const incoming = request?.headers.get("x-request-id");
  return incoming && CANONICAL_UUID.test(incoming) ? incoming : crypto.randomUUID();
}
