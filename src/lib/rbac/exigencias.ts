// O que o SERVIDOR exige para cada escrita — espelho, em um lugar só, das
// policies `perm_*` do banco, das RPCs `SECURITY DEFINER` que conferem
// permissão e das edge functions que pedem permissão em `exigirUsuario`.
//
// POR QUE ISTO EXISTE
// A tela não pode oferecer o que o servidor vai recusar (auditoria de
// 24/09/2026, planning/RBAC_AUDITORIA_TELAS.md: ~40 botões nessa situação).
// Antes, cada tela escrevia a permissão à mão dentro do `pode("…")` — e errar
// a permissão, esquecer o gate ou ignorar o escopo não aparecia em lugar nenhum.
// Aqui a exigência é declarada UMA vez, ao lado do alvo que ela protege.
//
// A FONTE DA VERDADE CONTINUA SENDO O BANCO. Este arquivo é a cópia que o
// navegador consegue ler. Quem garante que a cópia confere é
// `scripts/rbac-conferir-exigencias.mjs` (e a spec `rbac-exigencias`), que lê as
// policies do banco-alvo e compara com o que está aqui — sobra ou falta acusa.
//
// COMO USAR (nunca escreva a permissão solta na tela):
//   const { podeEscrever } = useAuth();
//   {podeEscrever("tarefas") && <Button …>Nova tarefa</Button>}
//   <AcaoProtegida escrever="documentos" operacao="excluir"> … </AcaoProtegida>

/** Escopos possíveis de `papel_permissoes.escopo`. */
export type Escopo = "todos" | "atribuidos" | "indicados" | "proprios";

/** Uma exigência do servidor: a permissão e, quando o servidor cobra, o escopo. */
export interface Exigencia {
  permissao: string;
  /**
   * Escopo que a policy cobra. `undefined` = a policy passa NULL e qualquer
   * escopo serve. Quando vem `"todos"`, quem tem a permissão com escopo menor
   * (o assistente, com `atribuidos`) É RECUSADO pelo banco — e a tela precisa
   * saber disso, senão oferece o botão e a pessoa leva erro.
   */
  escopo?: Escopo;
}

export type Operacao = "inserir" | "atualizar" | "excluir";

/**
 * Tabelas de domínio com policy `perm_*`. Uma entrada por tabela; quando as três
 * operações exigem o mesmo, a exigência é única (`todas`).
 */
export const ESCRITA: Record<string, { todas?: Exigencia } & Partial<Record<Operacao, Exigencia>>> = {
  // casos:editar — o miolo do atendimento
  casos: { todas: { permissao: "casos:editar" } },
  clientes: { todas: { permissao: "casos:editar" } },
  clientes_etiquetas: { todas: { permissao: "casos:editar" } },
  andamentos: { todas: { permissao: "casos:editar" } },
  processos_admin: { todas: { permissao: "casos:editar" } },
  processos_judiciais: { todas: { permissao: "casos:editar" } },

  // documentos: enviar e excluir são permissões DIFERENTES (o assistente envia
  // e não apaga) — foi aqui que a tela errou o gate em dois lugares.
  documentos: {
    inserir: { permissao: "documentos:enviar" },
    atualizar: { permissao: "documentos:enviar" },
    excluir: { permissao: "documentos:excluir" },
  },

  // escopo `todos` cobrado pela policy: ver o comentário de `Exigencia`.
  tarefas: { todas: { permissao: "tarefas:gerenciar", escopo: "todos" } },
  agenda_eventos: { todas: { permissao: "agenda:gerenciar", escopo: "todos" } },

  etiquetas: { todas: { permissao: "etiquetas:gerenciar" } },
  tarefa_templates: { todas: { permissao: "templates:gerenciar" } },
  tipos_beneficio: { todas: { permissao: "templates:gerenciar" } },
  leads: { todas: { permissao: "comercial:gerenciar" } },
  lead_comentarios: { todas: { permissao: "comercial:gerenciar" } },
  ia_acoes: { todas: { permissao: "ia:usar" } },
  ia_integracoes: { todas: { permissao: "ia:usar" } },
};

/** RPCs `SECURITY DEFINER` que conferem permissão antes de agir. */
export const RPC: Record<string, Exigencia> = {
  excluir_cliente: { permissao: "clientes:excluir" },
  definir_papel: { permissao: "equipe:gerenciar" },
  desligar_interno: { permissao: "equipe:gerenciar" },
  reativar_interno: { permissao: "equipe:gerenciar" },
  desligar_parceiro: { permissao: "parceiros:gerenciar" },
  reativar_parceiro: { permissao: "parceiros:gerenciar" },
  escritorio_definir_marca: { permissao: "escritorio:configurar" },
  gmail_inss_status: { permissao: "integracoes:gerenciar" },
};

/** Edge functions que pedem permissão em `exigirUsuario`. */
export const FUNCTION: Record<string, Exigencia> = {
  "integracoes-escritorio": { permissao: "integracoes:gerenciar" },
  "gmail-oauth-start": { permissao: "integracoes:gerenciar" },
  "ia-analise": { permissao: "ia:usar" },
  "extrair-dados-cliente": { permissao: "ia:usar" },
  "excluir-parceiro": { permissao: "parceiros:excluir" },
};

/** Storage: bucket → exigência de escrita (upload/remover). */
export const BUCKET: Record<string, Exigencia> = {
  marcas: { permissao: "escritorio:configurar" },
  // O bucket `documentos` acompanha a tabela `documentos` (upload = enviar,
  // remover = excluir): use `podeEscrever("documentos", "excluir")`.
};

/** A exigência de uma escrita, já resolvida por operação. */
export function exigenciaDeEscrita(tabela: string, operacao: Operacao = "inserir"): Exigencia | null {
  const linha = ESCRITA[tabela];
  if (!linha) return null; // tabela sem policy de permissão: só isolamento por escritório
  return linha[operacao] ?? linha.todas ?? null;
}
