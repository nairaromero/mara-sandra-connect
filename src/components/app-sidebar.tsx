import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Home,
  UserCircle,
  FileWarning,
  Newspaper,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  Webhook,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";

const itemsBase = [
  { title: "Início", url: "/", icon: Home },
  { title: "Clientes", url: "/clientes", icon: UserCircle },
  { title: "Documentos pendentes", url: "/documentos", icon: FileWarning },
  { title: "Publicações", url: "/publicacoes", icon: Newspaper },
  // "Repasses" e "Conversas" removidas da sidebar mas as rotas /repasses
  // e /conversas continuam existindo no codigo - decisao de produto
  // pendente sobre o que fazer com essas paginas no futuro.
];

const itemsInternos = [
  { title: "Equipe", url: "/equipe", icon: UserCog },
  { title: "Parceiros", url: "/parceiros", icon: Users },
  { title: "Webhooks", url: "/webhooks", icon: Webhook },
  { title: "Auditoria", url: "/auditoria", icon: ShieldCheck },
];

const itemsFooter = [
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { usuario } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (path: string) =>
    path === "/" ? currentPath === "/" : currentPath.startsWith(path);

  const items = [
    ...itemsBase,
    ...(isInterno ? itemsInternos : []),
    ...itemsFooter,
  ];

  // Badge de publicacoes novas (DJEN) desde a ultima visita. RLS escopa por
  // usuario (interno ve todas; parceiro so as dos casos dele).
  const [pubBadge, setPubBadge] = useState(0);
  useEffect(() => {
    let vivo = true;
    async function calc() {
      const visto = typeof window !== "undefined"
        ? window.localStorage.getItem("msc:publicacoes_visto")
        : null;
      let q = supabase
        .from("andamentos")
        .select("id", { count: "exact", head: true })
        .eq("origem", "djen");
      if (visto) q = q.gt("created_at", visto);
      const { count } = await q;
      if (vivo) setPubBadge(count || 0);
    }
    calc();
    const onVistas = () => setPubBadge(0);
    const t = setInterval(calc, 60000);
    if (typeof window !== "undefined") {
      window.addEventListener("msc:publicacoes-vistas", onVistas);
    }
    return () => {
      vivo = false;
      clearInterval(t);
      if (typeof window !== "undefined") {
        window.removeEventListener("msc:publicacoes-vistas", onVistas);
      }
    };
  }, []);

  return (
    <Sidebar collapsible="icon">
      {/* Faixa dourada sob o logo ecoa a identidade visual MSV. */}
      <SidebarHeader
        className="border-b-2"
        style={{
          borderImage:
            "linear-gradient(90deg, transparent 0%, var(--gold) 20%, var(--gold) 80%, transparent 100%) 1",
        }}
      >
        {/* Logo do escritorio. Clicar volta para a home (lista de casos). */}
        <Link
          to="/casos"
          aria-label="Mara Sandra Vian Advocacia - voltar para a página inicial"
          className="flex items-center justify-center px-2 py-3 hover:opacity-80 transition-opacity"
        >
          {collapsed ? (
            // Estado colapsado: mostra so o mark "msv" em um badge dourado.
            // Mantem identidade visual sem ocupar largura.
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white font-bold italic"
              style={{
                background:
                  "linear-gradient(135deg, #c9a14a 0%, #e8c878 50%, #b8862e 100%)",
              }}
            >
              <span className="text-sm leading-none">msv</span>
            </div>
          ) : (
            <img
              src="/logo.png"
              alt="Mara Sandra Vian Advocacia"
              className="max-h-20 w-auto object-contain"
            />
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const badge = item.url === "/publicacoes" ? pubBadge : 0;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} className="relative flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                        {badge > 0 && (
                          collapsed
                            ? (
                              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
                            )
                            : (
                              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
                                {badge > 9 ? "9+" : badge}
                              </span>
                            )
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
