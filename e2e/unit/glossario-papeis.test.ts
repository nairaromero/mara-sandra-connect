// Régua do glossário (#497): o texto dos papéis não repete a matriz de
// permissões. Rodar:
//   bun test e2e/unit/glossario-papeis.test.ts
//
// Regra do CLAUDE.md (Glossário): "Permissões dos papéis vêm do banco em tempo
// real — não escrever matriz de permissão em texto." O cartão de todo termo
// com `papel` já mostra, logo abaixo da definição, a lista lida do banco
// (PermissoesDoPapel). Até 27/10 o texto de advogado, assistente, financeiro e
// repasse repetia essa lista ("cria e edita…", "não vê…", "sem 'Novo caso'…"):
// batia com o banco, mas a primeira mudança de permissão faria o texto
// contradizer o cartão ao lado, sem ninguém ser avisado.
//
// A definição diz PARA QUE serve o papel; o QUE ele pode fica com a lista.
import { describe, expect, test } from "bun:test";
import { TERMOS } from "../../src/lib/glossario/termos";

// Verbos de capacidade ("cria", "edita", "vê"…) e negações de capacidade
// ("não vê", "sem “Novo caso”") são o jeito de escrever matriz em prosa.
const CAPACIDADE =
  /\b(cria|criam|edita|editam|exclui|excluem|lê|leem|vê|veem|envia|enviam|cumpre|cumprem|gerencia|gerenciam|mexe|mexem|cadastra|cadastram)\b|\bnão (vê|pode|cria|edita|exclui|gerencia|lê|envia)\b|\bsem “/i;

// Termos sem `papel` que falam de quem acessa o quê (e por isso também não
// podem virar matriz): o card deles não tem lista ao vivo.
const TAMBEM = ["repasse"];

describe("glossário: papéis sem matriz de permissões em texto", () => {
  const alvo = TERMOS.filter((t) => t.papel || TAMBEM.includes(t.id));

  test("a régua enxerga os termos de papel", () => {
    expect(alvo.map((t) => t.id).sort()).toEqual(
      expect.arrayContaining(["admin", "advogado", "assistente", "financeiro", "parceiro", "repasse"]),
    );
  });

  test("nenhum lista o que o papel faz — isso é da lista lida do banco", () => {
    const achados = alvo.flatMap((t) => {
      const m = t.definicao.match(CAPACIDADE);
      return m ? [`${t.id}: “${m[0]}”`] : [];
    });
    expect(achados, "diga para que serve o papel; a lista ao vivo mostra o que ele pode").toEqual([]);
  });

  test("todo termo com papel aponta para a lista ao vivo", () => {
    const sem = TERMOS.filter((t) => t.papel && !/lista abaixo/i.test(t.definicao)).map((t) => t.id);
    expect(sem).toEqual([]);
  });
});
