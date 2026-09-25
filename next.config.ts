import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

import { CABECALHOS_DE_SEGURANCA } from "./lib/http/cabecalhos-de-seguranca";

/** Performance budget (EPIC-12 §S-12.05):
 *  - LCP < 2.5s p75
 *  - CLS < 0.1 p75
 *  - INP < 200ms p75
 *  - Initial bundle /app/inbox < 250KB gzipped
 */
const nextConfig: NextConfig = {
  // Self-host: gera .next/standalone pro container Docker (node server.js).
  // Na Vercel (VERCEL=1) fica desligado — Next 16.3 + adapter + standalone
  // quebra o onBuildComplete com ENOENT next-server.js.nft.json (#96646).
  output: process.env.VERCEL ? undefined : "standalone",
  /**
   * O `standalone` copia SÓ o que o file tracing detecta — e ele não detecta
   * tudo de `@swc/helpers`.
   *
   * Medido no build da `main`: o pacote real tem 108 arquivos em `esm/`, e o
   * standalone levava **2**. Em runtime o Node pedia
   * `@swc/helpers/esm/_interop_require_default`, não achava, e o container
   * subia em crashloop com `MODULE_NOT_FOUND` — a imagem construía, publicava e
   * só morria ao dar `docker compose up` na VPS.
   *
   * Não aparecia no `next@16.3.0`: aquela versão resolvia o helper pelo CJS. O
   * bump para `16.3.1` passou a resolvê-lo por `exports`/ESM, e o buraco do
   * trace virou falha dura. Como o helper é injetado pelo COMPILADOR (nenhum
   * arquivo nosso o importa), não há import para o trace seguir — a inclusão
   * precisa ser declarada.
   *
   * O glob passa pelo layout do pnpm (`.pnpm/@swc+helpers@<versão>/…`) porque é
   * onde o pacote realmente mora aqui; o `*` cobre o bump de versão seguinte
   * sem exigir que alguém lembre de editar esta linha.
   */
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**"],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes moved out of experimental in Next 15.5+
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react", "date-fns"],
  },
  images: {
    // O app não usa next/image de fato (só <img> raw); desligar o otimizador
    // evita exigir o binário `sharp` no runtime do container.
    unoptimized: true,
    remotePatterns: [
      // Supabase Storage (assinado)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  // As regras moram em `lib/http/cabecalhos-de-seguranca.ts` para a suíte
  // medi-las com o casador do próprio Next (F24: `X-Frame-Options: DENY` não
  // alcança `/chat/<slug>` nem `/embed/<slug>.js` — quem decide a moldura da
  // página do chat é o `frame-ancestors` que a rota emite por organização).
  async headers() {
    return CABECALHOS_DE_SEGURANCA.map((regra) => ({ source: regra.source, headers: regra.headers.map((h) => ({ ...h })) }));
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "automatik-labs",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
