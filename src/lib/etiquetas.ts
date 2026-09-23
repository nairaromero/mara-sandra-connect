// Ordenação das etiquetas (tags) do escritório. Duas ordens (Naira, 2026-09-17):
//
// - Listas do escritório (tela Etiquetas, "+ Etiqueta"): ordem alfabética pura
//   — `ordenarEtiquetas`.
// - Etiquetas DE UM CLIENTE (topo da página do cliente e cada linha da lista de
//   clientes): por grupo — Status, Parceiro, Andamento processual (situação e
//   resultado), e o resto (benefícios e outras); alfabética dentro do grupo —
//   `ordenarEtiquetasDoCliente`.
//
// A comparação é pt-BR, sem diferenciar maiúscula nem acento e ignorando
// espaço e símbolo: "PARCERIA _RITA/BEATRIZ" (espaço sobrando) fica no R;
// "AVERBACAO/CTC/INSS" antes de "AVERBACAO_TEMPO_ESPECIAL". Empate — mesmas
// letras — cai no nome exato, pra ordem não depender de como o banco devolveu.
const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", ignorePunctuation: true });

function compararNomesEtiqueta(a: string, b: string): number {
  return COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

// Não muta o array original.
export function ordenarEtiquetas<T extends { nome: string }>(lista: Array<T>): Array<T> {
  return [...lista].sort((a, b) => compararNomesEtiqueta(a.nome, b.nome));
}

// 1 Status · 2 Parceiro · 3 Andamento processual · 4 Outras
export type GrupoEtiqueta = 1 | 2 | 3 | 4;

// Nome exato da etiqueta (maiúsculas) → grupo. Tem prioridade sobre os
// padrões. Ajuste aqui pra mover uma tag de grupo.
const OVERRIDES_GRUPO: Record<string, GrupoEtiqueta> = {
  ANALISADO_SEM_DIREITO: 3,
  INEXISTENCIA_DE_DEBITO_INSS: 3,
};

// Classificação por padrão (regex), pra aguentar tags novas vindas do sync do
// TI sem recadastrar — a mesma de 2026-07-21, com "situação processual" e
// "resultado" juntos em Andamento processual e "benefício" junto das outras.
export function grupoEtiqueta(nome: string): GrupoEtiqueta {
  // Sem acento: "PERÍCIA_MEDICA_JUDICIAL_BOM" tem que casar com PERICIA.
  const n = (nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (n in OVERRIDES_GRUPO) return OVERRIDES_GRUPO[n];

  if (/^STATUS:/.test(n)) return 1;

  // Parceiro: PARCERIA* ou "NOME/UF" (barra + 2 letras maiúsculas no fim).
  // Sem exigir o "_": "PARCERIA _RITA/BEATRIZ" tem um espaço sobrando no nome.
  if (/^PARCERIA/.test(n) || /\/[A-Z]{2}$/.test(n)) return 2;

  // Resultado — antes de benefício, pra capturar termos específicos
  if (/CONCEDIDO|INDEFERIDO|^IMPLANTADO$|JULGADO_|_PROVIDO$|_DESPROVIDO$|_IMPROCEDENTE$|_PROCEDENTE$/.test(n)) {
    return 3;
  }

  // Benefício — vai pro resto, mas é testado antes da situação processual
  // (ex.: REVISAO_*, PEDIDO_DE_PRORROGACAO_* não viram andamento).
  if (
    /^AUXILIO_|^APOSENTADORIA_|^BPC_LOAS|PENSAO_POR_MORTE|SALARIO_MATERNIDADE|^INVALIDEZ|BENEFICIO_POR_INCAPACIDADE|^ADICIONAL_25|^PEDIDO_(DE_PRORROGACAO|FUTURO)|ISENCAO_IMPOSTO_RENDA|^REVISAO_/.test(n)
  ) {
    return 4;
  }

  // Situação processual
  if (
    /^AGUARDANDO_|^AG\.|^ANALISE|^ANALISADO|^MONTAGEM_|^PROTOCOLO_|^RECURSO_|PERICIA|EXIGENCIA|CUMPRIMENTO_SENTENCA|^JUDICIAL$|ADMINISTRATIVO_INSS|LEGAL_MAIL|PLANEJAMENTO_PREVIDENCIARIO|CALCULO_PREVIDENCIARIO|RECEBIDO_CALCULO|MENSAL_PAGANDO|ORGANIZACAO_DOCUMENTOS|PPP_CORRECOES|RECONHECIMENTO_TEMPO_ESPECIAL|REANALISE_ESPECIAL|ACERTOS_DE_VINCULOS|OBRIGACAO_DE_FAZER|PROPOSTA_ACORDO|AVERBACAO|SEM_PROCESSO/.test(n)
  ) {
    return 3;
  }

  return 4;
}

// Etiquetas de UM cliente: grupo na ordem acima, alfabética dentro do grupo.
// Não muta o array original.
export function ordenarEtiquetasDoCliente<T extends { nome: string }>(lista: Array<T>): Array<T> {
  return [...lista].sort(
    (a, b) => grupoEtiqueta(a.nome) - grupoEtiqueta(b.nome) || compararNomesEtiqueta(a.nome, b.nome),
  );
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
