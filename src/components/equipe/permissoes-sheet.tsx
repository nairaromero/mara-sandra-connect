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
import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface LinhaPermissao {
  permissao: string;
  grupo: string;
  descricao: string;
  sensivel: boolean;
  do_papel: boolean;
  tem: boolean;
  escopo: string | null;
  ajustada: boolean;
  definida_por_nome: string | null;
  definida_em: string | null;
}

interface Props {
  pessoa: { id: string; nome: string | null; email: string | null; papel_nome: string } | null;
  onFechar: () => void;
  /** Recarrega a lista da tela de equipe (o papel pode ter mudado junto). */
  onMudou: () => void;
}

export function PermissoesSheet({ pessoa, onFechar, onMudou }: Props) {
  const [linhas, setLinhas] = useState<Array<LinhaPermissao>>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<LinhaPermissao | null>(null);
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
    void carregar();
  }, [carregar]);

  async function aplicar(l: LinhaPermissao, marcar: boolean) {
    if (!pessoa) return;
    // Voltar ao papel quando o novo estado é o que o papel já dá — assim a
    // tabela guarda só a diferença de verdade.
    const estado = marcar === l.do_papel ? "papel" : marcar ? "conceder" : "remover";
    setSalvando(l.permissao);
    const { error } = await supabase.rpc("definir_permissao_do_membro", {
      p_usuario_id: pessoa.id,
      p_permissao: l.permissao,
      p_estado: estado,
    });
    setSalvando(null);
    if (error) return toast.error(error.message);
    toast.success(
      estado === "papel"
        ? `${l.permissao}: de volta ao papel`
        : `${l.permissao}: ${marcar ? "concedida" : "removida"} para ${pessoa.nome ?? "a pessoa"}`,
    );
    await carregar();
    onMudou();
  }

  function clicar(l: LinhaPermissao, marcar: boolean) {
    // Sensível e concedendo: confirma com o efeito escrito.
    if (marcar && l.sensivel) return setConfirmar(l);
    void aplicar(l, marcar);
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

  const ajustes = linhas.filter((l) => l.ajustada).length;
  const grupos = [...new Set(linhas.map((l) => l.grupo))];

  return (
    <>
      <Sheet open={!!pessoa} onOpenChange={(o) => !o && onFechar()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-permissoes-sheet>
          <SheetHeader>
            <SheetTitle>Permissões de {pessoa?.nome ?? pessoa?.email}</SheetTitle>
            <SheetDescription>
              Papel: <strong>{pessoa?.papel_nome}</strong>
              {ajustes > 0 ? `, com ${ajustes} ajuste${ajustes > 1 ? "s" : ""}` : " (sem ajustes)"}.
              Marcar ou desmarcar muda só esta pessoa; o papel continua valendo para as demais.
              Toda mudança fica na Auditoria.
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
                    {linhas.filter((l) => l.grupo === g).map((l) => (
                      <li key={l.permissao} className="flex items-start gap-3" data-permissao={l.permissao}>
                        <Checkbox
                          id={`perm-${l.permissao}`}
                          checked={l.tem}
                          disabled={salvando === l.permissao}
                          onCheckedChange={(v) => clicar(l, v === true)}
                          aria-label={l.descricao}
                        />
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`perm-${l.permissao}`} className="text-sm cursor-pointer">
                            {l.descricao}
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <code className="text-[11px] text-muted-foreground">{l.permissao}</code>
                            {l.escopo && l.escopo !== "todos" && (
                              <Badge variant="outline" className="text-[10px]">
                                {l.escopo === "atribuidos" ? "só os atribuídos" : l.escopo}
                              </Badge>
                            )}
                            {l.sensivel && (
                              <Badge variant="outline" className="text-[10px] border-amber-500/50">
                                <ShieldAlert className="h-3 w-3 mr-0.5" />
                                sensível
                              </Badge>
                            )}
                            {l.ajustada && (
                              <>
                                <Badge className="text-[10px]" data-ajustada>ajustado</Badge>
                                <button
                                  type="button"
                                  className="text-[11px] underline text-muted-foreground hover:text-foreground"
                                  onClick={() => void aplicar(l, l.do_papel)}
                                  disabled={salvando === l.permissao}
                                >
                                  voltar ao papel
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {salvando === l.permissao && <Loader2 className="h-4 w-4 animate-spin mt-0.5" />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <SheetFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => void voltarTudoAoPapel()}
              disabled={resetando || ajustes === 0}
              data-voltar-ao-papel
            >
              {resetando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Voltar tudo ao papel
            </Button>
            <Button onClick={onFechar}>Fechar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conceder uma permissão sensível?</AlertDialogTitle>
            <AlertDialogDescription>
              {pessoa?.nome ?? "A pessoa"} passa a poder: {confirmar?.descricao.toLowerCase()}. É uma
              permissão que, por padrão, só quem administra o escritório tem. Fica registrado na
              Auditoria com o seu nome.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const l = confirmar;
                setConfirmar(null);
                if (l) void aplicar(l, true);
              }}
            >
              Conceder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
