// QG da plataforma (superadmin) — layout e guarda de todas as rotas /qg/*.
//
// Decisão de 21/09 (planning/MULTI_TENANT_RBAC.md §4.6): o QG vê e gerencia a
// OPERAÇÃO de todos os escritórios — ciclo de vida, membros, saúde, uso,
// suporte, auditoria —, nunca o conteúdo dos clientes. Tudo que aparece aqui vem
// de funções `qg_*`, que devolvem metadados e contagens e começam conferindo
// `plataforma_staff` no banco. Esta guarda só decide o que MOSTRAR.

import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, BookOpen, Building2, LifeBuoy, Loader2, LogOut, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ehHostQG, urlDoProduto, urlDoQG } from "@/lib/qg/host";
import { QgContext } from "@/lib/qg/contexto";
import { ROTULO_PAPEL_STAFF, type QgEu } from "@/lib/qg/tipos";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/qg")({
  component: QgLayout,
});

const NAV = [
  { to: "/qg", titulo: "Escritórios", icon: Building2, exato: true },
  { to: "/qg/operacao", titulo: "Operação", icon: Activity, exato: false },
  { to: "/qg/equipe", titulo: "Equipe do QG", icon: Users, exato: false },
  { to: "/qg/glossario", titulo: "Glossário", icon: BookOpen, exato: false },
] as const;

function QgLayout() {
  const { session, loading, signOut, usuario } = useAuth();
  const navigate = useNavigate();
  const rota = useRouterState({ select: (r) => r.location.pathname });
  // undefined = ainda não sei; null = não é staff
  const [eu, setEu] = useState<QgEu | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [noHost, setNoHost] = useState<boolean | null>(null);

  useEffect(() => setNoHost(ehHostQG()), []);

  useEffect(() => {
    if (noHost === false) return;
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate, noHost]);

  useEffect(() => {
    if (!session || noHost !== true) return;
    let vivo = true;
    supabase.rpc("qg_eu").then(({ data, error }) => {
      if (!vivo) return;
      if (error) {
        // Falha de consulta NÃO é "não é staff": mostra o erro e deixa tentar de novo.
        setErro(error.message);
        return;
      }
      setEu(((data ?? []) as Array<QgEu>)[0] ?? null);
    });
    return () => {
      vivo = false;
    };
  }, [session, noHost]);

  if (noHost === null || loading) return <Carregando />;

  // Fora do host do QG esta árvore de rotas não existe.
  if (!noHost) {
    return (
      <Aviso titulo="O QG fica em outro endereço" icon={ShieldAlert}>
        <p>O painel da plataforma tem porta própria, separada do sistema do escritório.</p>
        <Button asChild variant="outline">
          <a href={urlDoQG()}>Abrir o QG</a>
        </Button>
      </Aviso>
    );
  }
  if (!session) return <Carregando />;
  if (erro) {
    return (
      <Aviso titulo="Não consegui verificar seu acesso ao QG" icon={ShieldAlert}>
        <p className="font-mono text-xs">{erro}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tentar de novo
        </Button>
      </Aviso>
    );
  }
  if (eu === undefined) return <Carregando />;
  if (eu === null) {
    return (
      <Aviso titulo="Acesso restrito à equipe da plataforma" icon={ShieldAlert}>
        <p>
          A conta <strong>{usuario?.email ?? session.user.email}</strong> não faz parte do QG. Se você procura o
          sistema do escritório, ele fica em outro endereço.
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild variant="outline">
            <a href={urlDoProduto()}>Ir para o sistema</a>
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
          >
            Sair
          </Button>
        </div>
      </Aviso>
    );
  }
  if (eu.exige_aal2 && eu.aal !== "aal2") {
    return (
      <Aviso titulo="O QG exige verificação em duas etapas" icon={ShieldCheck}>
        <p>
          Esta instalação exige AAL2 para o QG. Ative o segundo fator na sua conta e entre de novo com o código.
        </p>
      </Aviso>
    );
  }

  return (
    <QgContext.Provider value={eu}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 text-slate-100">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link to="/qg" className="flex items-center gap-2 font-semibold tracking-tight">
              <ShieldCheck className="h-5 w-5 text-amber-400" />
              QG da plataforma
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((n) => {
                const ativo = n.exato ? rota === n.to || rota.startsWith("/qg/escritorios") : rota.startsWith(n.to);
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors " +
                      (ativo ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white")
                    }
                  >
                    <n.icon className="h-4 w-4" />
                    {n.titulo}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <Badge className="border-amber-400/40 bg-amber-400/15 text-amber-200 hover:bg-amber-400/15">
                {ROTULO_PAPEL_STAFF[eu.papel]}
                {eu.break_glass ? " · break-glass" : ""}
              </Badge>
              <span className="hidden text-slate-300 md:inline">{usuario?.nome ?? session.user.email}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-300 hover:bg-slate-800 hover:text-white"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/login" });
                }}
              >
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>
        </header>
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          <LifeBuoy className="mr-1 inline h-3.5 w-3.5" />
          O QG mostra a <strong>operação</strong> dos escritórios — nunca clientes, casos ou documentos. Conteúdo só com
          suporte aprovado pelo próprio escritório. Tudo que você faz aqui fica na auditoria dele.
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </QgContext.Provider>
  );
}

function Carregando() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function Aviso(props: { titulo: string; icon: typeof ShieldAlert; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md space-y-4 text-center text-sm text-slate-600">
        <props.icon className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="text-xl font-semibold text-slate-900">{props.titulo}</h1>
        {props.children}
      </div>
    </div>
  );
}
