// Card de tarefa para o kanban / listas. Click no corpo abre o sheet de
// edição. Dropdown "..." muda status sem abrir o sheet. Cor do badge de
// prazo segue a urgência (urgencia.ts).

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, MoreVertical, Trash2, User as UserIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DESTAQUE_CLASSE_GLOBAL,
  useDestaqueAtivo,
} from "@/lib/destaque/destaque-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EtapasAcompanhamento } from "@/components/tarefas/etapas-acompanhamento";
import { EtapaCumprimentoExigencia } from "@/components/tarefas/etapa-cumprimento-exigencia";
import { EtapaProtocoloRealizado } from "@/components/tarefas/etapa-protocolo-realizado";
import {
  formatarDueAtLongo,
  URGENCIA_BADGE_CLASS,
  urgenciaDoDueAt,
} from "@/lib/tarefas/helpers";
import {
  PRIORIDADE_LABEL,
  STATUS_LABEL,
  STATUS_ORDEM,
  TIPO_LABEL,
  type TarefaComJoins,
  type TarefaStatus,
} from "@/lib/tarefas/types";

interface Props {
  tarefa: TarefaComJoins;
  onOpenSheet: (id: string) => void;
  onChangeStatus: (id: string, status: TarefaStatus) => void;
  onDelete: (id: string) => void;
  onChanged?: () => void;
  mostrarCaso?: boolean;
}

export function TarefaCard({
  tarefa,
  onOpenSheet,
  onChangeStatus,
  onDelete,
  onChanged,
  mostrarCaso = true,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const urg = urgenciaDoDueAt(tarefa.due_at, tarefa.status);
  const clienteNome = tarefa.caso?.cliente?.nome ?? null;
  const ehAcompProcessual =
    (tarefa.metadata as { acompanhamento_processual?: boolean })?.acompanhamento_processual === true;
  const ehCumprimentoExigencia =
    (tarefa.metadata as { cumprimento_exigencia?: boolean })?.cumprimento_exigencia === true;
  const ehProtocoloRealizado =
    (tarefa.metadata as { protocolo_realizado?: boolean })?.protocolo_realizado === true;
  const destacado = useDestaqueAtivo(tarefa.id);

  return (
    <div
      className={cn(
        "group rounded-md border bg-card text-card-foreground shadow-sm hover:shadow transition-shadow cursor-pointer",
        destacado && DESTAQUE_CLASSE_GLOBAL,
      )}
      onClick={() => onOpenSheet(tarefa.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenSheet(tarefa.id);
        }
      }}
    >
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="font-medium text-sm leading-snug break-words">
              {tarefa.titulo}
            </div>
            {tarefa.descricao && (
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                {tarefa.descricao}
              </p>
            )}
          </div>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 -mt-1 -mr-1 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
                aria-label="Ações da tarefa"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {STATUS_ORDEM.filter((s) => s !== tarefa.status).map((s) => (
                <DropdownMenuItem key={s} onSelect={() => onChangeStatus(tarefa.id, s)}>
                  {STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onDelete(tarefa.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <Badge variant="outline" className={cn("font-normal", URGENCIA_BADGE_CLASS[urg])}>
            <CalendarDays className="h-3 w-3" />
            {formatarDueAtLongo(tarefa.due_at)}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {TIPO_LABEL[tarefa.tipo]}
          </Badge>
          {tarefa.prioridade <= 2 && (
            <Badge
              variant="outline"
              className={cn(
                "font-normal",
                tarefa.prioridade === 1
                  ? "border-destructive/50 text-destructive"
                  : "border-amber-500/40 text-amber-700 dark:text-amber-300",
              )}
            >
              {PRIORIDADE_LABEL[tarefa.prioridade]}
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1 min-w-0">
            <UserIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {tarefa.responsavel?.nome ?? "Sem responsável"}
            </span>
          </div>
          {mostrarCaso && tarefa.caso_id && (
            <Link
              to="/casos/$id"
              params={{ id: tarefa.caso_id }}
              className="hover:underline truncate max-w-[60%] text-right"
              onClick={(e) => e.stopPropagation()}
            >
              {clienteNome ?? "Ver caso"}
            </Link>
          )}
        </div>

        {ehAcompProcessual && (
          <EtapasAcompanhamento
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehCumprimentoExigencia && (
          <EtapaCumprimentoExigencia
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehProtocoloRealizado && (
          <EtapaProtocoloRealizado
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}
      </div>
    </div>
  );
}
