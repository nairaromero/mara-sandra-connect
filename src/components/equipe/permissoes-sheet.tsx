// Ajuste de permissões de UMA pessoa, por cima do papel dela (/equipe, só admin).
//
// A lista vem do banco (`permissoes_do_membro`), nunca de uma matriz escrita
// aqui: foi a lição da auditoria de 24/09 — matriz em dois lugares diverge em
// silêncio. Cada linha diz se a permissão vem do PAPEL ou de um AJUSTE, e o
// ajuste é sempre a diferença: desfazer é voltar ao papel, não "remarcar".
//
// Tudo passa pela RPC, que confere as travas e AUDITA (pedido da Naira):
//   · só quem gerencia a equipe ajusta;
//   · ninguém ajusta a si mesma;
//   · ninguém concede o que não tem;
//   · o escritório nunca fica sem quem gerencia a equipe;
//   · parceiro só recebe o que o papel parceiro prevê.
//
// MARCAR NÃO SALVA (pedido da Naira, 2026-09-28). Até 28/09 cada clique no
// checkbox gravava na hora: marcar e desmarcar por engano escrevia duas linhas
// na Auditoria, e não havia como montar um conjunto de mudanças e revisar antes
// de aplicar. Agora o clique mexe num RASCUNHO local; só o botão Salvar
// escreve. Desfazer o clique some com a pendência — voltar ao estado do
// servidor não vira "mudança nenhuma para salvar".
//
// Uma exceção deliberada: "Voltar tudo ao papel" continua agindo na hora. Não é
// um marcador que se troca sem querer, é um botão que se aperta de propósito, e
// tem RPC própria que faz a limpeza inteira numa transação e deixa UMA linha na
// Auditoria — transformá-lo em N mudanças de rascunho trocaria isso por N
// linhas. Fica desabilitado enquanto houver rascunho, para não misturar os dois
// caminhos.
import { useCallback, useEffect, useState } from "react";
import { Info, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { ESCRITA } from "@/lib/rbac/exigencias";

/**
 * Permissões em que o escopo muda o resultado: são as que alguma policy cobra
 * com o ramo "próprio" (hoje tarefas e agenda). A lista sai do espelho
 * (src/lib/rbac/exigencias.ts), que o verificador confere contra o banco — não
 * de uma lista escrita aqui, que sairia do lugar em silêncio.
 */
const COM_ESCOPO = new Set(
  Object.values(ESCRITA)
    .flatMap((linha) => [linha.todas, linha.inserir, linha.atualizar, linha.excluir])
    .filter((e) => e?.proprio)
    .map((e) => e!.permissao),
);

interface LinhaPermissao {
  permissao: string;
  grupo: string;
  descricao: string;
  /** Explicação longa (banco, coluna `permissoes.detalhe`): o "i" da linha. */
  detalhe: string | null;
  sensivel: boolean;
  do_papel: boolean;
  tem: boolean;
  escopo: string | null;
  ajustada: boolean;
  definida_por_nome: string | null;
  definida_em: string | null;
}

/** O que a pessoa mexeu e ainda não salvou. */
interface Pendente {
  tem: boolean;
  escopo: string | null;
}

interface Props {
  pessoa: { id: string; nome: string | null; email: string | null; papel_nome: string } | null;
  onFechar: () => void;
  /** Recarrega a lista da tela de equipe (o papel pode ter mudado junto). */
  onMudou: () => void;
}

const mesmoEscopo = (a: string | null, b: string | null) => (a ?? "todos") === (b ?? "todos");

export function PermissoesSheet({ pessoa, onFechar, onMudou }: Props) {
  const [linhas, setLinhas] = useState<Array<LinhaPermissao>>([]);
  const [carregando, setCarregando] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, Pendente>>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<Array<LinhaPermissao> | null>(null);
  const [descartar, setDescartar] = useState(false);
  const [resetando, setResetando] = useState(false);

  const carregar = useCallback(async () => {
    if (!pessoa) return;
    setCarregando(true);
    const { data, error } = await supabase.rpc("permissoes_do_membro", { p_usuario_id: pessoa.id });
    setCarregando(false);
    // Falha de leitura não pode virar "não tem permissão nenhuma": a tela
    // mostraria tudo desmarcado e um clique gravaria o contrário do que é.
    if (error) {
      toast.error(error.message);
      setLinhas([]);
      return;
    }
    setLinhas((data ?? []) as Array<LinhaPermissao>);
  }, [pessoa]);

  useEffect(() => {
    setRascunho({});
    void carregar();
  }, [carregar]);

  /** O que a tela mostra: o rascunho quando existe, senão o que o banco disse. */
  const estado = (l: LinhaPermissao): Pendente =>
    rascunho[l.permissao] ?? { tem: l.tem, escopo: l.escopo };

  /**
   * Registra uma intenção. Quando ela volta a ser exatamente o que o servidor
   * tem, a pendência SOME — marcar e desmarcar não deixa nada para salvar.
   */
  function propor(l: LinhaPermissao, mudanca: Partial<Pendente>) {
    const novo = { ...estado(l), ...mudanca };
    setRascunho((r) => {
      const copia = { ...r };
      if (novo.tem === l.tem && mesmoEscopo(novo.escopo, l.escopo)) delete copia[l.permissao];
      else copia[l.permissao] = novo;
      return copia;
    });
  }

  const pendentes = linhas.filter((l) => rascunho[l.permissao]);
  const ajustes = linhas.filter((l) => l.ajustada).length;
  const grupos = [...new Set(linhas.map((l) => l.grupo))];

  /** Sensíveis que ESTE salvamento passa a conceder (as que já tinha não contam). */
  const sensiveisConcedidas = pendentes.filter((l) => rascunho[l.permissao].tem && !l.tem && l.sensivel);

  async function gravar() {
    if (!pessoa) return;
    setSalvando(true);
    const falhas: Array<string> = [];
    const gravadas: Array<string> = [];
    for (const l of pendentes) {
      const p = rascunho[l.permissao];
      // Escopo diferente do efetivo de hoje é sempre "conceder com escopo".
      // Sem mudança de escopo: voltar ao que o papel dá grava "papel", para a
      // tabela guardar só a diferença de verdade.
      const mudouEscopo = !mesmoEscopo(p.escopo, l.escopo);
      const estadoRpc = mudouEscopo ? "conceder" : p.tem === l.do_papel ? "papel" : p.tem ? "conceder" : "remover";
      const { error } = await supabase.rpc("definir_permissao_do_membro", {
        p_usuario_id: pessoa.id,
        p_permissao: l.permissao,
        p_estado: estadoRpc,
        ...(mudouEscopo ? { p_escopo: p.escopo ?? "todos" } : {}),
      });
      if (error) falhas.push(`${l.permissao}: ${error.message}`);
      else gravadas.push(l.permissao);
    }
    setSalvando(false);

    // O que gravou sai do rascunho; o que falhou FICA, para a pessoa ver o que
    // ainda está pendente em vez de perder a intenção junto com o erro.
    setRascunho((r) => {
      const copia = { ...r };
      for (const chave of gravadas) delete copia[chave];
      return copia;
    });
    if (gravadas.length) {
      const quantas = gravadas.length === 1 ? "1 permissão salva" : `${gravadas.length} permissões salvas`;
      toast.success(`${quantas} para ${pessoa.nome ?? "a pessoa"}.`);
    }
    for (const f of falhas) toast.error(f);
    await carregar();
    onMudou();
  }

  function salvar() {
    // Sensível só pergunta na hora de gravar — perguntar a cada marcação
    // interromperia quem ainda está montando o conjunto.
    if (sensiveisConcedidas.length) return setConfirmar(sensiveisConcedidas);
    void gravar();
  }

  async function voltarTudoAoPapel() {
    if (!pessoa) return;
    setResetando(true);
    const { data, error } = await supabase.rpc("resetar_permissoes_do_membro", { p_usuario_id: pessoa.id });
    setResetando(false);
    if (error) return toast.error(error.message);
    toast.success(`${data ?? 0} ajuste(s) desfeito(s). A pessoa volta ao papel.`);
    await carregar();
    onMudou();
  }

  /** Fechar com rascunho aberto pergunta antes — senão a intenção some calada. */
  function tentarFechar() {
    if (pendentes.length) return setDescartar(true);
    onFechar();
  }

  return (
    <>
      <Sheet open={!!pessoa} onOpenChange={(o) => !o && tentarFechar()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-permissoes-sheet>
          <SheetHeader>
            <SheetTitle>Permissões de {pessoa?.nome ?? pessoa?.email}</SheetTitle>
            <SheetDescription>
              Papel: <strong>{pessoa?.papel_nome}</strong>
              {ajustes > 0 ? `, com ${ajustes} ajuste${ajustes > 1 ? "s" : ""}` : " (sem ajustes)"}.
              Marcar ou desmarcar muda só esta pessoa; o papel continua valendo para as demais.
              Nada é gravado até você salvar, e toda mudança salva fica na Auditoria.
            </SheetDescription>
          </SheetHeader>

          {carregando ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6 py-4">
              {grupos.map((g) => (
                <div key={g} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</h3>
                  <ul className="space-y-2">
                    {linhas.filter((l) => l.grupo === g).map((l) => {
                      const e = estado(l);
                      const pendente = !!rascunho[l.permissao];
                      return (
                        <li key={l.permissao} className="flex items-start gap-3" data-permissao={l.permissao}>
                          <Checkbox
                            id={`perm-${l.permissao}`}
                            checked={e.tem}
                            disabled={salvando}
                            onCheckedChange={(v) => propor(l, { tem: v === true })}
                            aria-label={l.descricao}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <label htmlFor={`perm-${l.permissao}`} className="text-sm cursor-pointer">
                                {l.descricao}
                              </label>
                              {/* O "i": o que a permissão faz, onde aparece e o
                                  que NÃO cobre. O texto vem do banco. */}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground shrink-0"
                                    aria-label={`O que "${l.descricao}" permite`}
                                    data-detalhe={l.permissao}
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-80 text-sm leading-relaxed">
                                  <p className="font-medium mb-1">{l.descricao}</p>
                                  <p className="text-muted-foreground" data-detalhe-texto>
                                    {l.detalhe ?? "Esta permissão ainda não tem explicação cadastrada."}
                                  </p>
                                  {l.sensivel && (
                                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                                      Sensível: por padrão só quem administra o escritório tem.
                                    </p>
                                  )}
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <code className="text-[11px] text-muted-foreground">{l.permissao}</code>
                              {e.escopo && e.escopo !== "todos" && (
                                <Badge variant="outline" className="text-[10px]">
                                  {e.escopo === "atribuidos" ? "só os atribuídos" : e.escopo}
                                </Badge>
                              )}
                              {l.sensivel && (
                                <Badge variant="outline" className="text-[10px] border-amber-500/50">
                                  <ShieldAlert className="h-3 w-3 mr-0.5" />
                                  sensível
                                </Badge>
                              )}
                              {e.tem && COM_ESCOPO.has(l.permissao) && (
                                <select
                                  className="h-6 rounded border bg-background px-1 text-[11px]"
                                  value={e.escopo ?? "todos"}
                                  aria-label={`Alcance de ${l.permissao}`}
                                  data-escopo={l.permissao}
                                  disabled={salvando}
                                  onChange={(ev) => propor(l, { escopo: ev.target.value })}
                                >
                                  <option value="todos">todos do escritório</option>
                                  <option value="atribuidos">só os atribuídos a ela</option>
                                </select>
                              )}
                              {l.ajustada && (
                                <>
                                  <Badge className="text-[10px]" data-ajustada>ajustado</Badge>
                                  <button
                                    type="button"
                                    className="text-[11px] underline text-muted-foreground hover:text-foreground"
                                    onClick={() => propor(l, { tem: l.do_papel, escopo: null })}
                                    disabled={salvando}
                                  >
                                    voltar ao papel
                                  </button>
                                </>
                              )}
                              {pendente && (
                                <Badge variant="outline" className="text-[10px] border-sky-500/60 text-sky-700 dark:text-sky-400" data-nao-salvo>
                                  não salvo
                                </Badge>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Grudado no rodapé: são 26 permissões numa gaveta que rola, e um
              botão Salvar abaixo da dobra faria a pessoa marcar no topo e
              procurar onde gravar. O `-mx-6 px-6` cancela o padding do
              SheetContent para a faixa cobrir a largura toda. */}
          <SheetFooter className="gap-2 sm:flex-row sm:justify-between sticky bottom-0 z-10 -mx-6 -mb-6 border-t bg-background px-6 py-3">
            <Button
              variant="outline"
              onClick={() => void voltarTudoAoPapel()}
              disabled={resetando || ajustes === 0 || pendentes.length > 0 || salvando}
              title={pendentes.length > 0 ? "Salve ou descarte as mudanças antes" : undefined}
              data-voltar-ao-papel
            >
              {resetando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Voltar tudo ao papel
            </Button>
            <div className="flex gap-2">
              {pendentes.length > 0 && (
                <Button variant="ghost" onClick={() => setRascunho({})} disabled={salvando} data-descartar>
                  Descartar
                </Button>
              )}
              <Button onClick={tentarFechar} variant={pendentes.length ? "outline" : "default"} disabled={salvando}>
                Fechar
              </Button>
              <Button onClick={salvar} disabled={pendentes.length === 0 || salvando} data-salvar-permissoes>
                {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {pendentes.length > 0 ? `Salvar ${pendentes.length} mudança${pendentes.length > 1 ? "s" : ""}` : "Salvar"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Conceder {confirmar && confirmar.length > 1 ? `${confirmar.length} permissões sensíveis` : "uma permissão sensível"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pessoa?.nome ?? "A pessoa"} passa a poder:
              {" "}
              {(confirmar ?? []).map((l) => l.descricao.toLowerCase()).join("; ")}.
              {" "}
              {confirmar && confirmar.length > 1 ? "São permissões que, por padrão, só quem administra" : "É uma permissão que, por padrão, só quem administra"}
              {" "}o escritório tem. Fica registrado na Auditoria com o seu nome.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmar(null);
                void gravar();
              }}
            >
              Conceder e salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={descartar} onOpenChange={setDescartar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendentes.length} mudança{pendentes.length > 1 ? "s" : ""} ainda não {pendentes.length > 1 ? "foram gravadas" : "foi gravada"}.
              Sair agora descarta {pendentes.length > 1 ? "todas" : "a mudança"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDescartar(false);
                setRascunho({});
                onFechar();
              }}
            >
              Sair sem salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
