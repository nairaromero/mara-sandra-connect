// Ordenação das etiquetas (tags) do escritório.
//
// Ordem alfabética pura (Naira, 2026-09-17) — substitui o agrupamento por
// categoria (Status, Parceria, Benefício...) pedido em 2026-07-21. Vale na tela
// Etiquetas, nas etiquetas da página do cliente (e no "+ Etiqueta") e nas
// etiquetas da lista de clientes.
//
// Compara só as letras e números, em pt-BR, sem diferenciar maiúscula nem
// acento: espaço e símbolo não empurram ninguém pro lugar errado
// ("PARCERIA _RITA/BEATRIZ" fica no R; "AVERBACAO/CTC/INSS" antes de
// "AVERBACAO_TEMPO_ESPECIAL"). Empate — mesmas letras — cai no nome exato, pra
// ordem não depender de como o banco devolveu.
const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", ignorePunctuation: true });

function compararNomesEtiqueta(a: string, b: string): number {
  return COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

// Não muta o array original.
export function ordenarEtiquetas<T extends { nome: string }>(lista: Array<T>): Array<T> {
  return [...lista].sort((a, b) => compararNomesEtiqueta(a.nome, b.nome));
}

// Etiqueta de benefício → nome canônico usado em `casos.tipo_beneficio`.
//
// Um caso guarda UM benefício, mas o cliente pode ter duas etiquetas quando o
// pedido envolve mais de um (ex.: auxílio-acidente + aposentadoria especial).
// Sem este mapa, filtrar por "Aposentadoria especial" esconderia o caso que
// tem isso na etiqueta mas outro nome no campo. Evita ter que inventar valor
// combinado ("A / B") só pra o filtro achar.
export const BENEFICIO_POR_ETIQUETA: Record<string, string> = {
  APOSENTADORIA_RURAL: "Aposentadoria Rural",
  AUXILIO_ACIDENTE: "Auxílio-acidente",
  APOSENTADORIA_ESPECIAL: "Aposentadoria especial",
  APOSENTADORIA_PCD_TEMPO_CONTRIBUICAO: "Aposentadoria da PCD (LC 142/2013)",
  APOSENTADORIA_POR_TEMPO_CONTRIBUICAO: "Aposentadoria por tempo de contribuição",
  APOSENTADORIA_POR_IDADE: "Aposentadoria por idade",
  REVISAO_APOSENTADORIA: "Revisão de aposentadoria",
  AUXILIO_DOENCA: "Auxílio por incapacidade temporária",
  "CIVEL/CONSUMIDOR": "Cível/Consumidor",
  CALCULO_PREVIDENCIARIO: "Cálculo previdenciário",
  PLANEJAMENTO_PREVIDENCIARIO: "Planejamento previdenciário",
  ADICIONAL_25_INSS: "Adicional 25% INSS",
  ACERTOS_DE_VINCULOS_INSS: "Acertos de vínculos",
  BENEFICIO_POR_INCAPACIDADE_TEMPORARIA: "Incapacidade temporária",
  AUXILIO_DOENCA_POSTERIOR_APOSENTADORIA_POR_INVALIDEZ:
    "Auxílio-doença posterior à aposentadoria por invalidez",
};

/** Benefícios que as etiquetas do cliente indicam (canônicos, sem repetir). */
export function beneficiosDasEtiquetas(
  etiquetas: Array<{ nome: string }>,
): Array<string> {
  const out = new Set<string>();
  for (const e of etiquetas) {
    const b = BENEFICIO_POR_ETIQUETA[(e.nome || "").toUpperCase().trim()];
    if (b) out.add(b);
  }
  return Array.from(out);
}
