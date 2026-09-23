// Token de processo: a forma como as telas guardam "de qual frente é este
// item" num `<Select>` só (que trabalha com string), antes de virar o par de
// colunas `processo_admin_id` / `processo_judicial_id` no banco.
//
// Estava copiado em quatro telas — tarefa, agenda, pedido de documento e
// edição do pedido —, com três convenções diferentes para "sem processo"
// (achado 9 da revisão do Yuri no PR #391). Agora é um lugar só.
//
//   ""                = ninguém escolheu ainda
//   SEM_PROCESSO      = "cliente sem processo" (resposta, não campo vazio)
//   "admin:<uuid>"    = requerimento
//   "judicial:<uuid>" = ação judicial

export const SEM_PROCESSO = "sem";

const PREFIXO_ADMIN = "admin:";
const PREFIXO_JUDICIAL = "judicial:";

export interface ProcessoDoItem {
  processo_admin_id: string | null;
  processo_judicial_id: string | null;
}

/** Par de colunas -> token. Sem frente vira "" (ninguém escolheu). */
export function tokenDoProcesso(p: ProcessoDoItem): string {
  if (p.processo_admin_id) return PREFIXO_ADMIN + p.processo_admin_id;
  if (p.processo_judicial_id) return PREFIXO_JUDICIAL + p.processo_judicial_id;
  return "";
}

/** Token -> par de colunas. "", SEM_PROCESSO e lixo viram os dois nulos. */
export function processoDoToken(token: string): ProcessoDoItem {
  if (token.startsWith(PREFIXO_ADMIN)) {
    return {
      processo_admin_id: token.slice(PREFIXO_ADMIN.length) || null,
      processo_judicial_id: null,
    };
  }
  if (token.startsWith(PREFIXO_JUDICIAL)) {
    return {
      processo_admin_id: null,
      processo_judicial_id: token.slice(PREFIXO_JUDICIAL.length) || null,
    };
  }
  return { processo_admin_id: null, processo_judicial_id: null };
}

/** Token de uma frente da lista de opções (`natureza` + id). */
export function tokenDaFrente(natureza: string, id: string): string {
  return `${natureza}:${id}`;
}

export function ehTokenJudicial(token: string): boolean {
  return token.startsWith(PREFIXO_JUDICIAL);
}
