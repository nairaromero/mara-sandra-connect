// QG · Operação: saúde das rotinas, acessos de suporte, aprovações pendentes e
// a trilha do que a plataforma fez. Só estados, contagens e códigos de erro —
// nunca a mensagem com dado de cliente.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { dataHoraBR } from "@/lib/fuso";
import type { QgAprovacao, QgAuditoria, QgSaude, QgSuporte } from "@/lib/qg/tipos";
import { useQg } from "@/lib/qg/contexto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/qg/operacao")({
  component: QgOperacao,
});

const ROTULO_GRUPO: Record<QgSaude["grupo"], string> = {
  rotina: "Rotinas (edge functions)",
  cron: "Agendamentos (pg_cron)",
  fila: "Filas por escritório",
  rede: "Chamadas do banco",
};

function IconeEstado({ estado }: { estado: string }) {
  if (estado === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (estado === "falhou" || estado === "travada") return <XCircle className="h-4 w-4 text-red-600" />;
  return <CircleAlert className="h-4 w-4 text-amber-600" />;
}

function QgOperacao() {
  const qg = useQg();
  const [saude, setSaude] = useState<Array<QgSaude> | null>(null);
  const [suporte, setSuporte] = useState<Array<QgSuporte>>([]);
  const [aprovacoes, setAprovacoes] = useState<Array<QgAprovacao>>([]);
  const [trilha, setTrilha] = useState<Array<QgAuditoria>>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [s, sup, ap, au, es] = await Promise.all([
      supabase.rpc("qg_saude"),
      supabase.rpc("qg_suporte"),
      supabase.rpc("qg_aprovacoes"),
      supabase.rpc("qg_auditoria", { p_limite: 100 }),
      supabase.rpc("qg_escritorios_nomes"),
    ]);
    setCarregando(false);
    const falha = s.error ?? sup.error ?? ap.error ?? au.error ?? es.error;
    if (falha) {
      toast.error("Não consegui carregar a operação.", { description: falha.message });
      return;
    }
    setSaude((s.data ?? []) as Array<QgSaude>);
    setSuporte((sup.data ?? []) as Array<QgSuporte>);
    setAprovacoes((ap.data ?? []) as Array<QgAprovacao>);
    setTrilha((au.data ?? []) as Array<QgAuditoria>);
    setNomes(Object.fromEntries(((es.data ?? []) as Array<{ id: string; nome: string }>).map((e) => [e.id, e.nome])));
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function encerrarSuporte(id: string) {
    const { error } = await supabase.rpc("qg_suporte_encerrar", { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("Acesso encerrado.");
    void carregar();
  }

  async function aprovar(id: string) {
    const { data, error } = await supabase.rpc("qg_aprovar_eliminacao", { p_aprovacao_id: id });
    if (error) return toast.error(error.message);
    const r = (data ?? {}) as { linhas_apagadas?: number };
    toast.success(`Escritório eliminado: ${r.linhas_apagadas ?? 0} linha(s) apagada(s).`);
    void carregar();
  }

  const grupos = (["rotina", "cron", "fila", "rede"] as const)
    .map((g) => ({ g, itens: (saude ?? []).filter((x) => x.grupo === g) }))
    .filter((x) => x.itens.length > 0);
  const comProblema = (saude ?? []).filter((x) => x.estado === "falhou" || x.estado === "travada").length;
  const pendentes = aprovacoes.filter((a) => a.status === "pendente").length;
  const suporteAberto = suporte.filter((s) => s.status === "pendente" || s.valido_agora).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operação</h1>
          <p className="text-sm text-slate-600">Saúde das rotinas, acessos de suporte, aprovações e a trilha da plataforma.</p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      <Tabs defaultValue="saude">
        <TabsList>
          <TabsTrigger value="saude">Saúde{comProblema > 0 ? ` (${comProblema})` : ""}</TabsTrigger>
          <TabsTrigger value="suporte">Suporte{suporteAberto > 0 ? ` (${suporteAberto})` : ""}</TabsTrigger>
          <TabsTrigger value="aprovacoes">Aprovações{pendentes > 0 ? ` (${pendentes})` : ""}</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="saude" className="space-y-4">
          {saude === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : grupos.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-slate-600">
                Nenhuma execução registrada ainda. As rotinas passam a aparecer aqui na primeira vez que rodarem
                (neste ambiente não há pg_cron: os agendamentos só existem em produção).
              </CardContent>
            </Card>
          ) : (
            grupos.map(({ g, itens }) => (
              <Card key={g}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{ROTULO_GRUPO[g]}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableBody>
                      {itens.map((x, i) => (
                        <TableRow key={i}>
                          <TableCell className="w-8">
                            <IconeEstado estado={x.estado} />
                          </TableCell>
                          <TableCell className="font-medium">{x.item}</TableCell>
                          <TableCell className="text-sm text-slate-600">{x.escritorio_id ? (nomes[x.escritorio_id] ?? "—") : "plataforma"}</TableCell>
                          <TableCell className="text-sm">{x.estado}</TableCell>
                          <TableCell className="text-sm text-slate-600">{x.quando ? dataHoraBR(x.quando) : "—"}</TableCell>
                          <TableCell className="text-sm text-slate-600">{x.detalhe ?? ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="suporte">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acessos de suporte</CardTitle>
              <CardDescription>
                Pedidos por escritório. Para pedir um, abra o escritório. Com um acesso aprovado, entre no sistema do
                escritório com a SUA conta — ele aparece no seletor, somente leitura.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Escritório</TableHead>
                    <TableHead>Quem</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suporte.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                        Nenhum acesso de suporte.
                      </TableCell>
                    </TableRow>
                  )}
                  {suporte.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link to="/qg/escritorios/$id" params={{ id: s.escritorio_id }} className="hover:underline">
                          {s.escritorio_nome}
                        </Link>
                      </TableCell>
                      <TableCell>{s.staff_nome}</TableCell>
                      <TableCell className="max-w-xs text-sm">
                        {s.motivo}
                        {s.ticket ? <span className="text-slate-500"> · {s.ticket}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.valido_agora ? "default" : "outline"}>
                          {s.break_glass ? "break-glass · " : ""}
                          {s.valido_agora ? "em vigor" : s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{s.fim ? `até ${dataHoraBR(s.fim)}` : `${s.horas} h, a partir da aprovação`}</TableCell>
                      <TableCell className="text-right">
                        {(s.status === "pendente" || s.valido_agora) && qg.pode("suporte_solicitar") && (
                          <Button size="sm" variant="ghost" onClick={() => encerrarSuporte(s.id)}>
                            Encerrar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aprovacoes">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eliminação de escritórios</CardTitle>
              <CardDescription>Quem pede não aprova: precisa de uma segunda pessoa do QG, e só depois da carência.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Escritório</TableHead>
                    <TableHead>Pedido por</TableHead>
                    <TableHead>Quando</TableHead>
                    <TableHead>Libera em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aprovacoes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                        Nenhum pedido.
                      </TableCell>
                    </TableRow>
                  )}
                  {aprovacoes.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.escritorio_nome ?? "(já eliminado)"}</TableCell>
                      <TableCell>{a.pedido_por_nome}</TableCell>
                      <TableCell className="text-sm text-slate-600">{dataHoraBR(a.pedido_em)}</TableCell>
                      <TableCell className="text-sm text-slate-600">{a.libera_em ? dataHoraBR(a.libera_em) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {a.status === "pendente" &&
                          (a.posso_aprovar ? (
                            <Button size="sm" variant="destructive" onClick={() => aprovar(a.id)}>
                              Aprovar e eliminar
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-500">aguarda outra pessoa</span>
                          ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auditoria">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">O que a plataforma fez</CardTitle>
              <CardDescription>As mesmas linhas aparecem para o admin de cada escritório, em Auditoria.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Quem</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Escritório</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trilha.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-sm text-slate-600">{dataHoraBR(t.created_at)}</TableCell>
                      <TableCell>
                        {t.ator_nome ?? "—"} <span className="text-xs text-slate-500">({t.tipo_ator})</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{t.acao}</TableCell>
                      <TableCell>{t.escritorio_nome ?? "plataforma"}</TableCell>
                      <TableCell className="max-w-sm truncate text-xs text-slate-600" title={JSON.stringify(t.detalhes)}>
                        {t.recurso ? `${t.recurso} ` : ""}
                        {Object.keys(t.detalhes ?? {}).length > 0 ? JSON.stringify(t.detalhes) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
