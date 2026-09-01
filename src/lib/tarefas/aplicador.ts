// Aplicação PROGRAMÁTICA de template — pros widgets de desfecho que emendam
// um template no outro (análise do cliente novo → montagem de requerimento;
// resultado da perícia → concedido/indeferido; análise de indeferimento →
// montagem de inicial). Cobre templates de tarefas + andamentos (agenda e
// solicitação continuam exclusivos do fluxo manual do TarefaSheet, que pede
// os campos extras na tela).

import { supabase } from "@/lib/supabase";
import { instanteBR, partesBR } from "@/lib/fuso";
import { substituirPlaceholders } from "@/lib/tarefas/helpers";

interface ItemTemplate {
  destino?: "tarefa" | "agenda" | "andamento" | "solicitacao_documento";
  titulo: string;
  descricao?: string | null;
  tipo?: string;
  prioridade?: number;
  offset_dias?: number;
  visivel_parceiro?: boolean;
  meta?: Record<string, unknown>;
}

export interface ResultadoAplicacao {
  tarefas: number;
  andamentos: number;
  primeiraTarefaId: string | null;
}

/** Due do item: hoje+offset (calendário de Brasília), 09:00. */
function dueDoOffset(offsetDias: number): string {
  const p = partesBR(new Date());
  return new Date(
    instanteBR(p.ano, p.mes, p.dia, 9, 0).getTime() + offsetDias * 86400_000,
  ).toISOString();
}

export async function aplicarTemplateProgramatico(input: {
  nomeTemplate: string;
  casoId: string;
  clienteNome: string;
  responsavelId: string | null;
  autorId: string | null;
  processoAdminId?: string | null;
  processoJudicialId?: string | null;
}): Promise<ResultadoAplicacao> {
  const { data: tpl, error } = await supabase
    .from("tarefa_templates")
    .select("nome, itens")
    .eq("nome", input.nomeTemplate)
    .single();
  if (error || !tpl) {
    throw new Error(`template ${input.nomeTemplate} não encontrado`);
  }
  const itens = ((tpl.itens as ItemTemplate[]) ?? []).filter(
    (i) => !i.destino || i.destino === "tarefa" || i.destino === "andamento",
  );
  const ph = { nome_cliente: input.clienteNome };
  const r: ResultadoAplicacao = { tarefas: 0, andamentos: 0, primeiraTarefaId: null };

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (item.destino === "andamento") {
      const visivel = item.visivel_parceiro ?? true;
      const { data: novoAnd, error: e1 } = await supabase
        .from("andamentos")
        .insert({
          caso_id: input.casoId,
          processo_admin_id: input.processoAdminId ?? null,
          processo_judicial_id: input.processoJudicialId ?? null,
          origem: "interno",
          titulo: substituirPlaceholders(item.titulo, ph),
          descricao: substituirPlaceholders(item.descricao ?? "", ph) || null,
          data_evento: new Date().toISOString(),
          criado_por: input.autorId,
          visivel_parceiro: visivel,
          metadata: {
            template_aplicado: tpl.nome,
            template_item_index: i,
            aplicado_por_desfecho: true,
            ...(item.meta ?? {}),
          },
        })
        .select("id")
        .single();
      if (e1) throw e1;
      if (visivel) {
        supabase.functions
          .invoke("notify-novo-andamento", { body: { andamento_id: novoAnd.id } })
          .catch(() => {});
      }
      r.andamentos++;
      continue;
    }
    const { data: novaT, error: e2 } = await supabase
      .from("tarefas")
      .insert({
        caso_id: input.casoId,
        processo_admin_id: input.processoAdminId ?? null,
        processo_judicial_id: input.processoJudicialId ?? null,
        responsavel_id: input.responsavelId,
        tipo: item.tipo ?? "interna",
        prioridade: item.prioridade ?? 2,
        status: "a_fazer",
        titulo: substituirPlaceholders(item.titulo, ph),
        descricao: substituirPlaceholders(item.descricao ?? "", ph) || null,
        due_at: dueDoOffset(item.offset_dias ?? 0),
        origem: "template",
        metadata: {
          template_aplicado: tpl.nome,
          template_item_index: i,
          aplicado_por_desfecho: true,
          ...(item.meta ?? {}),
        },
      })
      .select("id")
      .single();
    if (e2) throw e2;
    if (!r.primeiraTarefaId) r.primeiraTarefaId = novaT.id as string;
    r.tarefas++;
  }
  return r;
}
