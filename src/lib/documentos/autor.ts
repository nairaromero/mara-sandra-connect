// Quem juntou o arquivo (pedido da Naira, 20/10).
//
// `documentos.uploaded_by` sempre foi gravado — no espelho da produção são
// 6.876 arquivos da equipe e 202 de parceiros, nenhum sem autor. O que faltava
// era mostrar: ao abrir a pasta, a equipe não distinguia o que o parceiro
// mandou do que ela mesma subiu, nem na conferência do caso novo nem na tarefa
// "Analisar documentos juntados pelo parceiro" dos casos em andamento.
//
// A régua da tela: o nome aparece sempre; a etiqueta "parceiro" só em quem é
// parceiro. Numa pasta de 30 arquivos, escrever "equipe" em todas as linhas é
// ruído — o que a pessoa procura é o que veio de fora.

/** O que o join `autor:usuarios!documentos_uploaded_by_fkey` devolve. */
export interface AutorDocumento {
  nome?: string | null;
  email?: string | null;
  tipo?: string | null;
}

export interface QuemJuntou {
  nome: string;
  ehParceiro: boolean;
}

/**
 * Nome curto de quem juntou, e se é parceiro. `null` quando não dá para dizer
 * — e aí a tela não escreve nada, em vez de afirmar "não registrado": pode ser
 * só a RLS não deixando ver a pessoa.
 */
export function quemJuntou(autor?: AutorDocumento | null): QuemJuntou | null {
  if (!autor) return null;
  const nome = (autor.nome ?? "").trim() || (autor.email ?? "").trim().split("@")[0];
  if (!nome) return null;
  return { nome, ehParceiro: autor.tipo === "parceiro" };
}
