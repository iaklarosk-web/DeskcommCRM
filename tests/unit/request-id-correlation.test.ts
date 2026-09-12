import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { getRequestId } from "@/lib/api/request-id";
import { proxy } from "@/proxy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

describe("correlação de request id", () => {
  it("ecoa um UUID canônico recebido do cliente", async () => {
    const response = await proxy(
      new NextRequest("https://crm.example/login", {
        headers: { "x-request-id": CLIENT_REQUEST_ID },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe(CLIENT_REQUEST_ID);
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(CLIENT_REQUEST_ID);
  });

  it("substitui um header inválido por UUID canônico", async () => {
    const response = await proxy(
      new NextRequest("https://crm.example/login", {
        headers: { "x-request-id": "request-id-invalido" },
      }),
    );
    const responseRequestId = response.headers.get("x-request-id");

    expect(responseRequestId).toMatch(UUID);
    expect(responseRequestId).not.toBe("request-id-invalido");
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(responseRequestId);
  });

  it("encaminha o mesmo UUID para resposta e rota sem expor cookies", async () => {
    const response = await proxy(
      new NextRequest("https://crm.example/login", {
        headers: { cookie: "theme=dark" },
      }),
    );
    const responseRequestId = response.headers.get("x-request-id");
    const forwardedRequestId = response.headers.get("x-middleware-request-x-request-id");

    expect(forwardedRequestId, "proxy não encaminhou x-request-id à rota").toBe(responseRequestId);
    const routeRequestId = getRequestId({
      headers: new Headers({ "x-request-id": forwardedRequestId! }),
    });
    expect({ responseRequestId, routeRequestId }).toEqual({
      responseRequestId: expect.stringMatching(UUID),
      routeRequestId: responseRequestId,
    });

    expect(response.headers.get("x-pathname")).toBe("/login");
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/login");
    expect(response.headers.get("x-middleware-request-cookie")).toBe("theme=dark");
    expect(response.headers.get("cookie")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("gera UUID canônico quando o handler é chamado sem proxy", () => {
    expect(getRequestId()).toMatch(UUID);
    expect(
      getRequestId({ headers: new Headers({ "x-request-id": "request-id-invalido" }) }),
    ).toMatch(UUID);
  });
});
