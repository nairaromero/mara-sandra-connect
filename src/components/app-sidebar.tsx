import { Link, useRouterState } from "@tanstack/react-router";
import {
  Briefcase,
  FileWarning,
  Wallet,
  MessagesSquare,
  Settings,
  Users,
} from "lucide-react";
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
  { title: "Casos", url: "/", icon: Briefcase },
  { title: "Documentos pendentes", url: "/documentos", icon: FileWarning },
  { title: "Repasses", url: "/repasses", icon: Wallet },
  { title: "Conversas", url: "/conversas", icon: MessagesSquare },
];

const itemsInternos = [
  { title: "Parceiros", url: "/parceiros", icon: Users },
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        {/* Logo do escritorio. Clicar volta para a home (lista de casos). */}
        <Link
          to="/"
          aria-label="Mara Sandra Vian Advocacia - voltar para a pagina inicial"
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
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
