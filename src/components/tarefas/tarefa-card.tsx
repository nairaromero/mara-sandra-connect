// Card de tarefa para o kanban / listas. Click no corpo abre o sheet de
// edição. Dropdown "..." muda status sem abrir o sheet. Cor do badge de
// prazo segue a urgência (urgencia.ts).

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, MoreVertical, Trash2, User as UserIcon, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DESTAQUE_CLASSE_GLOBAL, useDestaqueAtivo } from "@/lib/destaque/destaque-context";
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
import { AcompanhamentoPericia } from "@/components/tarefas/acompanhamento-pericia";
import { AcompanhamentoImplementacao } from "@/components/tarefas/acompanhamento-implementacao";
import { MontagemInicial } from "@/components/tarefas/montagem-inicial";
import { ComparecimentoPericia } from "@/components/tarefas/comparecimento-pericia";
import { EnviarAvisoParceiro } from "@/components/tarefas/enviar-aviso-parceiro";
import { EtapaCumprimentoExigencia } from "@/components/tarefas/etapa-cumprimento-exigencia";
import { EtapaProtocoloRealizado } from "@/components/tarefas/etapa-protocolo-realizado";
import {
  descreverAutoriaStatus,
  formatarDueAtCurto,
  formatarDueAtLongo,
  iniciaisDoNome,
  nomeAmigavel,
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
  // Layout enxuto pro kanban: sem descricao (mora no sheet), meta numa linha
  // so, responsavel como iniciais. O layout cheio segue nas outras telas.
  compacto?: boolean;
}

export function TarefaCard({
  tarefa,
  onOpenSheet,
  onChangeStatus,
  onDelete,
  onChanged,
  mostrarCaso = true,
  compacto = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const urg = urgenciaDoDueAt(tarefa.due_at, tarefa.status);
  const clienteNome = tarefa.caso?.cliente?.nome ?? null;
  // Caso com admin E judicial correndo juntos: o badge diz de qual esfera é o
  // prazo. Número curto = trecho antes do primeiro ponto (CNJ) ou o próprio.
  const procJud = tarefa.processo_judicial?.numero_processo ?? null;
  const procAdm = tarefa.processo_admin?.numero_requerimento ?? null;
  const numeroCurto = (n: string) => (n.includes(".") ? n.split(".")[0] : n.slice(0, 12));
  const PROC_BADGE_JUD = "border-[var(--gold)] text-amber-800 dark:text-amber-300";
  const PROC_BADGE_ADM = "border-sky-500 text-sky-700 dark:text-sky-400";
  const ehAcompProcessual =
    (tarefa.metadata as { acompanhamento_processual?: boolean })?.acompanhamento_processual ===
    true;
  const ehAcompPericia =
    (tarefa.metadata as { acompanhamento_pericia?: boolean })?.acompanhamento_pericia === true;
  const ehMontagemInicial =
    (tarefa.metadata as { montagem_inicial?: boolean })?.montagem_inicial === true;
  const ehAcompImplementacao =
    (tarefa.metadata as { acompanhamento_implementacao?: boolean })
      ?.acompanhamento_implementacao === true;
  const ehComparecimento =
    (tarefa.metadata as { confirmar_comparecimento?: boolean })?.confirmar_comparecimento === true;
  const ehEnviarAviso = !!(tarefa.metadata as { enviar_aviso?: object })?.enviar_aviso;
  // Chip "Perícia · dd/mm" / "Audiência · dd/mm": a tarefa carrega a data do
  // evento que a ancorou (pedido da Naira: dava pra saber que a tarefa era
  // SOBRE uma perícia, mas não de quando).
  const periciaEm = (tarefa.metadata as { pericia_em?: string })?.pericia_em ?? null;
  const refAudiencia = String(
    (tarefa.metadata as { template_aplicado?: string })?.template_aplicado ?? "",
  ).includes("audiencia");
  const ehCumprimentoExigencia =
    (tarefa.metadata as { cumprimento_exigencia?: boolean })?.cumprimento_exigencia === true;
  const ehProtocoloRealizado =
    (tarefa.metadata as { protocolo_realizado?: boolean })?.protocolo_realizado === true;
  const destacado = useDestaqueAtivo(tarefa.id);
  // Arquivadas: quem concluiu/cancelou e quando (trigger de autoria).
  const autoria = descreverAutoriaStatus(tarefa);
  const AutoriaIcon = tarefa.status === "feito" ? CheckCircle2 : XCircle;

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
      <div className={cn("space-y-2", compacto ? "p-2" : "p-3")}>
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0 space-y-1">
            <div
              className={cn(
                "font-medium leading-snug break-words",
                compacto ? "text-[13px]" : "text-sm",
              )}
            >
              {tarefa.titulo}
            </div>
            {!compacto && tarefa.descricao && (
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

        {compacto ? (
          // Meta numa linha: prazo + prioridade (so urgente/alta) + cliente +
          // iniciais do responsavel. Tipo sai do card (mora no sheet/filtro).
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
            <Badge
              variant="outline"
              className={cn(
                "font-normal px-1.5 py-0 text-[11px] shrink-0",
                URGENCIA_BADGE_CLASS[urg],
              )}
            >
              {formatarDueAtCurto(tarefa.due_at)}
            </Badge>
            {tarefa.prioridade <= 2 && (
              <span
                className={cn(
                  "shrink-0 font-medium",
                  tarefa.prioridade === 1
                    ? "text-destructive"
                    : "text-amber-700 dark:text-amber-300",
                )}
              >
                {PRIORIDADE_LABEL[tarefa.prioridade]}
              </span>
            )}
            {(tarefa.processo_judicial || tarefa.processo_admin) && (
              <Badge
                variant="outline"
                className={cn(
                  "font-normal px-1.5 py-0 text-[10px] shrink-0",
                  tarefa.processo_judicial ? PROC_BADGE_JUD : PROC_BADGE_ADM,
                )}
                title={procJud ?? procAdm ?? undefined}
              >
                {tarefa.processo_judicial ? "Jud" : "Adm"}
              </Badge>
            )}
            {mostrarCaso && tarefa.caso_id ? (
              <Link
                to="/casos/$id"
                params={{ id: tarefa.caso_id }}
                className="hover:underline truncate min-w-0 flex-1 text-foreground/80"
                onClick={(e) => e.stopPropagation()}
              >
                {clienteNome ? nomeAmigavel(clienteNome) : "Ver caso"}
              </Link>
            ) : (
              <span className="flex-1" />
            )}
            <span
              className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground/70"
              title={tarefa.responsavel?.nome ?? "Sem responsável"}
            >
              {iniciaisDoNome(tarefa.responsavel?.nome ?? null)}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <Badge variant="outline" className={cn("font-normal", URGENCIA_BADGE_CLASS[urg])}>
                <CalendarDays className="h-3 w-3" />
                {formatarDueAtLongo(tarefa.due_at)}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {TIPO_LABEL[tarefa.tipo]}
              </Badge>
              {periciaEm && (
                <Badge
                  variant="outline"
                  className={cn(
                    "font-normal",
                    refAudiencia
                      ? "border-blue-500/50 text-blue-700 dark:text-blue-300"
                      : "border-emerald-500/50 text-emerald-700 dark:text-emerald-300",
                  )}
                  title={new Date(periciaEm).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                >
                  {refAudiencia ? "Audiência" : "Perícia"} ·{" "}
                  {new Date(periciaEm).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    timeZone: "America/Sao_Paulo",
                  })}
                </Badge>
              )}
              {tarefa.processo_judicial && (
                <Badge
                  variant="outline"
                  className={cn("font-normal", PROC_BADGE_JUD)}
                  title={procJud ?? undefined}
                >
                  Judicial{procJud ? ` · ${numeroCurto(procJud)}` : ""}
                </Badge>
              )}
              {tarefa.processo_admin && (
                <Badge
                  variant="outline"
                  className={cn("font-normal", PROC_BADGE_ADM)}
                  title={procAdm ?? undefined}
                >
                  Admin{procAdm ? ` · ${numeroCurto(procAdm)}` : ""}
                </Badge>
              )}
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
                <span className="truncate">{tarefa.responsavel?.nome ?? "Sem responsável"}</span>
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
          </>
        )}

        {autoria && (
          <div
            className={cn(
              "flex items-center gap-1 text-muted-foreground",
              compacto ? "text-[11px]" : "text-xs",
            )}
          >
            <AutoriaIcon
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                tarefa.status === "feito" ? "text-emerald-600" : "text-muted-foreground",
              )}
            />
            <span className="truncate">{autoria}</span>
          </div>
        )}

        {ehAcompProcessual && (
          <EtapasAcompanhamento
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehAcompPericia && (
          <AcompanhamentoPericia
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehMontagemInicial && (
          <MontagemInicial
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehAcompImplementacao && (
          <AcompanhamentoImplementacao
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehComparecimento && (
          <ComparecimentoPericia
            tarefa={tarefa}
            onUpdated={onChanged ?? (() => {})}
            compacto
            stopPropagation
          />
        )}

        {ehEnviarAviso && (
          <EnviarAvisoParceiro
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
