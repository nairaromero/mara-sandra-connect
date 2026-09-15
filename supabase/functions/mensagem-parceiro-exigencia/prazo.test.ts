// Testes da montagem da mensagem da exigência judicial. Rodar manualmente:
//   bun test supabase/functions/mensagem-parceiro-exigencia/prazo.test.ts
import { describe, expect, test } from "bun:test";
import { blocoPrazo, montarMensagem, prazosNoTexto } from "./prazo";

const RESPOSTA_IA = `Olá! A Justiça pediu dois documentos para o processo: o CNIS atualizado e a carteira de trabalho.

1. Tire uma foto do CNIS atualizado.
2. Tire uma foto da carteira de trabalho, frente e verso.

[PRAZO]

Se os documentos não chegarem a tempo, o juiz pode decidir sem eles. Providencie o quanto antes.`;

describe("montarMensagem", () => {
  test("troca o marcador pelo enviar até, sem o fatal", () => {
    const r = montarMensagem(RESPOSTA_IA, "2026-09-22");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensagem).toContain("*22/09/2026*");
    expect(r.mensagem).not.toContain("[PRAZO]");
    expect(prazosNoTexto(r.mensagem)).toEqual(["22/09/2026"]);
    // O bloco fica entre os passos e o fechamento.
    const blocos = r.mensagem.split("\n\n");
    expect(blocos[2]).toBe(blocoPrazo("2026-09-22"));
    expect(blocos[3]).toStartWith("Se os documentos");
  });

  test("sem prazo informado: bloco sem data", () => {
    const r = montarMensagem(RESPOSTA_IA, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensagem).toContain("o escritório vai confirmar a data");
    expect(prazosNoTexto(r.mensagem)).toEqual([]);
  });

  test("IA esqueceu o marcador: bloco entra antes do fechamento", () => {
    const semMarcador = RESPOSTA_IA.replace("[PRAZO]\n\n", "");
    const r = montarMensagem(semMarcador, "2026-09-22");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const blocos = r.mensagem.split("\n\n");
    expect(blocos.at(-2)).toBe(blocoPrazo("2026-09-22"));
    expect(blocos.at(-1)).toStartWith("Se os documentos");
  });

  test("marcador repetido: o bloco entra uma vez só", () => {
    const r = montarMensagem(`${RESPOSTA_IA}\n\n[PRAZO]`, "2026-09-22");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensagem.match(/⚠️/g)?.length).toBe(1);
    expect(r.mensagem.endsWith("Providencie o quanto antes.")).toBe(true);
  });

  test.each([
    ["data com barra (o caso do staging)", "O prazo máximo é *22/09/2026*."],
    ["data sem ano", "Envie até 22/09."],
    ["data por extenso", "Envie até 25 de setembro."],
    ["prazo em dias do despacho", "O juiz deu 15 dias para juntar."],
    ["dias úteis", "Temos 3 dias úteis."],
  ])("IA escreveu prazo por conta própria (%s): descarta", (_, frase) => {
    const r = montarMensagem(RESPOSTA_IA.replace("[PRAZO]", frase), "2026-09-22");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("prazo_na_resposta");
    expect(r.achados.length).toBeGreaterThan(0);
  });

  test("lista numerada e 'frente e verso' não contam como prazo", () => {
    expect(prazosNoTexto(RESPOSTA_IA)).toEqual([]);
  });
});
