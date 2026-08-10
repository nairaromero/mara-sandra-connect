// Corrente da montagem de inicial: Bia monta -> Mara revisa -> Bia protocola.
//
// Aparece dentro do TarefaSheet/TarefaCard quando
// tarefa.metadata.montagem_inicial === true. O botão muda conforme a etapa:
//
//   montagem  (Bia,  10d) -> "Enviar para revisão"    cria a revisão da Mara
//   revisao   (Mara, 10d) -> "Enviar para protocolo"  devolve pra Bia
//   protocolo (Bia,   5d) -> "Protocolo realizado"    encerra + avisa o parceiro
//
// Cada etapa nasce do clique da anterior, e não todas de uma vez: o prazo de
// cada uma começa a contar quando a anterior termina.
//
// O número do processo é pedido só na última etapa e é OPCIONAL — às vezes
// demora um dia pra sair. Quando vem, o processo judicial é cadastrado no caso
// e o andamento fica vinculado a ele, o que destrava DataJud e DJE.

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Send, Stamp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import type { TarefaComJoins } from "@/lib/tarefas/types";
import { useDestaque } from "@/lib/destaque/destaque-context";

const EMAIL_BIA = "advocacia.beatrizsan@outlook.com";
const EMAIL_MARA = "marasandra.adv@gmail.com";

type Etapa = "montagem" | "revisao" | "protocolo";

// Prazo de cada etapa em dias CORRIDOS, e de quem ela é.
const PROXIMA: Record<
  Etapa,
  {
    etapa: Etapa;
    dias: number;
    email: string;
    titulo: string;
    descricao: string;
    /** Andamento INTERNO que registra a passagem de bastão. */
    andamento: string;
  } | null
> = {
  montagem: {
    etapa: "revisao",
    dias: 10,
    email: EMAIL_MARA,
    titulo: "Revisão da inicial",
    descricao:
      'Revisar a petição inicial montada. Ao aprovar, use o botão "Enviar para ' +
      'protocolo" — a tarefa de protocolo volta para a Bia automaticamente.\n\n' +
      "Prazo fatal: 10 dias corridos.",
    andamento: "Caso enviado à revisão da inicial",
  },
  revisao: {
    etapa: "protocolo",
    dias: 5,
    email: EMAIL_BIA,
    titulo: "Protocolo da inicial",
    descricao:
      'Protocolar a inicial no judicial. Ao protocolar, use o botão "Protocolo ' +
      "realizado\" — o parceiro é avisado automaticamente.\n\n" +
      "Prazo fatal: 5 dias corridos.",
    andamento: "Caso enviado ao protocolo",
  },
  protocolo: null,
};

const ROTULO: Record<Etapa, { acao: string; titulo: string }> = {
  montagem: { acao: "Enviar para revisão", titulo: "Montagem" },
  revisao: { acao: "Enviar para protocolo", titulo: "Revisão" },
  protocolo: { acao: "Protocolo realizado", titulo: "Protocolo" },
};

interface Props {
  tarefa: TarefaComJoins;
  onUpdated: () => void;
  compacto?: boolean;
  stopPropagation?: boolean;
}

/** Dias corridos a partir de agora, às 18h (fim do expediente). */
function venceEm(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

export function MontagemInicial({
  tarefa,
  onUpdated,
  compacto = false,
  stopPropagation = false,
}: Props) {
  const meta = (tarefa.metadata ?? {}) as { etapa?: Etapa };
  const etapa: Etapa = meta.etapa === "revisao" || meta.etapa === "protocolo"
    ? meta.etapa
    : "montagem";

  const [agindo, setAgindo] = useState(false);
  const [numeroProcesso, setNumeroProcesso] = useState("");
  const { marcar: marcarDestaque } = useDestaque();

  const concluida = tarefa.status === "feito";
  const ehUltima = etapa === "protocolo";

  async function avancar() {
    if (agindo) return;
    setAgindo(true);
    try {
      const agora = new Date().toISOString();
      const proxima = PROXIMA[etapa];

      // Encerra a etapa atual antes de abrir a próxima, pra não ficarem as
      // duas abertas se algo falhar no meio.
      const { error: errFecha } = await supabase
        .from("tarefas")
        .update({ status: "feito", completed_at: agora })
        .eq("id", tarefa.id);
      if (errFecha) throw errFecha;

      if (proxima) {
        const { data: resp } = await supabase
          .from("usuarios")
          .select("id")
          .eq("email", proxima.email)
          .maybeSingle();
        const responsavelId = (resp as { id: string } | null)?.id ?? null;
        if (!responsavelId) {
          toast.warning(`Não achei o usuário ${proxima.email}`, {
            description: "A tarefa seguinte foi criada sem responsável — atribua à mão.",
          });
        }

        const cliente = tarefa.caso?.cliente?.nome ?? "";
        const { data: nova, error: errNova } = await supabase
          .from("tarefas")
          .insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            responsavel_id: responsavelId,
            tipo: "interna",
            status: "a_fazer",
            prioridade: 1,
            titulo: proxima.titulo + (cliente ? " - " + cliente : ""),
            descricao: proxima.descricao,
            due_at: venceEm(proxima.dias),
            origem: "manual",
            metadata: {
              ...(tarefa.metadata ?? {}),
              montagem_inicial: true,
              etapa: proxima.etapa,
              prazo_fatal: true,
              etapa_anterior: tarefa.id,
            },
          })
          .select("id")
          .single();
        if (errNova) throw errNova;
        marcarDestaque(nova.id as string);

        // Registra a passagem de bastão. INTERNO: é passo interno do
        // escritório, e cada andamento visível dispara e-mail ao parceiro —
        // quatro e-mails por caso seria ruído para quem está do lado de fora.
        if (tarefa.caso_id) {
          const { error: errAnd } = await supabase.from("andamentos").insert({
            caso_id: tarefa.caso_id,
            processo_admin_id: tarefa.processo_admin_id,
            processo_judicial_id: tarefa.processo_judicial_id,
            origem: "interno",
            titulo: proxima.andamento,
            descricao:
              ROTULO[etapa].titulo + " concluída. Segue para " +
              (proxima.etapa === "revisao" ? "revisão da Mara" : "protocolo") +
              ", com prazo de " + proxima.dias + " dias.",
            data_evento: agora,
            visivel_parceiro: false,
            metadata: { montagem_inicial: true, etapa_concluida: etapa },
          });
          // Andamento é registro, não pode derrubar o avanço da corrente.
          if (errAnd) {
            toast.warning("Etapa avançou, mas o registro no histórico falhou", {
              description: errAnd.message,
            });
          }
        }
      }

      // Última etapa: cadastra o processo (se veio número) e avisa o parceiro.
      if (ehUltima && tarefa.caso_id) {
        let processoJudicialId: string | null = tarefa.processo_judicial_id;
        const numero = numeroProcesso.trim();

        if (numero && !processoJudicialId) {
          const { data: proc, error: errProc } = await supabase
            .from("processos_judiciais")
            .insert({ caso_id: tarefa.caso_id, numero_processo: numero })
            .select("id")
            .single();
          if (errProc) {
            toast.warning("Não consegui cadastrar o processo judicial", {
              description: errProc.message + " — o número ficou registrado no andamento.",
            });
          } else {
            processoJudicialId = (proc as { id: string }).id;
          }
        }

        const { data: and, error: errAnd } = await supabase
          .from("andamentos")
          .insert({
            caso_id: tarefa.caso_id,
            processo_judicial_id: processoJudicialId,
            processo_admin_id: processoJudicialId ? null : tarefa.processo_admin_id,
            origem: "interno",
            titulo: "Inicial protocolada no judicial",
            descricao: numero
              ? "A petição inicial foi protocolada. Processo nº " + numero + "."
              : "A petição inicial foi protocolada no judicial.",
            data_evento: agora,
            visivel_parceiro: true,
            metadata: { montagem_inicial: true, numero_processo: numero || null },
          })
          .select("id")
          .single();
        if (errAnd) throw errAnd;
        marcarDestaque(and.id as string);
        supabase.functions
          .invoke("notify-novo-andamento", { body: { andamento_id: and.id } })
          .catch(() => {});
      }

      toast.success(
        ehUltima
          ? "Protocolo registrado. O parceiro foi avisado."
          : `${ROTULO[etapa].titulo} concluída.`,
        proxima
          ? { description: `${proxima.titulo} criada, vence em ${proxima.dias} dias.` }
          : undefined,
      );
      onUpdated();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || "Não foi possível avançar a etapa.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <div
      className={
        (compacto ? "space-y-1.5" : "space-y-2 rounded-md border p-3 bg-muted/20") + " text-sm"
      }
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {!compacto && (
        <div className="flex flex-wrap items-center gap-2">
          <Stamp className="h-4 w-4 text-[var(--gold)]" />
          <span className="font-medium">Montagem de inicial</span>
          <Badge variant="outline" className="font-normal">
            etapa {etapa === "montagem" ? "1" : etapa === "revisao" ? "2" : "3"} de 3 ·{" "}
            {ROTULO[etapa].titulo}
          </Badge>
        </div>
      )}

      {concluida ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          {ehUltima ? "Inicial protocolada." : `${ROTULO[etapa].titulo} concluída.`}
        </p>
      ) : (
        <>
          {ehUltima && (
            <div className="space-y-1">
              <Label className="text-xs">Número do processo (opcional)</Label>
              <Input
                value={numeroProcesso}
                onChange={(e) => setNumeroProcesso(e.target.value)}
                placeholder="0000000-00.0000.0.00.0000"
                disabled={agindo}
              />
              <p className="text-xs text-muted-foreground">
                Se ainda não saiu, deixe em branco — dá para cadastrar o processo depois
                na aba Processos.
              </p>
            </div>
          )}

          <Button type="button" size="sm" disabled={agindo} onClick={avancar}>
            {agindo ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : ehUltima ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {ROTULO[etapa].acao}
          </Button>

          {!compacto && !ehUltima && (
            <p className="text-xs text-muted-foreground">
              Ao clicar, esta tarefa é encerrada e a próxima nasce para{" "}
              {etapa === "montagem" ? "a Mara" : "a Bia"}, com{" "}
              {PROXIMA[etapa]?.dias} dias de prazo.
            </p>
          )}
        </>
      )}
    </div>
  );
}
