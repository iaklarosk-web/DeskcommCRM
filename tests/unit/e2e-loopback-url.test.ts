import { describe, expect, it } from "vitest";
import { isLoopbackHttpUrl } from "@/tests/lib/loopback-url";

describe("destino do sandbox E2E", () => {
  it("aceita somente endereços locais explícitos", () => {
    for (const value of [
      "http://localhost:55421",
      "http://127.0.0.1:55421/",
      "http://[::1]:55421",
    ]) {
      expect(isLoopbackHttpUrl(value)).toBe(true);
    }
  });
  it("recusa domínio disfarçado de prefixo localhost", () => {
    for (const value of [
      "http://localhost.example.test",
      "http://127.0.0.1.example.test",
      "http://localhost@remote.example.test",
    ]) {
      expect(isLoopbackHttpUrl(value)).toBe(false);
    }
  });
  it("recusa credenciais na URL, endereço privado remoto e esquemas inesperados", () => {
    for (const value of [
      "http://name:pass@localhost",
      "http://10.0.0.1",
      "https://remote.example.test",
      "file:///localhost",
      "",
      "localhost:55421",
    ]) {
      expect(isLoopbackHttpUrl(value)).toBe(false);
    }
  });
});
