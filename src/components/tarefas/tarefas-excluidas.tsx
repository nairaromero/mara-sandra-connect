// Tarefas que saíram de circulação: as EXCLUÍDAS (log alimentado por trigger
// — ver migration_tarefas_autoria.sql) e as CANCELADAS antigas (status
// 'cancelado', legado da migração do Tramitação e de antes de "Cancelado"
// sair do menu em 2026-09-02).
//
// As duas juntas numa lista só desde 2026-09-09 (Naira): pra quem lê a tela,
// cancelada e excluída são a mesma coisa — tarefa descartada. A linha diz
// qual foi o caminho ("Excluída por X" × "Cancelada por X").
//
// É a metade direita da aba "Arquivados" (ao lado de "Feito"), na tela
// /tarefas e na aba Atividades do caso. Nenhuma das duas abre sheet: a
// excluída não existe mais, a cancelada é histórico fechado.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SecoesPorMes } from "@/components/tarefas/secoes-por-mes";
import { agruparPorMes } from "@/lib/tarefas/agrupar-mes";
import { cn } from "@/lib/utils";
import { listarTarefasCanceladas, listarTarefasExcluidas } from "@/lib/tarefas/queries";
import { formatarDataHoraCurtaBR, nomeAmigavel, nomeOuSistema } from "@/lib/tarefas/helpers";
import { STATUS_LABEL, type TarefaComJoins, type TarefaExcluidaRow } from "@/lib/tarefas/types";

interface Props {
  casoId?: string;
  mostrarCaso?: boolean;
  // Re-busca quando muda (ex.: depois de excluir uma tarefa na mesma tela).
  versao?: number;
  // Começa aberta? No caso (poucas linhas) sim; na tela geral, fechada.
  abertaInicial?: boolean;
  // Estilo do container. A /tarefas usa a seção como COLUNA da aba
  // Arquivados (ao lado de "Feito"), então passa a moldura da coluna.
  className?: string;
  // Dobrar por mês (tela geral, centenas de linhas). No caso são poucas e
  // um dropdown por mês só atrapalharia.
  porMes?: boolean;
}

// Linha da lista, já normalizada — vem de `tarefas_excluidas` ou de uma
// tarefa cancelada. `quando` é o que ordena as duas na mesma régua.
interface Linha {
  chave: string;
  titulo: string;
  // Rótulo do status que a tarefa tinha (badge). Nas canceladas é "Cancelado".
  statusLabel: string;
  verbo: "Excluída" | "Cancelada";
  autor: { id: string; nome: string | null } | null | undefined;
  // false = nem autor nem carimbo de autoria (canceladas anteriores ao
  // trigger). Aí a linha diz só QUANDO — chamar de "sistema" seria inventar.
  autoriaRegistrada: boolean;
  quando: string | null;
  casoId: string | null;
  clienteNome: string | null;
  responsavelNome: string | null;
}

function daExcluida(r: TarefaExcluidaRow): Linha {
  return {
    chave: "x:" + r.id,
    titulo: r.titulo,
    statusLabel: STATUS_LABEL[r.status] ?? r.status,
    verbo: "Excluída",
    autor: r.excluidor,
    autoriaRegistrada: true,
    quando: r.excluida_em,
    casoId: r.caso_id,
    clienteNome: r.caso?.cliente?.nome ?? null,
    responsavelNome: r.responsavel?.nome ?? null,
  };
}

function daCancelada(t: TarefaComJoins): Linha {
  return {
    chave: "c:" + t.id,
    titulo: t.titulo,
    statusLabel: STATUS_LABEL.cancelado,
    verbo: "Cancelada",
    autor: t.status_autor,
    autoriaRegistrada: !!(t.status_autor?.nome || t.status_alterado_em),
    // Antes da migration de autoria não há status_alterado_em; o updated_at
    // é a melhor aproximação de quando saiu de circulação.
    quando: t.status_alterado_em ?? t.updated_at ?? null,
    casoId: t.caso_id,
    clienteNome: t.caso?.cliente?.nome ?? null,
    responsavelNome: t.responsavel?.nome ?? null,
  };
}

export function TarefasExcluidas({
  casoId,
  mostrarCaso = false,
  versao = 0,
  abertaInicial = true,
  className,
  porMes = false,
}: Props) {
  const [rows, setRows] = useState<Linha[] | null>(null);
  // Alguma das duas fontes bateu o teto? Aí a lista está truncada e a UI diz.
  const [truncada, setTruncada] = useState(false);
  // Falha de consulta é falha, não "nada foi excluído" — sem isto a seção
  // inteira sumia da tela e a pessoa concluía que o log estava vazio
  // (revisão 2026-09-10). Agrava porque o Promise.all abaixo não isola as
  // fontes: uma quebrada derrubava as duas, calada.
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState(abertaInicial);

  const limite = casoId ? 100 : 50;

  useEffect(() => {
    let vivo = true;
    setErro(null);
    Promise.all([
      listarTarefasExcluidas({ caso_id: casoId, limite }),
      listarTarefasCanceladas({ caso_id: casoId, limite }),
    ])
      .then(([excluidas, canceladas]) => {
        if (!vivo) return;
        // Teto por FONTE, não no conjunto: as canceladas são de meses atrás e
        // um corte por data depois da mescla deixaria todas de fora, atrás
        // das exclusões recentes — que é justamente o que a Naira quer ver
        // junto.
        const linhas = [...excluidas.map(daExcluida), ...canceladas.map(daCancelada)];
        linhas.sort((a, b) => (b.quando ?? "").localeCompare(a.quando ?? ""));
        setTruncada(excluidas.length >= limite || canceladas.length >= limite);
        setRows(linhas);
      })
      .catch((e) => {
        console.error(e);
        if (!vivo) return;
        setRows([]);
        setTruncada(false);
        const msg = (e as { message?: string })?.message;
        setErro(msg || "Falha ao carregar as exclusões");
      });
    return () => {
      vivo = false;
    };
  }, [casoId, versao, limite]);

  // Sem nada excluído nem cancelado, a seção nem aparece (não polui a aba).
  // Erro, ao contrário, aparece sempre — é o que distingue "vazio" de "quebrou".
  if (rows && rows.length === 0 && !erro) return null;

  return (
    <section className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="flex items-center gap-2 text-left"
      >
        {aberta ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          Excluídas
        </h3>
        <Badge variant="outline" className="font-normal">
          {rows ? rows.length : <Loader2 className="h-3 w-3 animate-spin" />}
        </Badge>
        {rows && truncada && (
          <span className="text-xs text-muted-foreground">(últimas {limite} de cada)</span>
        )}
      </button>

      {aberta && erro && (
        <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          Não foi possível carregar as exclusões: {erro}
        </p>
      )}

      {aberta &&
        !erro &&
        rows &&
        (porMes ? (
          <SecoesPorMes grupos={agruparPorMes(rows, (r) => r.quando)}>
            {(itens) => (
              <ul className="rounded-md border bg-muted/30 divide-y">
                {itens.map((r) => (
                  <LinhaArquivada key={r.chave} r={r} mostrarCaso={mostrarCaso} />
                ))}
              </ul>
            )}
          </SecoesPorMes>
        ) : (
          <ul className="rounded-md border bg-muted/30 divide-y">
            {rows.map((r) => (
              <LinhaArquivada key={r.chave} r={r} mostrarCaso={mostrarCaso} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function LinhaArquivada({ r, mostrarCaso }: { r: Linha; mostrarCaso: boolean }) {
  return (
    <li className="px-3 py-2 text-xs space-y-0.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm line-through text-muted-foreground truncate min-w-0">
          {r.titulo}
        </span>
        <Badge variant="outline" className="font-normal text-[10px] shrink-0">
          {r.statusLabel}
        </Badge>
        {mostrarCaso &&
          (r.casoId && r.clienteNome ? (
            <Link
              to="/casos/$id"
              params={{ id: r.casoId }}
              className="ml-auto shrink-0 hover:underline text-foreground/80 truncate max-w-[220px]"
            >
              {nomeAmigavel(r.clienteNome)}
            </Link>
          ) : (
            <span className="ml-auto shrink-0 italic text-muted-foreground">
              {r.casoId ? "caso excluído" : "sem caso"}
            </span>
          ))}
      </div>
      <div className="text-muted-foreground">
        {r.verbo}
        {r.autoriaRegistrada && (
          <>
            {" por "}
            <span className="font-medium text-foreground">{nomeOuSistema(r.autor, true)}</span>
          </>
        )}
        {r.quando ? " em " + formatarDataHoraCurtaBR(r.quando) : ""}
        {r.responsavelNome ? ` · responsável: ${nomeAmigavel(r.responsavelNome)}` : ""}
      </div>
    </li>
  );
}
