/**
 * "TENTE NOVAMENTE" TEM DE SER UMA INSTRUÇÃO CUMPRÍVEL.
 *
 * 24/09/2026, produção: o convidado do `deka-sucos` criou a conta com sucesso
 * às 22:33 (vínculo de admin aceito no mesmo instante). Achando que havia
 * falhado, o proprietário emitiu um convite novo; o convidado tentou de novo às
 * 00:45 e 00:46 e leu *"Não foi possível criar a conta. Tente novamente."* nas
 * duas. Nenhuma quantidade de tentativas ia funcionar: a conta já existia. A
 * saída — o botão "Entrar", logo abaixo — não tinha como ser adivinhada.
 *
 * Por que a mensagem era vaga: no cadastro PÚBLICO, dizer "este e-mail já tem
 * conta" entrega a terceiros quem é cliente (enumeração). A regra que resolve
 * as duas coisas é o convite: quem chega com um convite VÁLIDO para aquele
 * e-mail já sabe que o e-mail existe — foi ele quem o recebeu. Ser específico
 * ali não conta nada a ninguém que já não saiba.
 */
const MARCAS_DE_JA_EXISTE = [
  "already been registered",
  "already registered",
  "user already exists",
  "email_exists",
];

export function contaJaExiste(
  erro: { message?: string; code?: string; status?: number } | null | undefined,
): boolean {
  if (!erro) return false;
  if (erro.code === "email_exists") return true;
  const texto = `${erro.code ?? ""} ${erro.message ?? ""}`.toLowerCase();
  return MARCAS_DE_JA_EXISTE.some((m) => texto.includes(m));
}
