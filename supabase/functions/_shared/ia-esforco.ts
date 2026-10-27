// Esforço do raciocínio da IA por tarefa — UM lugar (pedido da Naira, 27/10).
//
// O esforço (`output_config.effort` da Anthropic) decide quanto o modelo
// raciocina: mais esforço, mais tokens e mais demora. Cada tarefa tem um
// PADRÃO do sistema (abaixo) e o escritório pode trocar qualquer um pela tela
// (Configurações › Integrações › IA) — a escolha fica em
// `escritorio_integracoes.config.esforcos` e chega às functions junto com a
// chave (`abrirCredencial`). A tarefa é o mesmo nome que vai para o registro
// de uso (`registroDeUso({ funcao })`), que grava em `ia_uso.esforco` o nível
// usado — é dali que se mede antes de mudar um nível.
//
// Módulo PURO (sem import): a tela importa por `@shared/ia-esforco`
// (régua: e2e/unit/fonte-unica-documentos.test.ts). Função de IA nova entra
// aqui (régua: e2e/unit/ia-registro-de-uso.test.ts).

export type Esforco = "low" | "medium" | "high";

export const NIVEIS_ESFORCO: readonly Esforco[] = ["low", "medium", "high"];

export const ROTULO_ESFORCO: Record<Esforco, string> = { low: "Baixo", medium: "Médio", high: "Alto" };

/**
 * As tarefas de IA, com o padrão do sistema. `naTela: false` = não aparece na
 * personalização (o teste de conexão não é trabalho do escritório).
 *   low    — só o teste de conexão (nada a pensar);
 *   medium — identificar e extrair dado que vira registro, redigir, conversar
 *            (identificar documentos: Naira, 27/10 — precisão alta, no mínimo medium);
 *   high   — analisar o caso e triar andamentos: errar custa caro.
 */
export const TAREFAS_IA = {
  "integracoes-escritorio:testar": { padrao: "low", rotulo: "Testar conexão", naTela: false },
  "identificar-documentos": { padrao: "medium", rotulo: "Identificar documentos", naTela: true },
  "extrair-dados-cliente": { padrao: "medium", rotulo: "Extrair dados do cliente", naTela: true },
  "extrair-agendamento-pericia": { padrao: "medium", rotulo: "Extrair agendamento de perícia", naTela: true },
  "inss-email-processor": { padrao: "medium", rotulo: "Ler e-mails do INSS", naTela: true },
  "mensagem-parceiro-exigencia": { padrao: "medium", rotulo: "Mensagem ao parceiro (exigência)", naTela: true },
  "sugerir-proxima-tarefa": { padrao: "medium", rotulo: "Sugerir a próxima tarefa", naTela: true },
  "ia-assistant": { padrao: "medium", rotulo: "Assistente", naTela: true },
  "ia-triagem-andamentos": { padrao: "high", rotulo: "Triagem de andamentos", naTela: true },
  "ia-analise": { padrao: "high", rotulo: "Análise do caso", naTela: true },
} as const satisfies Record<string, { padrao: Esforco; rotulo: string; naTela: boolean }>;

export type TarefaIA = keyof typeof TAREFAS_IA;

/** O padrão do sistema por tarefa (derivado de TAREFAS_IA). */
export const ESFORCO_POR_TAREFA = Object.fromEntries(
  Object.entries(TAREFAS_IA).map(([t, v]) => [t, v.padrao]),
) as Record<TarefaIA, Esforco>;

/** O que o escritório trocou. Tarefa ausente = padrão do sistema. */
export type EsforcosDoEscritorio = Partial<Record<TarefaIA, Esforco>>;

/**
 * Lê `config.esforcos` sem confiar nele: tarefa desconhecida, nível inválido
 * ou nível igual ao padrão são descartados (o padrão não precisa ser gravado —
 * e, se o padrão mudar depois, quem nunca trocou acompanha).
 */
export function lerEsforcos(bruto: unknown): EsforcosDoEscritorio {
  const out: EsforcosDoEscritorio = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return out;
  for (const [tarefa, nivel] of Object.entries(bruto as Record<string, unknown>)) {
    if (!(tarefa in TAREFAS_IA)) continue;
    if (typeof nivel !== "string" || !(NIVEIS_ESFORCO as readonly string[]).includes(nivel)) continue;
    const t = tarefa as TarefaIA;
    if (nivel !== TAREFAS_IA[t].padrao) out[t] = nivel as Esforco;
  }
  return out;
}

/** O esforço que vale para a tarefa neste escritório. */
export function esforcoDaTarefa(tarefa: TarefaIA, doEscritorio?: EsforcosDoEscritorio): Esforco {
  return doEscritorio?.[tarefa] ?? ESFORCO_POR_TAREFA[tarefa];
}
