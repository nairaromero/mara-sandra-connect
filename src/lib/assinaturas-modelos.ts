// Achar o modelo de contrato do ZapSign sem procurar: busca pelo nome, modelos
// sugeridos para o tipo de benefício do caso e agrupamento pela pasta do
// ZapSign (#522). Funções PURAS (só importam módulo puro de `_shared`): a régua
// e2e/unit/zapsign-modelos.test.ts roda sem banco nem tela.
import type { ModeloZapsign } from "@shared/assinatura";
import { semAcento } from "@shared/modelo-contrato";

/** Palavras que não dizem de que serviço é o contrato. */
const SEM_SIGNIFICADO = new Set(["para", "pelo", "pela", "com", "sem", "por", "dos", "das", "contrato", "modelo", "honorarios", "definir"]);
const palavras = (texto: string) => semAcento(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !SEM_SIGNIFICADO.has(p));

/** Os modelos cujo nome ou pasta contém TODAS as palavras digitadas (em qualquer ordem). */
export function filtrarModelos(modelos: ReadonlyArray<ModeloZapsign>, busca: string): Array<ModeloZapsign> {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return [...modelos];
  return modelos.filter((m) => {
    const alvo = semAcento(`${m.nome} ${m.pasta}`);
    return termos.every((t) => alvo.includes(t));
  });
}

/**
 * Os modelos que falam do serviço deste caso: o nome (ou a pasta) do modelo tem
 * alguma palavra do tipo de benefício. Quem casa com mais palavras vem primeiro.
 * Caso sem tipo definido ("a_definir") não sugere nada.
 */
export function modelosSugeridos(modelos: ReadonlyArray<ModeloZapsign>, tipoBeneficio: string | null | undefined): Array<ModeloZapsign> {
  const doCaso = palavras(tipoBeneficio ?? "");
  if (!doCaso.length) return [];
  return modelos
    .map((m) => {
      const doModelo = new Set(palavras(`${m.nome} ${m.pasta}`));
      return { m, pontos: doCaso.filter((p) => doModelo.has(p)).length };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.m.nome.localeCompare(b.m.nome, "pt-BR"))
    .map((x) => x.m);
}

/** Agrupa pela pasta do ZapSign, na ordem das pastas; a raiz ("/") vem primeiro, sem nome de pasta. */
export function porPasta(modelos: ReadonlyArray<ModeloZapsign>): Array<{ pasta: string; rotulo: string; modelos: Array<ModeloZapsign> }> {
  const grupos = new Map<string, Array<ModeloZapsign>>();
  for (const m of modelos) grupos.set(m.pasta, [...(grupos.get(m.pasta) ?? []), m]);
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b, "pt-BR")))
    .map(([pasta, lista]) => ({
      pasta,
      rotulo: pasta === "/" ? "Sem pasta" : pasta.replace(/^\/+|\/+$/g, "").replace(/\//g, " › "),
      modelos: lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    }));
}
