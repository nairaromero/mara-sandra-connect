import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  UserCircle,
  FileWarning,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  Webhook,
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
  { title: "Inicio", url: "/", icon: Home },
  { title: "Clientes", url: "/clientes", icon: UserCircle },
  { title: "Documentos pendentes", url: "/documentos", icon: FileWarning },
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
