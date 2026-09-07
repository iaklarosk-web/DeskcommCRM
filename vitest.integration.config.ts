import path from "node:path";
import { defineConfig } from "vitest/config";

// Config da suíte de integração (tests/integration/**) — F01-T02.
// Roda SÓ via `pnpm test:integration` (scripts/test-integration.sh), que sobe o
// Postgres efêmero com o baseline e exporta TEST_DB_*. Herda da suíte de
// invariantes o isolamento que tira a ordem do veredito: um arquivo por vez e
// banco NOVO por arquivo (mesmo setupFile; ver vitest.db.config.ts para o
// racional medido da issue #207).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ["./tests/db/banco-limpo-por-arquivo.ts"],
    // Mesmos stubs da suíte db: imports transitivos de lib/env não podem
    // derrubar a suíte por env obrigatória ausente. Nenhum teste daqui fala
    // com Supabase por REST — a conexão é pg cru no TEST_DB_PORT.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY:
        "test-service-role-key-not-a-placeholder-1234567890-1234567890",
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
