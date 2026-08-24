import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  UserCircle,
  FileWarning,
  Newspaper,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  Webhook,
  ListTodo,
  Calendar,
  Tag,
  Handshake,
  Briefcase,
  MessagesSquare,
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

// "/" e o site publico (landing). Ninguem tem "Inicio": /casos redireciona
// interno pra /tarefas e parceiro pra /clientes (home de cada um).
const itemsBase = [
  { title: "Clientes", url: "/clientes", icon: UserCircle },
  { title: "Conversas", url: "/conversas", icon: MessagesSquare },
  { title: "Documentos pendentes", url: "/documentos", icon: FileWarning },
  { title: "Publicações", url: "/publicacoes", icon: Newspaper },
  // "Repasses" removida da sidebar mas a rota /repasses continua existindo
  // no codigo - decisao de produto pendente.
];

// Tarefas/Agenda no topo: sao o dia a dia do interno (Tarefas e a "home").
const itemsInternosTopo = [
  { title: "Tarefas", url: "/tarefas", icon: ListTodo },
  { title: "Agenda", url: "/agenda", icon: Calendar },
];

// Parceiro: /agenda renderiza a visao restrita (so pericias dos casos dele).
const itemParceiroPericias = { title: "Perícias", url: "/agenda", icon: Calendar };

const itemsInternos = [
  { title: "Comercial", url: "/comercial", icon: Handshake },
  { title: "Processos", url: "/processos", icon: Briefcase },
  { title: "Parceiros", url: "/parceiros", icon: Users },
  { title: "Etiquetas", url: "/etiquetas", icon: Tag },
];

// Só admin (Naira/Mara): gestão da equipe, webhooks e auditoria. As rotas
// também se protegem sozinhas (redirect) — aqui é só pra não aparecer.
const itemsAdmin = [
  { title: "Equipe", url: "/equipe", icon: UserCog },
  { title: "Webhooks", url: "/webhooks", icon: Webhook },
  { title: "Auditoria", url: "/auditoria", icon: ShieldCheck },
];

const itemsFooter = [{ title: "Configurações", url: "/configuracoes", icon: Settings }];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { usuario, isAdmin } = useAuth();
  const isInterno = usuario?.tipo === "interno";
  const collapsed = state === "collapsed";
  // No modo estreito o sidebar e um painel (Sheet) que cobre o conteudo;
  // sem isso ele fica aberto depois do clique e a pessoa precisa clicar
  // fora pra fechar. No desktop expandido nao faz nada.
  const fecharSeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (path: string) =>
    path === "/" ? currentPath === "/" : currentPath.startsWith(path);

  const items = isInterno
    ? [
        ...itemsInternosTopo,
        ...itemsBase,
        ...itemsInternos,
        ...(isAdmin ? itemsAdmin : []),
        ...itemsFooter,
      ]
    : [itemsBase[0], itemParceiroPericias, ...itemsBase.slice(1), ...itemsFooter];

  // Badge de publicacoes novas (DJEN) desde a ultima visita. RLS escopa por
  // usuario (interno ve todas; parceiro so as dos casos dele).
  const [pubBadge, setPubBadge] = useState(0);
  useEffect(() => {
    let vivo = true;
    async function calc() {
      const visto =
        typeof window !== "undefined" ? window.localStorage.getItem("msc:publicacoes_visto") : null;
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

  // Badge de solicitacoes de documento pendentes. RLS escopa por usuario
  // (interno ve todas; parceiro so as dos casos dele). Cai na hora em que
  // o parceiro cumpre: as telas disparam msc:solicitacoes-mudou apos
  // criar/atender/dispensar, e ha um poll de fundo como reserva.
  const [docBadge, setDocBadge] = useState(0);
  useEffect(() => {
    let vivo = true;
    async function calc() {
      // Conta o MESMO que a tela mostra por padrão ("só as minhas"), senão o
      // badge diz 5 e a lista mostra 1 — parece bug.
      let q = supabase
        .from("solicitacoes_documento")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      if (isInterno && usuario?.id) q = q.eq("solicitado_por", usuario.id);
      const { count } = await q;
      if (vivo) setDocBadge(count || 0);
    }
    calc();
    const t = setInterval(calc, 60000);
    if (typeof window !== "undefined") {
      window.addEventListener("msc:solicitacoes-mudou", calc);
    }
    return () => {
      vivo = false;
      clearInterval(t);
      if (typeof window !== "undefined") {
        window.removeEventListener("msc:solicitacoes-mudou", calc);
      }
    };
    // Depende do usuário: no 1º render ele ainda é null e o filtro "só as
    // minhas" não teria por quem filtrar.
  }, [isInterno, usuario?.id]);

  // Badge de conversas não lidas (comentários novos por caso desde a última
  // leitura). Mesmo padrão do docBadge: poll + evento msc:conversas-mudou
  // disparado pela tela de Conversas ao abrir/ler uma thread. Fase 1 calcula
  // no cliente (dado pequeno); otimizar com RPC quando escalar.
  const meuId = usuario?.id ?? null;
  const [conversasBadge, setConversasBadge] = useState(0);
  useEffect(() => {
    let vivo = true;
    async function calc() {
      const [comResp, leiResp] = await Promise.all([
        supabase.from("comentarios").select("caso_id, autor_id, created_at").eq("rascunho", false),
        supabase.from("conversa_leitura").select("caso_id, last_read_at"),
      ]);
      const lmap = new Map<string, string>();
      for (const r of (leiResp.data || []) as Array<{ caso_id: string; last_read_at: string }>) {
        lmap.set(r.caso_id, r.last_read_at);
      }
      const naoLidos = new Set<string>();
      for (const c of (comResp.data || []) as Array<{
        caso_id: string;
        autor_id: string | null;
        created_at: string;
      }>) {
        if (meuId && c.autor_id === meuId) continue;
        const lr = lmap.get(c.caso_id);
        if (!lr || new Date(c.created_at) > new Date(lr)) naoLidos.add(c.caso_id);
      }
      if (vivo) setConversasBadge(naoLidos.size);
    }
    calc();
    const t = setInterval(calc, 60000);
    // Tempo real: recalcula na hora quando chega comentário novo (fase 3).
    const canal = supabase
      .channel("sidebar-conversas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comentarios" },
        () => calc(),
      )
      .subscribe();
    if (typeof window !== "undefined") {
      window.addEventListener("msc:conversas-mudou", calc);
    }
    return () => {
      vivo = false;
      clearInterval(t);
      supabase.removeChannel(canal);
      if (typeof window !== "undefined") {
        window.removeEventListener("msc:conversas-mudou", calc);
      }
    };
  }, [meuId]);

  // A antiga fila "A enviar" (rascunhos de aviso de perícia) aposentou em
  // 2026-08-24: o aviso sai direto no agendamento e o que sobra vira tarefa
  // "Enviar aviso ao parceiro" — o badge de rascunhos foi junto.

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
          onClick={fecharSeMobile}
        >
          {collapsed ? (
            // Estado colapsado: mostra so o mark "msv" em um badge dourado.
            // Mantem identidade visual sem ocupar largura.
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white font-bold italic"
              style={{
                background: "linear-gradient(135deg, #c9a14a 0%, #e8c878 50%, #b8862e 100%)",
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
                const badge =
                  item.url === "/publicacoes"
                    ? pubBadge
                    : item.url === "/documentos"
                      ? docBadge
                      : item.url === "/conversas"
                        ? conversasBadge
                        : 0;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link
                        to={item.url}
                        className="relative flex items-center gap-2"
                        onClick={fecharSeMobile}
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                        {badge > 0 &&
                          (collapsed ? (
                            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
                          ) : (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
                              {badge > 9 ? "9+" : badge}
                            </span>
                          ))}
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
