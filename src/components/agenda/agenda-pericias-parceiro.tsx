// Agenda do PARCEIRO — só leitura, perícias E audiências dos casos dele, no
// MESMO calendário mensal da equipe (AgendaMes). Era "Perícias" (só perícias)
// até 2026-08-31; virou "Agenda" quando as audiências passaram a ser expostas
// de forma estruturada (kanban de tarefas do parceiro).
//
// Os dados vêm da RPC agenda_do_parceiro() (SECURITY DEFINER): a RLS de
// agenda_eventos e tarefas é só-interno, então a função devolve a união
// sanitizada (eventos de agenda + tarefas de perícia) já filtrada por
// casos.parceiro_id = auth.uid(). Aqui só mapeamos pro formato do calendário.

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2 } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { AgendaMes } from "@/components/agenda/agenda-mes";
import { useVerComoParceiro } from "@/hooks/use-ver-como-parceiro";
import type { AgendaEventoComJoins } from "@/lib/agenda/types";

interface CompromissoParceiro {
  fonte: "evento" | "tarefa";
  id: string;
  caso_id: string | null;
  tipo: "pericia" | "audiencia";
  cliente_nome: string | null;
  titulo: string;
  start_at: string;
  end_at: string;
  local: string | null;
  natureza: "admin" | "judicial" | null;
}

// Mapeia o compromisso do parceiro pro formato que o calendário (AgendaMes)
// consome. natureza -> processo_*_id só pra o badge sair com a cor certa
// (naturezaPericia checa judicial, depois admin).
function paraEvento(p: CompromissoParceiro): AgendaEventoComJoins {
  return {
    id: `${p.fonte}:${p.id}`,
    caso_id: p.caso_id,
    processo_admin_id: p.natureza === "admin" ? p.caso_id : null,
    processo_judicial_id: p.natureza === "judicial" ? p.caso_id : null,
    responsavel_id: null,
    tipo: p.tipo,
    titulo: p.titulo,
    descricao: null,
    start_at: p.start_at,
    end_at: p.end_at,
    local: p.local,
    participantes: null,
    metadata: {},
    concluido_em: null,
    concluido_por: null,
    gcal_event_id: null,
    gcal_calendar_id: null,
    gcal_synced_at: null,
    created_by: null,
    created_at: p.start_at,
    updated_at: p.start_at,
    responsavel: null,
    caso: p.caso_id ? { id: p.caso_id, cliente: { id: "", nome: p.cliente_nome } } : null,
  };
}

export function AgendaPericiasParceiro() {
  const navigate = useNavigate();
  const [carregando, setCarregando] = useState(true);
  const [compromissos, setCompromissos] = useState<CompromissoParceiro[]>([]);

  const { verComo } = useVerComoParceiro();
  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      // Admin em "ver como": passa o parceiro alvo (a RPC só aceita de admin).
      // Sem corte de data — o calendário mostra passado e futuro.
      const { data, error } = await supabase.rpc("agenda_do_parceiro", {
        p_desde: null,
        p_parceiro_id: verComo?.parceiroId ?? null,
      });
      if (error) throw error;
      setCompromissos((data ?? []) as CompromissoParceiro[]);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar a agenda.");
    } finally {
      setCarregando(false);
    }
  }, [verComo?.parceiroId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const eventos = useMemo(() => compromissos.map(paraEvento), [compromissos]);
  // Lookup id do evento -> caso, pra abrir o caso ao clicar.
  const casoPorEvento = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of compromissos) {
      if (p.caso_id) m.set(`${p.fonte}:${p.id}`, p.caso_id);
    }
    return m;
  }, [compromissos]);

  function aoClicarEvento(id: string) {
    const casoId = casoPorEvento.get(id);
    if (casoId) navigate({ to: "/casos/$id", params: { id: casoId } });
  }

  if (carregando) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <CalendarDays className="h-6 w-6" />
          Agenda
        </h1>
        <p className="text-sm text-muted-foreground">
          Calendário das perícias e audiências dos seus clientes. Clique num compromisso para
          abrir o caso.
        </p>
      </div>

      <AgendaMes eventos={eventos} onEventoClick={aoClicarEvento} />
    </div>
  );
}
