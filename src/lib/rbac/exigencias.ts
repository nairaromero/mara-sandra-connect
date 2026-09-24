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

/**
 * Uma exigência do servidor.
 *
 * A maioria das policies chama `tem_permissao('x:y', NULL)`: basta ter a
 * permissão, em qualquer escopo. Duas tabelas (`tarefas` e `agenda_eventos`)
 * cobram escopo com um OU:
 *
 *   tem_permissao('tarefas:gerenciar','todos')
 *   OR (tem_permissao('tarefas:gerenciar','atribuidos') AND responsavel_id = auth.uid())
 *
 * Ou seja: quem tem escopo `atribuidos` (o assistente) MEXE nas linhas dele e
 * só nelas. É por isso que a decisão da tela depende da LINHA quando há
 * `proprio` — `podeEscrever` responde "pode em alguma linha?" e
 * `podeEscreverLinha` responde "pode nesta?".
 */
export interface Exigencia {
  permissao: string;
  /** O ramo alternativo da policy: escopo aceito + a coluna que aponta para a pessoa. */
  proprio?: { escopo: Escopo; coluna: string };
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

  // escopo: `todos`, ou `atribuidos` na linha de quem é responsável.
  tarefas: {
    todas: { permissao: "tarefas:gerenciar", proprio: { escopo: "atribuidos", coluna: "responsavel_id" } },
  },
  agenda_eventos: {
    todas: { permissao: "agenda:gerenciar", proprio: { escopo: "atribuidos", coluna: "responsavel_id" } },
  },

  // classe inversa (24/09): passaram a exigir permissão — antes qualquer pessoa
  // do escritório escrevia (planning/RBAC_CLASSE_INVERSA.md).
  solicitacoes_documento: { todas: { permissao: "casos:editar" } },
  alertas_duplicidade: { todas: { permissao: "casos:editar" } },

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
  // funções privilegiadas que passaram a conferir permissão (migration_rbac_17)
  aplicar_template: { permissao: "tarefas:gerenciar" },
  vincular_publicacao_dje: { permissao: "casos:editar" },
  set_senha_meu_inss: { permissao: "senha_inss:ler" },
};

/** Edge functions que pedem permissão em `exigirUsuario`. */
export const FUNCTION: Record<string, Exigencia> = {
  "integracoes-escritorio": { permissao: "integracoes:gerenciar" },
  "gmail-oauth-start": { permissao: "integracoes:gerenciar" },
  "ia-analise": { permissao: "ia:usar" },
  "extrair-dados-cliente": { permissao: "ia:usar" },
  "excluir-parceiro": { permissao: "parceiros:excluir" },
  // classe inversa (24/09): antes pediam só "ser interna"
  "ia-assistant": { permissao: "ia:usar" },
  // `ia-config` fica de fora de propósito: o cofre de IA exige `ia:usar`
  // por AÇÃO (status/testar/salvar/ativar/compartilhar), enquanto as ações de
  // token do MCP são da dona do token, que pode ser parceira (#385).
  "ia-triagem-andamentos": { permissao: "ia:usar" },
  "sugerir-proxima-tarefa": { permissao: "ia:usar" },
  "mensagem-parceiro-exigencia": { permissao: "ia:usar" },
  "extrair-agendamento-pericia": { permissao: "ia:usar" },
  "sync-datajud-movimentacoes": { permissao: "casos:editar" },
  "sync-djen-caso": { permissao: "casos:editar" },
  "sync-legalmail-caso": { permissao: "casos:editar" },
  "sync-ti-cliente": { permissao: "casos:editar" },
  "listar-processos-legalmail": { permissao: "processos:ler" },
  "listar-clientes-ti": { permissao: "casos:ler" },
  "check-legalmail-nome": { permissao: "processos:ler" },
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
