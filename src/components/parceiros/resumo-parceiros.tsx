// Aba "Resumo semanal" de /parceiros: a configuração do escritório (ligado, dia,
// hora, blocos, padrão para parceiro novo) e a escolha de cada parceiro
// (segue o padrão / sempre / nunca), com prévia e envio de teste.
//
// Tudo passa pela edge function `resumo-parceiros` (exige parceiros:gerenciar);
// as regras — blocos, modos, quem recebe — vêm de @shared/resumo-parceiros, o
// mesmo módulo que monta o e-mail no servidor.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Loader2, Mail, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Selecao } from "@/components/ui/selecao";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Paginador } from "@/components/paginador";
import { usePaginaLocal } from "@/hooks/use-lista-paginada";
import {
  type ConfigResumo,
  CONFIG_PADRAO,
  DIAS_DO_PERIODO,
  DIAS_SEMANA,
  type ModoResumo,
  MODOS_RESUMO,
  recebeResumo,
  ROTULO_MODO,
  SECOES_RESUMO,
  type SecaoResumoId,
} from "@shared/resumo-parceiros";

interface ParceiroResumo {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
  modo: ModoResumo;
  recebe: boolean;
  bloqueio: string | null;
  ultimo_envio: { status: string; itens: number; criado_em: string } | null;
}

async function chamar<T>(body: Record<string, unknown>): Promise<T> {
  const resp = await supabase.functions.invoke("resumo-parceiros", { body });
  if (resp.error) throw new Error(await mensagemDeErroEdge(resp.error, "Não consegui falar com o servidor agora."));
  const dados = resp.data as ({ error?: string } & T) | null;
  if (!dados || dados.error) throw new Error(dados?.error ?? "resposta vazia do servidor");
  return dados;
}

const ROTULO_ENVIO: Record<string, string> = {
  enviado: "enviado",
  sem_novidade: "sem novidade (não enviado)",
  falhou: "falhou",
  enviando: "enviando",
};

function fmtEnvio(e: ParceiroResumo["ultimo_envio"]): string {
  if (!e) return "Nunca enviado";
  const d = new Date(e.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `Último: ${d} · ${ROTULO_ENVIO[e.status] ?? e.status}${e.status === "enviado" ? ` · ${e.itens} itens` : ""}`;
}

const HORAS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

export function ResumoParceiros() {
  const [carregando, setCarregando] = useState(true);
  const [config, setConfig] = useState<ConfigResumo>(CONFIG_PADRAO);
  const [salvo, setSalvo] = useState<ConfigResumo>(CONFIG_PADRAO);
  const [parceiros, setParceiros] = useState<ParceiroResumo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [mudandoId, setMudandoId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [previa, setPrevia] = useState<{ nome: string; parceiroId: string; assunto?: string; html?: string; total?: number } | null>(null);
  const [enviandoTeste, setEnviandoTeste] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await chamar<{ config: ConfigResumo; parceiros: ParceiroResumo[] }>({ acao: "estado" });
      setConfig(r.config);
      setSalvo(r.config);
      setParceiros(r.parceiros);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alterado = JSON.stringify(config) !== JSON.stringify(salvo);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await chamar<{ config: ConfigResumo }>({ acao: "salvar_config", config });
      setSalvo(r.config);
      setConfig(r.config);
      setParceiros((ps) => ps.map((p) => ({ ...p, recebe: recebeResumo(r.config, p.modo) })));
      toast.success("Configuração do resumo salva.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function definirModo(p: ParceiroResumo, modo: ModoResumo) {
    setMudandoId(p.id);
    try {
      await chamar({ acao: "definir_parceiro", parceiro_id: p.id, modo });
      setParceiros((ps) => ps.map((x) => (x.id === p.id ? { ...x, modo, recebe: recebeResumo(salvo, modo) } : x)));
      toast.success(`${p.nome}: ${ROTULO_MODO[modo].toLowerCase()}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMudandoId(null);
    }
  }

  async function abrirPrevia(p: ParceiroResumo) {
    setPrevia({ nome: p.nome, parceiroId: p.id });
    try {
      const r = await chamar<{ assunto: string; html: string; total: number }>({ acao: "previa", parceiro_id: p.id });
      setPrevia({ nome: p.nome, parceiroId: p.id, ...r });
    } catch (e) {
      toast.error((e as Error).message);
      setPrevia(null);
    }
  }

  async function enviarTeste() {
    if (!previa) return;
    setEnviandoTeste(true);
    try {
      const r = await chamar<{ para: string }>({ acao: "teste", parceiro_id: previa.parceiroId });
      toast.success(`Teste enviado para ${r.para}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviandoTeste(false);
    }
  }

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const ativos = parceiros.filter((p) => p.ativo);
    const lista = t ? ativos.filter((p) => `${p.nome} ${p.email ?? ""}`.toLowerCase().includes(t)) : ativos;
    // quem recebe primeiro: é o que a pessoa vem conferir
    return [...lista].sort((a, z) => Number(z.recebe) - Number(a.recebe) || a.nome.localeCompare(z.nome, "pt-BR"));
  }, [parceiros, busca]);
  const pagina = usePaginaLocal(filtrados, busca, { persistencia: "resumo-parceiros" });
  const quantosRecebem = parceiros.filter((p) => p.ativo && p.recebe && !p.bloqueio).length;

  function alternarSecao(id: SecaoResumoId, marcado: boolean) {
    setConfig((c) => ({
      ...c,
      secoes: SECOES_RESUMO.map((s) => s.id).filter((s) => (s === id ? marcado : c.secoes.includes(s))),
    }));
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="resumo-parceiros">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Resumo periódico para parceiros
          </CardTitle>
          <CardDescription>
            Um e-mail com o que aconteceu nos casos de cada parceiro nos últimos {DIAS_DO_PERIODO} dias. Não substitui o
            aviso na hora — é um resumo a mais, para quem pediu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="resumo-ativo" className="text-sm font-medium">Ligado neste escritório</Label>
              <p className="text-xs text-muted-foreground">Desligado, ninguém recebe — nem quem está como "Sempre recebe".</p>
            </div>
            <Switch id="resumo-ativo" checked={config.ativo} onCheckedChange={(v) => setConfig((c) => ({ ...c, ativo: v }))} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Dia do envio</Label>
              <Selecao
                opcoes={DIAS_SEMANA.map((d, i) => ({ value: String(i), label: d }))}
                value={String(config.dia_semana)}
                onChange={(v) => setConfig((c) => ({ ...c, dia_semana: Number(v) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Horário (Brasília)</Label>
              <Selecao opcoes={HORAS} value={String(config.hora)} onChange={(v) => setConfig((c) => ({ ...c, hora: Number(v) }))} busca={false} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>O que vai no e-mail</Label>
            {SECOES_RESUMO.map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={config.secoes.includes(s.id)}
                  onCheckedChange={(v) => alternarSecao(s.id, v === true)}
                  className="mt-0.5"
                />
                <span>
                  {s.rotulo}
                  <span className="block text-xs text-muted-foreground">{s.explicacao}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Parceiro sem escolha própria</Label>
            <Selecao
              opcoes={[
                { value: "nao", label: "Não recebe (só quem estiver como “Sempre recebe”)" },
                { value: "sim", label: "Recebe" },
              ]}
              value={config.padrao_parceiros ? "sim" : "nao"}
              onChange={(v) => setConfig((c) => ({ ...c, padrao_parceiros: v === "sim" }))}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {salvo.ativo
                ? `Próximo envio: ${DIAS_SEMANA[salvo.dia_semana].toLowerCase()} às ${String(salvo.hora).padStart(2, "0")}:00 · ${quantosRecebem} parceiro${quantosRecebem === 1 ? "" : "s"}`
                : "Resumo desligado neste escritório."}
            </p>
            <Button onClick={salvar} disabled={!alterado || salvando || config.secoes.length === 0}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quem recebe</CardTitle>
          <CardDescription>
            A escolha de cada parceiro vale por cima do padrão do escritório. Parceiro sem aceite dos termos vigentes
            não recebe, qualquer que seja a escolha.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar parceiro" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
          </div>
          <div className="divide-y rounded-md border">
            {pagina.itens.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhum parceiro encontrado.</p>}
            {pagina.itens.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid={`resumo-parceiro-${p.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm truncate">{p.nome}</span>
                    {p.recebe && !p.bloqueio && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Recebe</Badge>}
                    {p.recebe && p.bloqueio && <Badge variant="outline" className="text-amber-700 border-amber-300">Não recebe: {p.bloqueio}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{p.email ?? "sem e-mail"} · {fmtEnvio(p.ultimo_envio)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Selecao
                    className="w-[270px]"
                    opcoes={MODOS_RESUMO.map((m) => ({ value: m, label: ROTULO_MODO[m] }))}
                    value={p.modo}
                    onChange={(v) => void definirModo(p, v as ModoResumo)}
                    disabled={mudandoId === p.id}
                  />
                  <Button variant="outline" size="sm" onClick={() => void abrirPrevia(p)} title="Ver prévia do e-mail">
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Paginador
            pagina={pagina.pagina}
            porPagina={pagina.porPagina}
            total={pagina.total}
            onPagina={pagina.irPara}
            onPorPagina={pagina.setPorPagina}
            nome="parceiros"
          />
        </CardContent>
      </Card>

      <Dialog open={previa !== null} onOpenChange={(o) => !o && setPrevia(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Prévia do resumo — {previa?.nome}</DialogTitle>
            <DialogDescription>
              {previa?.assunto ?? "Montando…"}
              {previa?.total === 0 && " · Sem novidades no período: este e-mail não seria enviado."}
            </DialogDescription>
          </DialogHeader>
          {previa?.html ? (
            <>
              <iframe title="Prévia do e-mail" srcDoc={previa.html} sandbox="" className="h-[65vh] w-full rounded border bg-white" />
              <div className="flex justify-end">
                <Button variant="outline" onClick={enviarTeste} disabled={enviandoTeste}>
                  {enviandoTeste ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />}
                  Enviar teste para mim
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
