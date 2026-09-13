// @vitest-environment node
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/webhooks/in/[token]/route";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { env as Environment } from "@/lib/env";

vi.mock("@/lib/env", async (original) => {
  const real = await original<{ env: typeof Environment }>();
  return { ...real, env: { ...real.env, UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" } };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
  return { from: () => query };
}) }));

it("limite HTTP usa contador real e recusa antes do banco", async () => {
  const token = "rate-limit-unit-boundary-1234";
  const post = (value: string) => POST(new NextRequest(`http://localhost/api/v1/webhooks/in/${value}`, { method: "POST" }), {
    params: Promise.resolve({ token: value }),
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-09T12:00:00Z"));
  try {
    for (let i = 1; i <= 59; i++) {
      expect(await checkRateLimit(`webhook_in:${token}`, 60, 60)).toMatchObject({ allowed: true, count: i });
    }
    // O 404 prova que o limite permitiu a busca da fonte no 60º pedido.
    expect((await post(token)).status).toBe(404);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    vi.mocked(createAdminClient).mockClear();
    const denied = await post(token);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect(await denied.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect((await post(`${token}-other`)).status).toBe(404);
    clock.mockReturnValue(Date.parse("2026-09-09T12:01:00Z"));
    expect((await post(token)).status).toBe(404);
  } finally { clock.mockRestore(); }
});
