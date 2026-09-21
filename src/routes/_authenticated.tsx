import {
  createFileRoute,
  Outlet,
  useNavigate,
  Link,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Building2, Eye, LifeBuoy, Loader2, LogOut, Plus, X } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DestaqueProvider } from "@/lib/destaque/destaque-context";
import {
  VerComoParceiroProvider,
  useVerComoParceiro,
} from "@/hooks/use-ver-como-parceiro";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificacoesBell } from "@/components/notificacoes-bell";
import { MovimentacoesParceiroBell } from "@/components/movimentacoes-parceiro-bell";
import { IaLauncher } from "@/components/ia/ia-launcher";
import { SessionTimeoutGuard } from "@/components/session-timeout-guard";
import { SeletorEscritorio } from "@/components/seletor-escritorio";
import { supabase } from "@/lib/supabase";
import { dataHoraBR } from "@/lib/fuso";
import { useAuth } from "@/hooks/use-auth";
import { TERMOS_VERSAO } from "@/lib/legal/termos";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, usuario, loading, precisaSenha, signOut, semEscritorio, vinculos } = useAuth();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  // Primeiro acesso: quem chegou por convite/magic link e ainda nao tem senha
  // cria a senha antes de qualquer outra coisa — inclusive antes do onboarding
  // do parceiro. /definir-senha fica FORA deste layout, entao nao ha loop.
  useEffect(() => {
    if (loading || !session || precisaSenha !== true) return;
    navigate({ to: "/definir-senha" });
  }, [loading, session, precisaSenha, navigate]);

  // Redireciona parceiro pra /boas-vindas quando ainda nao fez onboarding OU
  // quando a versao dos termos mudou (precisa re-assinar). Internos foram
  // auto-marcados como onboarded no backfill da migration. So redireciona
  // quando o usuario ja foi carregado (evita flash) e nao se ja esta la (loop).
  // precisaSenha===false garante a ordem senha -> boas-vindas.
  useEffect(() => {
    if (loading || !usuario || precisaSenha !== false) return;
    const precisaOnboarding =
      usuario.tipo === "parceiro" &&
      (!usuario.onboarded_em || usuario.termos_versao !== TERMOS_VERSAO);
    if (precisaOnboarding && currentPath !== "/boas-vindas") {
      navigate({ to: "/boas-vindas" });
    }
  }, [loading, usuario, precisaSenha, currentPath, navigate]);

  // Nada do sistema renderiza enquanto não se sabe que a conta tem senha
  // (precisaSenha só vira false com a resposta do RPC, ou com a falha dele).
  // Filho que redireciona já no primeiro render (/casos -> /tarefas) corria
  // contra o redirect pra /definir-senha acima: o efeito do filho roda antes do
  // do layout, e com o backend rápido a navegação do filho vencia. Como aquele
  // efeito não depende da rota, não rodava de novo — a pessoa entrava sem criar
  // senha (visto no ambiente local em 2026-09-15; no staging a latência
  // escondia).
  if (loading || !session || precisaSenha !== false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // RBAC multi-tenant: sem escritório ativo não há o que mostrar — toda consulta
  // voltaria vazia e a pessoa veria um sistema "zerado" sem explicação.
  if (semEscritorio) {
    const suspenso = vinculos.find((v) => v.escritorio_status === "suspenso");
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">
            {semEscritorio === "suspenso"
              ? `${suspenso?.escritorio_nome ?? "Seu escritório"} está suspenso`
              : "Você não tem acesso a nenhum escritório"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {semEscritorio === "suspenso"
              ? "O acesso ao sistema foi pausado pela plataforma. Os dados estão preservados. Fale com quem administra o escritório."
              : "Sua conta existe, mas não está vinculada a um escritório ativo. Peça a quem administra o escritório para convidar você de novo."}
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </div>
    );
  }

  const displayName = usuario?.nome ?? session.user.email ?? "Usuário";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DestaqueProvider>
      <VerComoParceiroProvider>
        <SessionTimeoutGuard />
        <SidebarProvider>
          <ConteudoAutenticado
            displayName={displayName}
            initials={initials}
            signOut={signOut}
            onSignOut={() => navigate({ to: "/login" })}
          />
        </SidebarProvider>
      </VerComoParceiroProvider>
    </DestaqueProvider>
  );
}

// Conteúdo separado pra poder usar useVerComoParceiro() dentro do provider.
function ConteudoAutenticado(props: {
  displayName: string;
  initials: string;
  signOut: () => Promise<void>;
  onSignOut: () => void;
}) {
  const { displayName, initials, signOut, onSignOut } = props;
  const { usuario, emSuporte, escritorio, pode } = useAuth();
  const { verComo, sairVerComo } = useVerComoParceiro();
  const rota = useRouterState({ select: (r) => r.location.pathname });

  // Sessão de suporte da plataforma: o escritório vê, na auditoria dele, cada
  // tela que o suporte abriu.
  useEffect(() => {
    if (!emSuporte) return;
    void supabase.rpc("suporte_registrar", { p_recurso: rota });
  }, [emSuporte, rota]);

  return (
    <>
      {/* Faixa do modo "Ver como parceiro" — deixa explícito que é leitura e
          que não é a conta do parceiro. */}
      {verComo && (
        <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-center gap-3 bg-[var(--gold)]/90 px-4 py-1.5 text-sm text-[#3d2f00]">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Vendo como <strong>{verComo.parceiroNome}</strong> — somente leitura
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[#3d2f00] hover:bg-black/10"
            onClick={sairVerComo}
          >
            <X className="h-3 w-3 mr-1" />
            Sair
          </Button>
        </div>
      )}
      {emSuporte && (
        <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-black">
          <LifeBuoy className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Sessão de suporte em <strong>{escritorio?.escritorio_nome}</strong> — somente leitura
            {escritorio?.suporte_fim ? ` · até ${dataHoraBR(escritorio.suporte_fim)}` : ""}. Tudo que você abre fica
            registrado para o escritório.
          </span>
        </div>
      )}
      <div className={"flex min-h-screen w-full bg-muted/20" + (verComo || emSuporte ? " pt-9" : "")}>
        <AppSidebar />
        {/* min-w-0 permite o conteudo encolher abaixo da largura intrinseca
            (senao tabs/tabelas largas forcam scroll horizontal da pagina toda
            no mobile) */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              {/* Logo pequeno no topbar - sempre visivel, leva pra home.
                  No mobile fica como reforco da marca quando a sidebar
                  esta colapsada. */}
              <Link
                to="/casos"
                aria-label="Mara Sandra Vian Advocacia - início"
                className="hidden sm:flex items-center hover:opacity-80 transition-opacity"
              >
                <img
                  src="/logo.png"
                  alt="Mara Sandra Vian Advocacia"
                  className="h-10 w-auto object-contain"
                />
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <SeletorEscritorio />
              {pode("casos:editar") && !emSuporte && (
                <Button size="sm" asChild>
                  <Link to="/casos/novo">
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Novo caso</span>
                  </Link>
                </Button>
              )}
              {usuario?.tipo === "interno" && <NotificacoesBell />}
              {usuario?.tipo === "parceiro" && <MovimentacoesParceiroBell />}
              {usuario?.tipo && (
                // Badge em dourado quebra a monotonia do navy (botao Novo
                // caso + avatar + Sair) e reforca a identidade visual.
                <Badge
                  variant="outline"
                  className="capitalize bg-gold-soft/40 border-gold/40 text-foreground"
                >
                  {escritorio?.papel_nome ?? usuario.tipo}
                </Badge>
              )}
              {/* Avatar + nome viram link pro perfil/configuracoes do
                  usuario logado. Botao Configuracoes na sidebar continua
                  funcionando como atalho redundante. */}
              <Link
                to="/configuracoes"
                aria-label="Abrir configurações do perfil"
                className="flex items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-muted/60 transition-colors"
                title="Configurações do perfil"
              >
                <Avatar className="h-8 w-8 ring-1 ring-transparent hover:ring-[var(--gold)]/40 transition-all">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium hidden md:inline">
                  {displayName}
                </span>
              </Link>
              <Button variant="ghost" size="sm" onClick={async () => { await signOut(); onSignOut(); }}>
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
        {usuario?.tipo === "interno" && pode("ia:usar") && !verComo && !emSuporte && <IaLauncher />}
      </div>
    </>
  );
}
