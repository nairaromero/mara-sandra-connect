import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  User,
  KeyRound,
  LogOut,
  Info,
  Save,
  Eye,
  EyeOff,
  Scale,
  Plug,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatarTelefone } from "@/lib/telefone";
import { ClientOnly } from "@/components/client-only";
import { IntegracaoIaCard } from "@/components/ia/integracao-ia-card";
import { ConexaoClaudeCard } from "@/components/ia/conexao-claude-card";
import { IntegracaoGmailCard } from "@/components/integracoes/integracao-gmail-card";
import { WebhooksCard } from "@/components/integracoes/webhooks-card";
import { TiposBeneficioCard } from "@/components/tipos-beneficio-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  // Aba ativa na URL (?tab=seguranca|beneficios|integracoes|webhooks) pra
  // deep-link e voltar/avançar — mesmo padrão de /parceiros. O /webhooks
  // antigo redireciona pra ?tab=webhooks.
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
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

// Aba da barra de Configurações. No celular a barra rola na horizontal (cinco
// abas não cabem em 375px) e começa na ponta esquerda: quem chegava por
// deep-link (?tab=webhooks, inclusive pelo /webhooks antigo) não via qual aba
// estava ativa. Ao ficar ativa, a aba rola pra dentro da barra — "nearest" não
// mexe em nada se ela já está à vista, então no desktop é no-op. O efeito mora
// aqui, e não na página, porque a barra só aparece depois do ClientOnly montar.
function AbaConfig({
  value,
  ativa,
  icone: Icone,
  rotulo,
}: {
  value: string;
  ativa: boolean;
  icone: LucideIcon;
  rotulo: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ativa) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [ativa]);
  return (
    <TabsTrigger ref={ref} value={value} className="flex items-center gap-1.5 shrink-0">
      <Icone className="h-4 w-4" />
      <span>{rotulo}</span>
    </TabsTrigger>
  );
}

// ===========================================================================
// Componente principal
// ===========================================================================

function ConfiguracoesPage() {
  const { usuario, isAdmin } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const usuarioId = usuario ? usuario.id : null;

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<UsuarioCompleto | null>(null);
  const jaCarregouRef = useRef(false);
  // Recarga depois de salvar: os dados antigos ficam na tela e isto avisa que
  // ja vem coisa nova (antes a recarga era muda).
  const [recarregando, setRecarregando] = useState(false);

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
    else setRecarregando(true);
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
        setErro("Usuário não encontrado");
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
      setRecarregando(false);
      jaCarregouRef.current = true;
    }
  }, [usuarioId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarPerfil() {
    if (!usuarioId) return;
    if (!nome.trim()) {
      toast.error("Nome é obrigatório");
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
      toast.error("As senhas não conferem");
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
          : "Sessão encerrada",
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
      <div className="mx-auto max-w-4xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">
              {erro || "Não foi possível carregar suas configurações"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Abas ----
  // As abas que esta pessoa pode ver. Aba da URL fora da lista (ex.:
  // ?tab=webhooks pra quem não é admin, ou um valor inventado) cai em "perfil",
  // sem reescrever a URL — mesmo padrão de /parceiros. Não há corrida com o
  // carregamento do papel: esta tela só sai do spinner depois que o `usuario`
  // carregou, e o isAdmin vem desse mesmo objeto.
  const ehInterno = dados.tipo === "interno";
  const abas = [
    "perfil",
    "seguranca",
    ...(ehInterno ? ["beneficios"] : []),
    ...(isAdmin ? ["integracoes", "webhooks"] : []),
  ];
  const tab = search.tab && abas.includes(search.tab) ? search.tab : "perfil";
  function irParaAba(v: string) {
    navigate({
      to: "/configuracoes",
      search: v === "perfil" ? {} : { tab: v },
      replace: true,
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
            Configurações
            {recarregando && (
              <span
                className="flex items-center gap-1.5 text-xs font-sans font-normal text-muted-foreground"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Atualizando…
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Seu perfil e a segurança da conta, e as integrações do escritório."
              : "Gerencie seu perfil, senha e sessão."}
          </p>
        </div>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Tabs value={tab} onValueChange={irParaAba}>
          {/* Tabs numa linha unica com scroll horizontal em telas estreitas
              (mesmo padrao de /parceiros e casos.$id). */}
          <TabsList className="w-full flex justify-start overflow-x-auto">
            <AbaConfig value="perfil" ativa={tab === "perfil"} icone={User} rotulo="Perfil" />
            <AbaConfig
              value="seguranca"
              ativa={tab === "seguranca"}
              icone={KeyRound}
              rotulo="Segurança"
            />
            {ehInterno && (
              <AbaConfig
                value="beneficios"
                ativa={tab === "beneficios"}
                icone={Scale}
                rotulo="Tipos de benefício"
              />
            )}
            {/* Integrações e webhooks: só ADMIN (Naira/Mara). Backend mantido
              intacto - os demais não veem a UI mas as APIs ainda existem. */}
            {isAdmin && (
              <>
                <AbaConfig
                  value="integracoes"
                  ativa={tab === "integracoes"}
                  icone={Plug}
                  rotulo="Integrações"
                />
                <AbaConfig
                  value="webhooks"
                  ativa={tab === "webhooks"}
                  icone={Webhook}
                  rotulo="Webhooks"
                />
              </>
            )}
          </TabsList>

          <TabsContent value="perfil" className="space-y-6">
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
                      Suas informações pessoais. O e-mail não pode ser alterado por
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
                    {dados.tipo === "interno" ? "Interno (escritório)" : "Parceiro"}
                  </Badge>
                  {isAdmin && <Badge variant="outline">Administrador</Badge>}
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
                      <p className="text-sm py-2">{formatarTelefone(dados.telefone) || "-"}</p>
                    )}
                  </div>
                </div>
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
                <p>Mara Sandra Connect - app interno do escritório</p>
                <p className="text-xs">Versão beta</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="seguranca" className="space-y-6">
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
                          Escolha uma nova senha com no mínimo 8 caracteres.
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
                              placeholder="Mínimo 8 caracteres"
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
                  Sessão
                </CardTitle>
                <CardDescription>
                  Encerre a sessão atual ou desconecte-se de todos os dispositivos.
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
          </TabsContent>

          {/* Tipos de beneficio (so interno gerencia o cadastro) */}
          {ehInterno && (
            <TabsContent value="beneficios">
              <TiposBeneficioCard />
            </TabsContent>
          )}

          {isAdmin && (
            <>
              <TabsContent value="integracoes" className="space-y-6">
                {/* Card: Integracao de IA */}
                <IntegracaoIaCard />

                {/* Card: Conectar Claude/ChatGPT (Superficie B) */}
                <ConexaoClaudeCard />

                {/* Card: Integração Gmail (INSS) */}
                <IntegracaoGmailCard />
              </TabsContent>

              {/* Webhooks: era a página /webhooks com item na sidebar (até
                  2026-09-14). A aba só monta o card quando abre, então a lista
                  não é consultada em toda visita às Configurações. */}
              <TabsContent value="webhooks">
                <WebhooksCard />
              </TabsContent>
            </>
          )}
        </Tabs>
      </ClientOnly>
    </div>
  );
}
