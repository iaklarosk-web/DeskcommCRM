import { dividirWordmark } from "@/lib/branding/wordmark";
import { ChatCircleDots } from "@/lib/ui/icons";

/**
 * A marca no alto das telas de acesso — padrão dos OS da KN: símbolo + nome.
 *
 * Duas fontes, de propósito, e não uma:
 * - `nome` vem de `branding()` (o `.env`), porque `tests/e2e/icone-da-marca.spec.ts`
 *   cruza este texto com o título da aba (que lê o BANCO). Trocar os dois para o
 *   mesmo resolvedor deixaria a spec verde medindo nada.
 * - `logoUrl` vem de `marcaDaSaida(null)` (banco acima, `.env` embaixo): é o
 *   logo da INSTALAÇÃO. O `data-testid="logo-da-fachada"` é lido por
 *   `tests/e2e/marca-logo.spec.ts`, que prova que o logo da EMPRESA não vaza
 *   para cá.
 *
 * Com logo, o símbolo padrão sai e o logo entra no lugar; o nome continua ao
 * lado, pela spec acima e porque logo pequeno sem nome não identifica ninguém.
 */
export function MarcaDaFachada({
  nome,
  logoUrl,
  logoAlt,
}: {
  nome: string;
  logoUrl: string | null;
  logoAlt: string;
}) {
  const { corpo, sufixo } = dividirWordmark(nome);
  return (
    <div className="flex items-center gap-2.5" data-testid="marca-da-fachada">
      {logoUrl ? (
        // <img> e não next/image: a URL é de quem hospeda e o next/image exige
        // allowlist de domínios fechada em build. Altura fixa, largura livre.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-testid="logo-da-fachada"
          src={logoUrl}
          alt={logoAlt}
          className="h-8 w-auto max-w-[10rem] object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"
        >
          <ChatCircleDots size={18} weight="bold" />
        </span>
      )}
      <span className="text-lg leading-none font-bold tracking-tight text-text">
        {corpo}
        {sufixo && (
          <>
            {" "}
            <span className="text-accent">{sufixo}</span>
          </>
        )}
      </span>
    </div>
  );
}
