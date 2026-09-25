import { describe, expect, it } from "vitest";

import { podeRemover, podeMudarPapel, type MembroDaOrganizacao } from "./politica";

const A: MembroDaOrganizacao = { user_id: "a", role: "admin" };
const B: MembroDaOrganizacao = { user_id: "b", role: "admin" };
const C: MembroDaOrganizacao = { user_id: "c", role: "agent" };

describe("política da equipe — a organização nunca fica sem admin", () => {
  it("remover o ÚLTIMO admin é recusado com motivo nomeado", () => {
    // O estado exato de um tenant de cliente cujo segundo admin ainda não aceitou.
    expect(podeRemover([A, C], "a")).toEqual({ ok: false, recusa: "ultimo_admin" });
  });

  it("REBAIXAR o último admin é recusado — mesma órfã, outra porta", () => {
    expect(podeMudarPapel([A, C], "a", "manager")).toEqual({ ok: false, recusa: "ultimo_admin" });
  });

  it("com DOIS admins, sair é permitido — foi o caso real de 25/09", () => {
    expect(podeRemover([A, B, C], "a")).toEqual({ ok: true });
    expect(podeMudarPapel([A, B, C], "a", "agent")).toEqual({ ok: true });
  });

  it("CONTROLE — remover quem NÃO é admin nunca esbarra na regra", () => {
    // Sem este caso, uma regra grosseira demais travaria a remoção de qualquer
    // pessoa numa empresa de um admin só.
    expect(podeRemover([A, C], "c")).toEqual({ ok: true });
  });

  it("CONTROLE — membro inexistente e papel igual têm recusa PRÓPRIA", () => {
    // Não podem cair em "ultimo_admin": o motivo que a tela mostra é o que diz
    // à pessoa o que fazer a seguir.
    expect(podeRemover([A, B], "z")).toEqual({ ok: false, recusa: "membro_nao_encontrado" });
    expect(podeMudarPapel([A, B], "a", "admin")).toEqual({ ok: false, recusa: "papel_igual" });
  });

  it("CONTROLE — promover a admin nunca é recusado por esta regra", () => {
    expect(podeMudarPapel([A, C], "c", "admin")).toEqual({ ok: true });
  });
});
