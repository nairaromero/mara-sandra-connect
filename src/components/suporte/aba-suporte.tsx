// Configuracoes -> Suporte (so admin): os pedidos de acesso de suporte da
// plataforma a ESTE escritorio. Aprovar abre uma sessao somente leitura, com
// prazo, com a propria identidade de quem pediu; tudo que ela abrir fica na
// auditoria do escritorio. O admin encerra quando quiser.

import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, LifeBuoy, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { dataHoraBR } from "@/lib/fuso";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENTO_SUPORTE, emAndamento, type PedidoSuporte } from "@/lib/suporte/pedidos";


export function AbaSuporte() {
  const [pedidos, setPedidos] = useState<Array<PedidoSuporte> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agindo, setAgindo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("suporte_pedidos");
    if (error) {
      // erro NAO vira "nenhum pedido": o admin precisa saber que a lista falhou
      setErro(error.message);
      return;
    }
    setErro(null);
    setPedidos((data ?? []) as Array<PedidoSuporte>);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function responder(p: PedidoSuporte, aprovar: boolean) {
    setAgindo(p.id);
    const { error } = await supabase.rpc("suporte_responder", { p_id: p.id, p_aprovar: aprovar });
    setAgindo(null);
    if (error) return toast.error(error.message);
    toast.success(aprovar ? `Acesso aprovado por ${p.horas} h. Tudo que o suporte abrir fica na Auditoria.` : "Pedido recusado.");
    window.dispatchEvent(new CustomEvent(EVENTO_SUPORTE));
    void carregar();
  }

  async function encerrar(p: PedidoSuporte) {
    setAgindo(p.id);
    const { error } = await supabase.rpc("suporte_encerrar", { p_id: p.id });
    setAgindo(null);
    if (error) return toast.error(error.message);
    toast.success("Acesso encerrado. O suporte não vê mais nada deste escritório.");
    window.dispatchEvent(new CustomEvent(EVENTO_SUPORTE));
    void carregar();
  }

  const agora = Date.now();
  const pendentes = (pedidos ?? []).filter((p) => p.status === "pendente");
  const ativos = (pedidos ?? []).filter((p) => emAndamento(p, agora));
  const historico = (pedidos ?? []).filter((p) => p.status !== "pendente" && !emAndamento(p, agora));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="h-5 w-5 text-[var(--gold)]" />
            Acesso de suporte da plataforma
          </CardTitle>
          <CardDescription>
            A equipe que opera a plataforma <strong>não vê</strong> clientes, casos nem documentos deste escritório. Quando
            precisa olhar algo para resolver um problema, ela pede aqui, e só um administrador libera: a sessão é{" "}
            <strong>somente leitura</strong>, tem prazo, usa a identidade de quem pediu, e cada tela aberta fica na{" "}
            <Link to="/auditoria" className="underline underline-offset-2">
              Auditoria
            </Link>
            . Você pode encerrar a qualquer momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {erro && (
            <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              Não consegui carregar os pedidos: {erro}
            </p>
          )}
          {pedidos === null && !erro && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {pedidos !== null && (
            <section className="space-y-3" data-secao="pendentes">
              <h3 className="text-sm font-semibold">
                Pedidos aguardando resposta {pendentes.length > 0 && <Badge className="ml-1 bg-amber-500 text-black hover:bg-amber-500">{pendentes.length}</Badge>}
              </h3>
              {pendentes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pedido pendente.</p>
              ) : (
                pendentes.map((p) => (
                  <div key={p.id} data-pedido={p.id} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                    <Cabecalho p={p} />
                    <p className="mt-2 text-sm">{p.motivo}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => responder(p, true)} disabled={agindo === p.id}>
                        {agindo === p.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Aprovar por {p.horas} h
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => responder(p, false)} disabled={agindo === p.id}>
                        <XCircle className="mr-2 h-4 w-4" />
                        Recusar
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {pedidos !== null && (
            <section className="space-y-3" data-secao="andamento">
              <h3 className="text-sm font-semibold">Acessos em andamento</h3>
              {ativos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ninguém da plataforma está com acesso agora.</p>
              ) : (
                ativos.map((p) => (
                  <div key={p.id} data-pedido={p.id} className="rounded-lg border p-4">
                    <Cabecalho p={p} />
                    <p className="mt-2 text-sm">{p.motivo}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Somente leitura · desde {p.inicio ? dataHoraBR(p.inicio) : "—"} · até {p.fim ? dataHoraBR(p.fim) : "—"}
                    </p>
                    <div className="mt-3">
                      <Button size="sm" variant="outline" className="text-red-700" onClick={() => encerrar(p)} disabled={agindo === p.id}>
                        {agindo === p.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                        Encerrar agora
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {pedidos !== null && historico.length > 0 && (
            <section className="space-y-2" data-secao="historico">
              <h3 className="text-sm font-semibold">Histórico</h3>
              <ul className="divide-y rounded-lg border">
                {historico.map((p) => (
                  <li key={p.id} data-pedido={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{p.staff_nome ?? "Plataforma"}</span>
                      <span className="text-muted-foreground"> · {dataHoraBR(p.solicitado_em)}</span>
                      <span className="block truncate text-muted-foreground">{p.motivo}</span>
                    </span>
                    <StatusBadge p={p} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Cabecalho({ p }: { p: PedidoSuporte }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{p.staff_nome ?? "Plataforma"}</span>
      <span className="text-xs text-muted-foreground">pediu em {dataHoraBR(p.solicitado_em)}</span>
      {p.ticket && <Badge variant="outline">ticket {p.ticket}</Badge>}
      {p.break_glass && <Badge className="bg-red-600 text-white hover:bg-red-600">emergência (break-glass)</Badge>}
      <StatusBadge p={p} />
    </div>
  );
}

function StatusBadge({ p }: { p: PedidoSuporte }) {
  if (p.status === "pendente") return <Badge className="bg-amber-500 text-black hover:bg-amber-500">aguardando</Badge>;
  if (emAndamento(p)) return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">em andamento</Badge>;
  if (p.status === "aprovado") return <Badge variant="secondary">expirado</Badge>;
  if (p.status === "recusado") return <Badge variant="secondary">recusado</Badge>;
  return <Badge variant="secondary">encerrado</Badge>;
}
