import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Settings,
  User,
  KeyRound,
  LogOut,
  Info,
  Save,
  Eye,
  EyeOff,
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
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfiguracoesPage,
});

// ===========================================================================
// Tipos
// ===========================================================================

interface UsuarioCompleto {
  id: string;
  nome: string | null;
  email: string | null;
  tipo: string;
  oab: string | null;
  telefone: string | null;
}

// ===========================================================================
// Helpers
// ===========================================================================

function maskTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

// ===========================================================================
// Componente principal
// ===========================================================================

function ConfiguracoesPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const usuarioId = usuario ? usuario.id : null;

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<UsuarioCompleto | null>(null);
  const jaCarregouRef = useRef(false);

  // Edicao de perfil
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState("");
  const [oab, setOab] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Modal de senha
  const [modalSenha, setModalSenha] = useState(false);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  // Logout
  const [saindo, setSaindo] = useState(false);

  const carregar = useCallback(async () => {
    if (!usuarioId) return;
    if (!jaCarregouRef.current) setLoading(true);
    setErro(null);
    try {
      const resp = await supabase
        .from("usuarios")
        .select("*")
        .eq("id", usuarioId)
        .maybeSingle();
      if (resp.error) throw resp.error;
      const u = resp.data as UsuarioCompleto | null;
      if (!u) {
        setErro("Usuario nao encontrado");
        return;
      }
      setDados(u);
      setNome(u.nome || "");
      setOab(u.oab || "");
      setTelefone(u.telefone || "");
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      setErro(errObj.message || "Erro ao carregar perfil");
    } finally {
      setLoading(false);
      jaCarregouRef.current = true;
    }
  }, [usuarioId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarPerfil() {
    if (!usuarioId) return;
    if (!nome.trim()) {
      toast.error("Nome e obrigatorio");
      return;
    }
    setSalvando(true);
    try {
      const resp = await supabase
        .from("usuarios")
        .update({
          nome: nome.trim(),
          oab: oab.trim() || null,
          telefone: telefone.trim() || null,
        })
        .eq("id", usuarioId);
      if (resp.error) throw resp.error;
      toast.success("Perfil atualizado");
      setEditando(false);
      await carregar();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao salvar perfil");
    } finally {
      setSalvando(false);
    }
  }

  function cancelarEdicao() {
    if (dados) {
      setNome(dados.nome || "");
      setOab(dados.oab || "");
      setTelefone(dados.telefone || "");
    }
    setEditando(false);
  }

  async function alterarSenha() {
    if (novaSenha.length < 8) {
      toast.error("A nova senha precisa ter pelo menos 8 caracteres");
      return;
    }
    if (novaSenha !== confirmaSenha) {
      toast.error("As senhas nao conferem");
      return;
    }
    setSalvandoSenha(true);
    try {
      const resp = await supabase.auth.updateUser({ password: novaSenha });
      if (resp.error) throw resp.error;
      toast.success("Senha alterada com sucesso");
      setNovaSenha("");
      setConfirmaSenha("");
      setMostrarSenha(false);
      setModalSenha(false);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao alterar senha");
    } finally {
      setSalvandoSenha(false);
    }
  }

  async function sair(global: boolean) {
    setSaindo(true);
    try {
      const opcoes = global ? { scope: "global" as const } : undefined;
      const resp = await supabase.auth.signOut(opcoes);
      if (resp.error) throw resp.error;
      toast.success(
        global
          ? "Deslogado de todos os dispositivos"
          : "Sessao encerrada",
      );
      navigate({ to: "/login" });
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao sair");
    } finally {
      setSaindo(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-destructive">
            {erro || "Nao foi possivel carregar suas configuracoes"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ClientOnly
      fallback={
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Configuracoes
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie seu perfil, senha e sessao.
          </p>
        </div>

        {/* Card: Perfil */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Meu perfil
                </CardTitle>
                <CardDescription>
                  Suas informacoes pessoais. O e-mail nao pode ser alterado por
                  aqui.
                </CardDescription>
              </div>
              {!editando ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditando(true)}
                >
                  Editar
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelarEdicao}
                    disabled={salvando}
                  >
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={salvarPerfil} disabled={salvando}>
                    {salvando ? (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-2" />
                    )}
                    Salvar
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {dados.tipo === "interno" ? "Interno (escritorio)" : "Parceiro"}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Nome completo</Label>
                {editando ? (
                  <Input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Seu nome"
                  />
                ) : (
                  <p className="text-sm py-2">{dados.nome || "-"}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">E-mail</Label>
                <p className="text-sm py-2 text-muted-foreground">
                  {dados.email || "-"}
                </p>
              </div>
              <div>
                <Label className="text-xs">OAB</Label>
                {editando ? (
                  <Input
                    value={oab}
                    onChange={(e) => setOab(e.target.value)}
                    placeholder="Ex.: OAB/SP 000000"
                  />
                ) : (
                  <p className="text-sm py-2">{dados.oab || "-"}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Telefone</Label>
                {editando ? (
                  <Input
                    value={telefone}
                    onChange={(e) =>
                      setTelefone(maskTelefone(e.target.value))
                    }
                    placeholder="(00) 00000-0000"
                    inputMode="tel"
                  />
                ) : (
                  <p className="text-sm py-2">{dados.telefone || "-"}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card: Senha */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Senha
                </CardTitle>
                <CardDescription>
                  Altere sua senha de acesso ao sistema.
                </CardDescription>
              </div>
              <Dialog open={modalSenha} onOpenChange={setModalSenha}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Alterar senha
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Alterar senha</DialogTitle>
                    <DialogDescription>
                      Escolha uma nova senha com no minimo 8 caracteres.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Nova senha</Label>
                      <div className="relative">
                        <Input
                          type={mostrarSenha ? "text" : "password"}
                          value={novaSenha}
                          onChange={(e) => setNovaSenha(e.target.value)}
                          placeholder="Minimo 8 caracteres"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setMostrarSenha((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={
                            mostrarSenha ? "Ocultar senha" : "Mostrar senha"
                          }
                        >
                          {mostrarSenha ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Confirmar nova senha</Label>
                      <Input
                        type={mostrarSenha ? "text" : "password"}
                        value={confirmaSenha}
                        onChange={(e) => setConfirmaSenha(e.target.value)}
                        placeholder="Repita a nova senha"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setModalSenha(false);
                        setNovaSenha("");
                        setConfirmaSenha("");
                        setMostrarSenha(false);
                      }}
                      disabled={salvandoSenha}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={alterarSenha} disabled={salvandoSenha}>
                      {salvandoSenha && (
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      )}
                      Alterar senha
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
        </Card>

        {/* Card: Sessao */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LogOut className="h-4 w-4" />
              Sessao
            </CardTitle>
            <CardDescription>
              Encerre a sessao atual ou desconecte-se de todos os dispositivos.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => sair(false)}
              disabled={saindo}
            >
              {saindo && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Sair deste dispositivo
            </Button>
            <Button
              variant="destructive"
              onClick={() => sair(true)}
              disabled={saindo}
            >
              {saindo && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Sair de todos os dispositivos
            </Button>
          </CardContent>
        </Card>

        {/* Card: Sobre */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" />
              Sobre
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>Mara Sandra Connect - app interno do escritorio</p>
            <p className="text-xs">Versao beta</p>
          </CardContent>
        </Card>
      </div>
    </ClientOnly>
  );
}
