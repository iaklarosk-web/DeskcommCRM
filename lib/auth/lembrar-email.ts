/**
 * "Lembrar meu e-mail neste aparelho" — a tela de entrar guarda SÓ o e-mail,
 * no `localStorage` deste navegador, para preencher o campo na próxima visita.
 *
 * O que fica de fora, de propósito: a SENHA. Guardar senha em storage do
 * navegador pelo nosso código é a mesma coisa que deixá-la num arquivo de
 * texto que qualquer script da página lê; quem guarda senha é o gerenciador
 * do navegador, e o formulário já o aciona (`autocomplete="current-password"`).
 *
 * Toda leitura e escrita vai em try/catch (G-07): janela privada, storage
 * bloqueado ou cota estourada não podem derrubar a única tela por onde se
 * entra. Sem storage, a tela funciona como se ninguém tivesse marcado nada.
 */
const CHAVE = "deskcomm-lembrar-email";
const TAMANHO_MAXIMO = 254; // RFC 5321: um endereço não passa disso

export function lerEmailLembrado(): string | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const limpo = bruto.trim();
    // Valor corrompido ou plantado (sem `@`, longo demais) não preenche campo nenhum.
    if (limpo.length === 0 || limpo.length > TAMANHO_MAXIMO || !limpo.includes("@")) return null;
    return limpo;
  } catch {
    return null;
  }
}

export function lembrarEmail(email: string): void {
  try {
    const limpo = email.trim();
    if (limpo.length === 0 || limpo.length > TAMANHO_MAXIMO) return;
    window.localStorage.setItem(CHAVE, limpo);
  } catch {
    // storage indisponível: a tela segue sem lembrar, e sem erro na cara de quem entra
  }
}

export function esquecerEmail(): void {
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
}
