import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreVertical,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/equipe")({
  component: EquipePage,
});

interface InternoRow {
  id: string;
  nome: string | null;
  email: string | null;
  ativo: boolean;
  eh_admin: boolean | null;
  onboarded_em: string | null;
  desligado_em: string | null;
}

function EquipePage() {
  const { usuario, isAdmin } = useAuth();
  // Só admin (Naira/Mara) entra aqui. Os demais internos nem veem o item
  // na sidebar; se caírem pela URL, levam aviso + redirect.
  const isInterno = isAdmin;

  const [lista, setLista] = useState<Array<InternoRow>>([]);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nome, email, ativo, eh_admin, onboarded_em, desligado_em")
      .eq("tipo", "interno")
      .order("nome", { ascending: true });
    if (!error) setLista((data || []) as Array<InternoRow>);
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (isInterno) carregar();
  }, [isInterno, carregar]);

  async function convidar() {
    const emailNorm = email.trim().toLowerCase();
    if (nome.trim().length < 3) {
      toast.error("Informe o nome completo");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) {
      toast.error("E-mail inválido");
      return;
    }
    setEnviando(true);
    try {
      const redirectTo = typeof window !== "undefined"
        ? `${window.location.origin}/login`
        : undefined;
      const resp = await supabase.functions.invoke("convidar-usuario", {
        body: {
          nome: nome.trim(),
          email: emailNorm,
          tipo: "interno",
          redirect_to: redirectTo,
        },
      });
      if (resp.error) throw resp.error;
      const r = (resp.data || {}) as { error?: string; ja_existia?: boolean };
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.ja_existia
          ? "Esse e-mail já tem cadastro."
          : `Convite enviado para ${emailNorm}. Peça para verificar a caixa de entrada.`,
      );
      setNome("");
      setEmail("");
      carregar();
    } catch (err) {
      console.error(err);
      toast.error(
        (err as { message?: string }).message || "Erro ao convidar interno",
      );
    } finally {
      setEnviando(false);
    }
  }

  // ---- Admin: promover / remover ----
  const [mudandoAdmin, setMudandoAdmin] = useState<string | null>(null);
  async function definirAdmin(u: InternoRow, valor: boolean) {
    setMudandoAdmin(u.id);
    try {
      const { error } = await supabase.rpc("definir_admin", {
        p_usuario_id: u.id,
        p_valor: valor,
      });
      if (error) throw error;
      toast.success(
        valor
          ? `${u.nome ?? "Pessoa"} agora é administrador(a).`
          : `${u.nome ?? "Pessoa"} deixou de ser administrador(a).`,
      );
      carregar();
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string }).message || "Falha ao alterar papel de admin");
    } finally {
      setMudandoAdmin(null);
    }
  }

  // ---- Desligar da equipe (com migração das tarefas abertas) ----
  const [desligarAlvo, setDesligarAlvo] = useState<InternoRow | null>(null);
  const [desligarAbertas, setDesligarAbertas] = useState<number | null>(null);
  const [desligarNovoResp, setDesligarNovoResp] = useState<string>("");
  const [desligando, setDesligando] = useState(false);

  async function abrirDesligar(u: InternoRow) {
    setDesligarAlvo(u);
    setDesligarAbertas(null);
    setDesligarNovoResp("");
    const { count } = await supabase
      .from("tarefas")
      .select("id", { count: "exact", head: true })
      .eq("responsavel_id", u.id)
      .in("status", ["a_fazer", "fazendo"]);
    setDesligarAbertas(count ?? 0);
  }

  async function desligarConfirmado() {
    if (!desligarAlvo) return;
    if ((desligarAbertas ?? 0) > 0 && !desligarNovoResp) {
      toast.error("Escolha quem assume as tarefas abertas.");
      return;
    }
    setDesligando(true);
    try {
      const { data, error } = await supabase.rpc("desligar_interno", {
        p_usuario_id: desligarAlvo.id,
        p_novo_responsavel_id: desligarNovoResp || null,
      });
      if (error) throw error;
      const r = (data || {}) as { tarefas_movidas?: number; eventos_movidos?: number };
      const partes: string[] = [];
      if (r.tarefas_movidas) partes.push(`${r.tarefas_movidas} tarefa(s) transferida(s)`);
      if (r.eventos_movidos) partes.push(`${r.eventos_movidos} evento(s) de agenda`);
      toast.success(
        `${desligarAlvo.nome ?? "Pessoa"} desligada da equipe.` +
          (partes.length ? ` ${partes.join(" e ")}.` : ""),
      );
      setDesligarAlvo(null);
      carregar();
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string }).message || "Falha ao desligar");
    } finally {
      setDesligando(false);
    }
  }

  // ---- Reativar ----
  const [reativando, setReativando] = useState<string | null>(null);
  async function reativar(u: InternoRow) {
    setReativando(u.id);
    try {
      const { error } = await supabase.rpc("reativar_interno", { p_usuario_id: u.id });
      if (error) throw error;
      toast.success(`${u.nome ?? "Pessoa"} reativada.`);
      carregar();
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string }).message || "Falha ao reativar");
    } finally {
      setReativando(null);
    }
  }

  const [mostrarDesligados, setMostrarDesligados] = useState(false);
  const ativos = lista.filter((u) => !u.desligado_em);
  const desligados = lista.filter((u) => !!u.desligado_em);
  // Quem pode assumir as tarefas: ativos da equipe, menos a pessoa desligada.
  const candidatos = ativos.filter((u) => u.id !== desligarAlvo?.id && u.ativo);

  if (!isInterno) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Área restrita a administradores.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-7 w-7 text-[var(--gold)]" />
          Equipe interna
        </h1>
        <p className="text-sm text-muted-foreground">
          Convide pessoas da equipe, defina quem é administrador(a) e desligue
          quem saiu (as tarefas abertas passam pra outra pessoa).
        </p>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Convidar novo interno</CardTitle>
            <CardDescription>
              Cria o acesso e envia um link de login por e-mail. O interno já
              entra com acesso total (sem onboarding de parceiro).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <Label className="text-xs">Nome completo</Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome da pessoa"
                />
              </div>
              <div>
                <Label className="text-xs">E-mail</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@escritorio.com.br"
                />
              </div>
              <Button onClick={convidar} disabled={enviando}>
                {enviando
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <UserPlus className="h-4 w-4 mr-2" />}
                Convidar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Usuários internos ({ativos.length})
            </CardTitle>
            <CardDescription>
              Pessoas com acesso interno à plataforma. Admin (Naira/Mara) vê
              Equipe, Webhooks, Auditoria e integrações.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {carregando
              ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )
              : ativos.length === 0
              ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhum usuário interno.
                </p>
              )
              : (
                <ul className="divide-y">
                  {ativos.map((u) => {
                    const souEu = u.id === usuario?.id;
                    return (
                      <li
                        key={u.id}
                        className="flex items-center justify-between gap-2 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {u.nome || "(sem nome)"}
                            {souEu && (
                              <span className="text-xs text-muted-foreground">
                                {" "}(você)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {u.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {u.eh_admin && (
                            <Badge className="text-xs bg-gold-soft/60 text-foreground hover:bg-gold-soft/60 border border-gold/40">
                              <ShieldCheck className="h-3 w-3 mr-1" />
                              admin
                            </Badge>
                          )}
                          {!u.onboarded_em && (
                            <Badge variant="outline" className="text-xs">
                              convite pendente
                            </Badge>
                          )}
                          <Badge
                            variant={u.ativo ? "secondary" : "outline"}
                            className="text-xs"
                          >
                            {u.ativo ? "ativo" : "inativo"}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Ações de ${u.nome ?? "usuário"}`}
                                disabled={mudandoAdmin === u.id}
                              >
                                {mudandoAdmin === u.id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <MoreVertical className="h-4 w-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {u.eh_admin ? (
                                <DropdownMenuItem
                                  disabled={souEu}
                                  onSelect={() => definirAdmin(u, false)}
                                >
                                  <Shield className="h-4 w-4" />
                                  Remover admin
                                  {souEu && (
                                    <span className="text-xs text-muted-foreground ml-1">
                                      (não de si)
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => definirAdmin(u, true)}>
                                  <ShieldCheck className="h-4 w-4" />
                                  Tornar admin
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={souEu}
                                className="text-destructive focus:text-destructive"
                                onSelect={() => abrirDesligar(u)}
                              >
                                <UserMinus className="h-4 w-4" />
                                Desligar da equipe
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

            {/* Desligados: ficam no histórico (nome nas tarefas/comentários),
                sem acesso. Dá pra reativar. */}
            {desligados.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setMostrarDesligados((v) => !v)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  {mostrarDesligados
                    ? <ChevronDown className="h-3.5 w-3.5" />
                    : <ChevronRight className="h-3.5 w-3.5" />}
                  Desligados
                  <Badge variant="outline" className="font-normal">{desligados.length}</Badge>
                </button>
                {mostrarDesligados && (
                  <ul className="divide-y mt-2">
                    {desligados.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="text-sm truncate text-muted-foreground">
                            {u.nome || "(sem nome)"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {u.email} · desligado(a) em{" "}
                            {new Date(u.desligado_em!).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => reativar(u)}
                          disabled={reativando === u.id}
                        >
                          {reativando === u.id
                            ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                          Reativar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dialog: desligar da equipe */}
        <AlertDialog
          open={desligarAlvo !== null}
          onOpenChange={(o) => {
            if (!desligando && !o) setDesligarAlvo(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Desligar {desligarAlvo?.nome ?? "esta pessoa"} da equipe?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    A pessoa perde o acesso na hora (login bloqueado). A conta{" "}
                    <strong>não é apagada</strong>: o nome continua no histórico de
                    tarefas concluídas, comentários e andamentos. Dá pra reativar depois.
                  </p>
                  {desligarAbertas === null ? (
                    <p className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Contando tarefas abertas…
                    </p>
                  ) : desligarAbertas === 0 ? (
                    <p>Ela não tem tarefas abertas. Nada a transferir.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p>
                        Ela tem <strong>{desligarAbertas}</strong> tarefa(s) aberta(s)
                        (a fazer / fazendo). Escolha quem assume:
                      </p>
                      <Select value={desligarNovoResp} onValueChange={setDesligarNovoResp}>
                        <SelectTrigger aria-label="Quem assume as tarefas">
                          <SelectValue placeholder="Quem assume as tarefas" />
                        </SelectTrigger>
                        <SelectContent>
                          {candidatos.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nome || c.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs">
                        Tarefas já concluídas/canceladas e eventos de agenda passados ficam
                        no nome dela. Eventos futuros também vão pra pessoa escolhida.
                      </p>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={desligando}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  desligarConfirmado();
                }}
                disabled={
                  desligando ||
                  desligarAbertas === null ||
                  (desligarAbertas > 0 && !desligarNovoResp)
                }
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {desligando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Desligar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ClientOnly>
    </div>
  );
}
