import {
  createFileRoute,
  Outlet,
  useNavigate,
  Link,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2, LogOut, Plus } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DestaqueProvider } from "@/lib/destaque/destaque-context";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificacoesBell } from "@/components/notificacoes-bell";
import { MovimentacoesParceiroBell } from "@/components/movimentacoes-parceiro-bell";
import { IaLauncher } from "@/components/ia/ia-launcher";
import { useAuth } from "@/hooks/use-auth";
import { TERMOS_VERSAO } from "@/lib/legal/termos";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, usuario, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  // Redireciona parceiro pra /boas-vindas quando ainda nao fez onboarding OU
  // quando a versao dos termos mudou (precisa re-assinar). Internos foram
  // auto-marcados como onboarded no backfill da migration. So redireciona
  // quando o usuario ja foi carregado (evita flash) e nao se ja esta la (loop).
  useEffect(() => {
    if (loading || !usuario) return;
    const precisaOnboarding =
      usuario.tipo === "parceiro" &&
      (!usuario.onboarded_em || usuario.termos_versao !== TERMOS_VERSAO);
    if (precisaOnboarding && currentPath !== "/boas-vindas") {
      navigate({ to: "/boas-vindas" });
    }
  }, [loading, usuario, currentPath, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-muted/20">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
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
              <Button size="sm" asChild>
                <Link to="/casos/novo">
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Novo caso</span>
                </Link>
              </Button>
              {usuario?.tipo === "interno" && <NotificacoesBell />}
              {usuario?.tipo === "parceiro" && <MovimentacoesParceiroBell />}
              {usuario?.tipo && (
                // Badge em dourado quebra a monotonia do navy (botao Novo
                // caso + avatar + Sair) e reforca a identidade visual.
                <Badge
                  variant="outline"
                  className="capitalize bg-gold-soft/40 border-gold/40 text-foreground"
                >
                  {usuario.tipo}
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
              <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate({ to: "/login" }); }}>
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
        <IaLauncher />
      </div>
    </SidebarProvider>
    </DestaqueProvider>
  );
}
