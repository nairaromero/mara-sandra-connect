// QG · um escritório: cadastro, equipe, uso e o ciclo de vida.
//
// Tudo aqui é operação. Quem USA o sistema (equipe e parceiros) aparece porque
// é dado necessário para operar o contrato; os clientes do escritório, nunca.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Ban, LifeBuoy, Loader2, PauseCircle, PlayCircle, Save, Search, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { dataBR, dataHoraBR } from "@/lib/fuso";
import { ROTULO_STATUS, type QgEscritorio, type QgMembro } from "@/lib/qg/tipos";
import { useQg } from "@/lib/qg/contexto";
import { useListaPaginada, useValorAtrasado } from "@/hooks/use-lista-paginada";
import { Paginador } from "@/components/paginador";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const POR_PAGINA = 10;

export const Route = createFileRoute("/qg/escritorios/$id")({
  component: QgEscritorio,
});

const ROTULO_METRICA: Record<string, string> = {
  membros_ativos: "Pessoas ativas",
  clientes: "Clientes",
  casos: "Casos",
  casos_abertos: "Casos em andamento",
  documentos: "Documentos",
  storage_bytes: "Armazenamento",
  tarefas_abertas: "Tarefas abertas",
  ia_chamadas_30d: "Chamadas de IA (30 d)",
  ia_tokens_30d: "Tokens de IA (30 d)",
  tokens_mcp: "Tokens MCP ativos",
  notificacoes_30d: "Notificações (30 d)",
};

function formatarMetrica(chave: string, valor: number): string {
  if (chave === "storage_bytes") {
    if (valor < 1024 * 1024) return `${(valor / 1024).toFixed(0)} KB`;
    if (valor < 1024 ** 3) return `${(valor / 1024 ** 2).toFixed(1)} MB`;
    return `${(valor / 1024 ** 3).toFixed(2)} GB`;
  }
  return valor.toLocaleString("pt-BR");
}

type Acao =
  | { tipo: "suspender" | "encerrar" | "suporte" | "break_glass" }
  | { tipo: "desativar" | "titular"; membro: QgMembro };

function QgEscritorio() {
  const { id } = Route.useParams();
  const qg = useQg();
  const navigate = useNavigate();
  const [esc, setEsc] = useState<QgEscritorio | null | undefined>(undefined);
  const [uso, setUso] = useState<Array<{ metrica: string; valor: number }>>([]);
  const [buscaMembro, setBuscaMembro] = useState("");
  const [statusMembro, setStatusMembro] = useState<string>("ativos");
  const buscaMembroAtrasada = useValorAtrasado(buscaMembro.trim(), 250);
  // 10 por vez; busca por nome/e-mail e filtro de status vao para o banco
  const membros = useListaPaginada<QgMembro>(
    (offset, limite) =>
      supabase.rpc("qg_membros", {
        p_escritorio_id: id,
        p_busca: buscaMembroAtrasada || null,
        p_status: statusMembro,
        p_limite: limite,
        p_offset: offset,
      }),
    `${id}|${buscaMembroAtrasada}|${statusMembro}`,
    { porPagina: POR_PAGINA, persistencia: "qg-membros" },
  );
  const [form, setForm] = useState({ nome: "", slug: "", cnpj: "", plano: "", contato_encarregado: "" });
  const [salvando, setSalvando] = useState(false);
  const [acao, setAcao] = useState<Acao | null>(null);

  const carregar = useCallback(async () => {
    const [e, u] = await Promise.all([
      supabase.rpc("qg_escritorios", { p_id: id, p_limite: 1 }),
      supabase.rpc("qg_uso", { p_escritorio_id: id }),
    ]);
    if (e.error || u.error) {
      toast.error("Não consegui carregar o escritório.", {
        description: (e.error ?? u.error)?.message,
      });
      return;
    }
    const achado = ((e.data ?? []) as Array<QgEscritorio>)[0] ?? null;
    setEsc(achado);
    setUso(((u.data ?? []) as Array<{ metrica: string; valor: number }>).map((x) => ({ ...x, valor: Number(x.valor) })));
    if (achado) {
      setForm((f) => ({ ...f, nome: achado.nome, slug: achado.slug, cnpj: achado.cnpj ?? "", plano: achado.plano }));
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.rpc("qg_atualizar_escritorio", {
      p_id: id,
      p_patch: { nome: form.nome, slug: form.slug, cnpj: form.cnpj, plano: form.plano, contato_encarregado: form.contato_encarregado },
    });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Escritório atualizado.");
    void carregar();
  }

  async function reativar() {
    const { error } = await supabase.rpc("qg_reativar_escritorio", { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("Escritório reativado.");
    void carregar();
  }

  async function pedirEliminacao() {
    const { error } = await supabase.rpc("qg_pedir_eliminacao", { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("Eliminação pedida. Outra pessoa do QG precisa aprovar, depois da carência.");
    navigate({ to: "/qg/operacao" });
  }

  if (esc === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (esc === null) {
    return (
      <div className="space-y-3 py-16 text-center text-sm text-slate-600">
        <p>Escritório não encontrado.</p>
        <Button asChild variant="outline">
          <Link to="/qg">Voltar</Link>
        </Button>
      </div>
    );
  }

  const podeGerenciar = qg.pode("escritorios_gerenciar");
  const vivo = esc.status === "ativo" || esc.status === "suspenso" || esc.status === "provisionando";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/qg">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Escritórios
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{esc.nome}</h1>
        <Badge variant="outline">{ROTULO_STATUS[esc.status]}</Badge>
        {esc.padrao_sistema && <Badge variant="secondary">padrão do sistema</Badge>}
      </div>

      {esc.status === "suspenso" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-900">
            Suspenso em {esc.suspenso_em ? dataHoraBR(esc.suspenso_em) : "—"}: {esc.suspenso_motivo}. A equipe vê um aviso em
            vez do sistema; os dados estão intactos.
          </CardContent>
        </Card>
      )}
      {esc.status === "encerrado" && (
        <Card className="border-slate-300 bg-slate-100">
          <CardContent className="py-3 text-sm text-slate-700">
            Encerrado em {esc.encerrado_em ? dataHoraBR(esc.encerrado_em) : "—"}: {esc.suspenso_motivo}. Os dados ficam
            guardados até a eliminação, que exige carência e a aprovação de uma segunda pessoa do QG.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Cadastro</CardTitle>
            <CardDescription>Dados do contrato. As integrações do escritório só mostram status — nunca o segredo.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="e-nome">Nome</Label>
              <Input id="e-nome" value={form.nome} disabled={!podeGerenciar} onChange={(ev) => setForm({ ...form, nome: ev.target.value })} />
            </div>
            <div>
              <Label htmlFor="e-slug">Identificador</Label>
              <Input id="e-slug" value={form.slug} disabled={!podeGerenciar} onChange={(ev) => setForm({ ...form, slug: ev.target.value.toLowerCase() })} />
            </div>
            <div>
              <Label htmlFor="e-cnpj">CNPJ</Label>
              <Input id="e-cnpj" value={form.cnpj} disabled={!podeGerenciar} onChange={(ev) => setForm({ ...form, cnpj: ev.target.value })} />
            </div>
            <div>
              <Label htmlFor="e-plano">Plano</Label>
              <Input id="e-plano" value={form.plano} disabled={!podeGerenciar} onChange={(ev) => setForm({ ...form, plano: ev.target.value })} />
            </div>
            <div>
              <Label htmlFor="e-enc">Contato do encarregado (LGPD)</Label>
              <Input id="e-enc" value={form.contato_encarregado} disabled={!podeGerenciar} onChange={(ev) => setForm({ ...form, contato_encarregado: ev.target.value })} />
            </div>
            {podeGerenciar && (
              <div className="sm:col-span-2">
                <Button onClick={salvar} disabled={salvando}>
                  {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Uso</CardTitle>
            <CardDescription>Contagens — nada de conteúdo.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              {uso.map((u) => (
                <div key={u.metrica} className="flex justify-between gap-3">
                  <dt className="text-slate-600">{ROTULO_METRICA[u.metrica] ?? u.metrica}</dt>
                  <dd className="font-medium tabular-nums">{formatarMetrica(u.metrica, u.valor)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Quem usa o sistema{membros.total != null ? ` (${membros.total})` : ""}
          </CardTitle>
          <CardDescription>Equipe e parceiros do escritório. As ações daqui avisam o escritório e ficam na auditoria dele.</CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={buscaMembro}
                onChange={(e) => setBuscaMembro(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                aria-label="Buscar pessoa"
                className="pl-9"
              />
            </div>
            <Select value={statusMembro} onValueChange={setStatusMembro}>
              <SelectTrigger className="w-44" aria-label="Filtrar pessoas por status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos e convidados</SelectItem>
                <SelectItem value="ativo">Só ativos</SelectItem>
                <SelectItem value="convidado">Só convidados</SelectItem>
                <SelectItem value="desativado">Desativados</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {membros.erro && (
            <p className="px-4 py-3 text-sm text-red-700">Não consegui carregar as pessoas: {membros.erro}</p>
          )}
          {!membros.carregando && !membros.erro && membros.itens.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Ninguém com esse filtro.</p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>2 etapas</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {membros.itens.map((m) => (
                <TableRow key={m.usuario_id} className={m.status === "desativado" ? "opacity-60" : ""}>
                  <TableCell>
                    <div className="font-medium">{m.nome ?? "(sem nome)"}</div>
                    <div className="text-xs text-slate-500">{m.email}</div>
                  </TableCell>
                  <TableCell>{m.papel_nome}</TableCell>
                  <TableCell>{m.status}</TableCell>
                  <TableCell>{m.mfa ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <span className="text-xs text-slate-400">não</span>}</TableCell>
                  <TableCell className="text-sm text-slate-600">{m.ultimo_acesso ? dataHoraBR(m.ultimo_acesso) : "nunca"}</TableCell>
                  <TableCell className="text-right">
                    {qg.pode("membros_operar") && m.status === "ativo" && vivo && (
                      <div className="flex justify-end gap-1">
                        {m.tipo_acesso === "interno" && m.papel !== "admin" && (
                          <Button size="sm" variant="ghost" onClick={() => setAcao({ tipo: "titular", membro: m })} title="Trocar titular: promove a admin">
                            <UserCog className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setAcao({ tipo: "desativar", membro: m })} title="Desativar o vínculo">
                          <Ban className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginador
            pagina={membros.pagina}
            porPagina={membros.porPagina}
            total={membros.total}
            temMais={membros.temMais}
            carregando={membros.carregando && membros.itens.length > 0}
            onPagina={membros.irPara}
            onPorPagina={membros.setPorPagina}
            nome="pessoas"
            className="border-t"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ações</CardTitle>
          <CardDescription>Criado em {dataBR(esc.criado_em)}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {qg.pode("suporte_solicitar") && vivo && (
            <Button variant="outline" onClick={() => setAcao({ tipo: "suporte" })}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              Pedir acesso de suporte
            </Button>
          )}
          {qg.pode("break_glass") && vivo && (
            <Button variant="outline" className="border-red-300 text-red-700" onClick={() => setAcao({ tipo: "break_glass" })}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              Break-glass
            </Button>
          )}
          {podeGerenciar && esc.status === "ativo" && !esc.padrao_sistema && (
            <Button variant="outline" onClick={() => setAcao({ tipo: "suspender" })}>
              <PauseCircle className="mr-2 h-4 w-4" />
              Suspender
            </Button>
          )}
          {podeGerenciar && esc.status === "suspenso" && (
            <Button variant="outline" onClick={reativar}>
              <PlayCircle className="mr-2 h-4 w-4" />
              Reativar
            </Button>
          )}
          {qg.pode("escritorios_encerrar") && vivo && !esc.padrao_sistema && (
            <Button variant="outline" className="border-red-300 text-red-700" onClick={() => setAcao({ tipo: "encerrar" })}>
              <Ban className="mr-2 h-4 w-4" />
              Encerrar
            </Button>
          )}
          {qg.pode("escritorios_encerrar") && esc.status === "encerrado" && (
            <Button variant="destructive" onClick={pedirEliminacao}>
              <Trash2 className="mr-2 h-4 w-4" />
              Pedir eliminação dos dados
            </Button>
          )}
          {esc.padrao_sistema && (
            <p className="w-full text-xs text-slate-500">
              O escritório padrão do sistema é o dono das integrações globais (v1) e não pode ser suspenso nem encerrado.
            </p>
          )}
        </CardContent>
      </Card>

      <AcaoDialog
        acao={acao}
        escritorio={esc}
        onFechar={() => setAcao(null)}
        onFeito={() => {
          setAcao(null);
          void carregar();
          membros.recarregar();
        }}
      />
    </div>
  );
}

function AcaoDialog(props: { acao: Acao | null; escritorio: QgEscritorio; onFechar: () => void; onFeito: () => void }) {
  const { acao, escritorio } = props;
  const [motivo, setMotivo] = useState("");
  const [horas, setHoras] = useState("4");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setMotivo("");
    setHoras("4");
  }, [acao]);

  if (!acao) return null;

  const textos: Record<Acao["tipo"], { titulo: string; descricao: string; botao: string }> = {
    suspender: {
      titulo: `Suspender ${escritorio.nome}`,
      descricao: "A equipe passa a ver um aviso em vez do sistema e as rotinas param. Os dados ficam intactos. O motivo é mostrado ao escritório.",
      botao: "Suspender",
    },
    encerrar: {
      titulo: `Encerrar ${escritorio.nome}`,
      descricao: "O escritório sai do ar. Os dados ficam guardados; a eliminação é um pedido à parte, com carência e aprovação de uma segunda pessoa.",
      botao: "Encerrar",
    },
    suporte: {
      titulo: `Pedir acesso de suporte a ${escritorio.nome}`,
      descricao: "Um admin DO ESCRITÓRIO precisa aprovar. O acesso é somente leitura, com a sua identidade, tem prazo, e tudo que você abrir fica registrado para o escritório.",
      botao: "Enviar pedido",
    },
    break_glass: {
      titulo: `Break-glass em ${escritorio.nome}`,
      descricao: "Acesso de emergência SEM aprovação prévia, só para incidente grave que afeta o escritório. O escritório é avisado e o uso exige post-mortem.",
      botao: "Abrir acesso de emergência",
    },
    desativar: {
      titulo: `Desativar ${"membro" in acao ? (acao.membro.nome ?? "a pessoa") : ""}`,
      descricao: "Uso em incidente (conta comprometida, pedido do escritório). A pessoa perde o acesso a este escritório na hora.",
      botao: "Desativar vínculo",
    },
    titular: {
      titulo: `Tornar ${"membro" in acao ? (acao.membro.nome ?? "a pessoa") : ""} admin`,
      descricao: "Para quando o admin do escritório saiu sem deixar sucessor. Todos os admins do escritório são avisados.",
      botao: "Promover a admin",
    },
  };
  const t = textos[acao.tipo];

  async function confirmar() {
    if (!acao) return;
    setEnviando(true);
    let erro: string | undefined;
    let ticketGerado: string | undefined;
    if (acao.tipo === "suspender") {
      erro = (await supabase.rpc("qg_suspender_escritorio", { p_id: escritorio.id, p_motivo: motivo })).error?.message;
    } else if (acao.tipo === "encerrar") {
      erro = (await supabase.rpc("qg_encerrar_escritorio", { p_id: escritorio.id, p_motivo: motivo })).error?.message;
    } else if (acao.tipo === "suporte" || acao.tipo === "break_glass") {
      // O número do pedido é gerado pelo servidor (migration_rbac_19): quem pede
      // não digita mais. Digitado, ele repetia — no staging três pedidos saíram
      // com o mesmo "T-2026" — e um número repetido não acha nada na auditoria.
      const r = await supabase.rpc("qg_suporte_solicitar", {
        p_escritorio_id: escritorio.id,
        p_motivo: motivo,
        p_horas: Number(horas) || 4,
        p_break_glass: acao.tipo === "break_glass",
      });
      erro = r.error?.message;
      const gerado = (r.data as Array<{ ticket: string }> | null)?.[0]?.ticket;
      if (!erro && gerado) ticketGerado = gerado;
    } else if (acao.tipo === "desativar") {
      erro = (await supabase.rpc("qg_desativar_membro", { p_escritorio_id: escritorio.id, p_usuario_id: acao.membro.usuario_id, p_motivo: motivo })).error?.message;
    } else if (acao.tipo === "titular") {
      erro = (await supabase.rpc("qg_trocar_titular", { p_escritorio_id: escritorio.id, p_usuario_id: acao.membro.usuario_id, p_motivo: motivo })).error?.message;
    }
    setEnviando(false);
    if (erro) return toast.error(erro);
    toast.success(
      ticketGerado
        ? `Pedido ${ticketGerado} enviado. Ficou registrado na auditoria do escritório.`
        : "Feito. Ficou registrado na auditoria do escritório.",
    );
    props.onFeito();
  }

  const ehSuporte = acao.tipo === "suporte" || acao.tipo === "break_glass";

  return (
    <Dialog open onOpenChange={(o) => !o && !enviando && props.onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.titulo}</DialogTitle>
          <DialogDescription>{t.descricao}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="acao-motivo">Motivo (o escritório vê)</Label>
            <Textarea id="acao-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Mínimo de 10 caracteres" />
          </div>
          {ehSuporte && (
            <div className="grid gap-3">
              <div>
                <Label htmlFor="acao-horas">Duração (horas)</Label>
                <Input id="acao-horas" type="number" min={1} max={72} value={horas} onChange={(e) => setHoras(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground" data-ticket-automatico>
                O número do pedido sai automático (SUP-ano-sequência) e aparece aqui e na
                auditoria do escritório.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando || motivo.trim().length < 10} variant={acao.tipo === "suporte" ? "default" : "destructive"}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.botao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
