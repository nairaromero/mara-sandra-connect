// Categorização e ordenação das etiquetas (tags) do escritório.
//
// Ordem de exibição pedida pela Naira (2026-07-21):
//   1. Status  2. Parceria  3. Benefício  4. Situação processual
//   5. Resultado (concedido/indeferido)  6. Outras
//
// A classificação é por padrão (regex) pra aguentar tags novas vindas do sync
// do TI sem precisar recadastrar. Casos que não seguem padrão ficam em
// OVERRIDES_CATEGORIA — é aqui que se recategoriza uma tag específica.

export type CategoriaEtiqueta = 1 | 2 | 3 | 4 | 5 | 6;

export const CATEGORIAS_ETIQUETA: Record<CategoriaEtiqueta, string> = {
  1: "Status",
  2: "Parceria",
  3: "Benefício",
  4: "Situação processual",
  5: "Resultado (concedido/indeferido)",
  6: "Outras",
};

// Nome exato da etiqueta (maiúsculas) → categoria. Tem prioridade sobre os
// padrões. Ajuste aqui pra mover uma tag de categoria.
const OVERRIDES_CATEGORIA: Record<string, CategoriaEtiqueta> = {
  ANALISADO_SEM_DIREITO: 5,
  INEXISTENCIA_DE_DEBITO_INSS: 5,
};

export function categoriaEtiqueta(nome: string): CategoriaEtiqueta {
  const n = (nome || "").toUpperCase().trim();
  if (n in OVERRIDES_CATEGORIA) return OVERRIDES_CATEGORIA[n];

  // 1) Status
  if (/^STATUS:/.test(n)) return 1;

  // 2) Parceria: PARCERIA_* ou "NOME/UF" (barra + 2 letras maiúsculas no fim)
  if (/^PARCERIA_/.test(n) || /\/[A-Z]{2}$/.test(n)) return 2;

  // 5) Resultado — antes de benefício/situação p/ capturar termos específicos
  if (/CONCEDIDO|INDEFERIDO|^IMPLANTADO$|JULGADO_|_PROVIDO$|_DESPROVIDO$|_IMPROCEDENTE$|_PROCEDENTE$/.test(n)) {
    return 5;
  }

  // 3) Benefício
  if (
    /^AUXILIO_|^APOSENTADORIA_|^BPC_LOAS|PENSAO_POR_MORTE|SALARIO_MATERNIDADE|^INVALIDEZ|BENEFICIO_POR_INCAPACIDADE|^ADICIONAL_25|^PEDIDO_(DE_PRORROGACAO|FUTURO)|ISENCAO_IMPOSTO_RENDA|^REVISAO_/.test(n)
  ) {
    return 3;
  }

  // 4) Situação processual
  if (
    /^AGUARDANDO_|^AG\.|^ANALISE|^ANALISADO|^MONTAGEM_|^PROTOCOLO_|^RECURSO_|PERICIA|EXIGENCIA|CUMPRIMENTO_SENTENCA|^JUDICIAL$|ADMINISTRATIVO_INSS|LEGAL_MAIL|PLANEJAMENTO_PREVIDENCIARIO|CALCULO_PREVIDENCIARIO|RECEBIDO_CALCULO|MENSAL_PAGANDO|ORGANIZACAO_DOCUMENTOS|PPP_CORRECOES|RECONHECIMENTO_TEMPO_ESPECIAL|REANALISE_ESPECIAL|ACERTOS_DE_VINCULOS|OBRIGACAO_DE_FAZER|PROPOSTA_ACORDO|AVERBACAO|SEM_PROCESSO/.test(n)
  ) {
    return 4;
  }

  // 6) Outras
  return 6;
}

// Ordena por categoria (na ordem pedida) e, dentro da categoria, alfabético
// pt-BR. Não muta o array original.
export function ordenarEtiquetas<T extends { nome: string }>(lista: Array<T>): Array<T> {
  return [...lista].sort((a, b) => {
    const ca = categoriaEtiqueta(a.nome);
    const cb = categoriaEtiqueta(b.nome);
    if (ca !== cb) return ca - cb;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
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
