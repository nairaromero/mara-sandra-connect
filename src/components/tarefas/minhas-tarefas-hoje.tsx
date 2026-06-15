// Widget compacto "Minhas tarefas hoje" para a home (casos.index).
// Lista tarefas em a_fazer/fazendo do usuário com due_at <= hoje (inclui atrasadas).

import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, ListTodo, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listarTarefas } from "@/lib/tarefas/queries";
import {
  formatarDueAtLongo,
  URGENCIA_BADGE_CLASS,
  urgenciaDoDueAt,
} from "@/lib/tarefas/helpers";
import {
  PRIORIDADE_LABEL,
  TIPO_LABEL,
  type TarefaComJoins,
} from "@/lib/tarefas/types";

interface Props {
  usuarioId: string;
}

export function MinhasTarefasHoje({ usuarioId }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [tarefas, setTarefas] = useState<TarefaComJoins[]>([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarTarefas({ apenas_minhas_hoje: { usuario_id: usuarioId } });
      setTarefas(data);
    } catch (e) {
      console.error(e);
    } finally {
      setCarregando(false);
    }
  }, [usuarioId]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListTodo className="h-4 w-4" />
          Minhas tarefas hoje
          {!carregando && tarefas.length > 0 && (
            <Badge variant="outline" className="font-normal">{tarefas.length}</Badge>
          )}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/tarefas">Ver todas</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {carregando ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : tarefas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada pra hoje. Boa! 🌤️
          </p>
        ) : (
          <ul className="space-y-2">
            {tarefas.map((t) => {
              const urg = urgenciaDoDueAt(t.due_at, t.status);
              return (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className={cn("font-normal shrink-0 mt-0.5", URGENCIA_BADGE_CLASS[urg])}>
                    <CalendarDays className="h-3 w-3" />
                    {formatarDueAtLongo(t.due_at)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.titulo}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {TIPO_LABEL[t.tipo]}
                      {t.prioridade <= 2 && ` · ${PRIORIDADE_LABEL[t.prioridade]}`}
                      {t.caso?.cliente?.nome && ` · ${t.caso.cliente.nome}`}
                    </div>
                  </div>
                  {t.caso_id && (
                    <Button asChild variant="ghost" size="sm" className="shrink-0">
                      <Link to="/casos/$id" params={{ id: t.caso_id }}>
                        Ver
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
