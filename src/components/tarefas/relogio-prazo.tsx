// Relógio de prazos do caso (#397): pedido de prorrogação, radar da Mara e
// painel de datas do caso. As regras moram no banco
// (migration_relogio_prazos.sql); ver src/lib/tarefas/relogio.ts.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlarmClock, Check, ExternalLink, Loader2, Lock, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dataBR, dataHoraBR } from "@/lib/fuso";
import {
  ETAPA_LABEL,
  decidirProrrogacao,
  diaDoCaso,
  diasEntre,
  limiteDias,
  listarPedidosPendentes,
  listarRadar,
  pedirProrrogacao,
  tetoSemPedido,
  type LinhaRadar,
  type PedidoProrrogacao,
  type RelogioEtapa,
  type RelogioPrazo,
} from "@/lib/tarefas/relogio";

// ---------------------------------------------------------------------------
// Pedido de prorrogação (quem não é admin, depois da data do caso)
// ---------------------------------------------------------------------------

export function PedirProrrogacaoDialog({
  aberto,
  tarefaId,
  relogio,
  dataSugerida,
  onFechar,
}: {
  aberto: boolean;
  tarefaId: string;
  relogio: RelogioPrazo;
  dataSugerida: string | null;
  onFechar: (enviado: boolean) => void;
}) {
  const [ate, setAte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setAte(dataSugerida && dataSugerida <= relogio.limite_em ? dataSugerida : relogio.limite_em);
      setMotivo("");
    }
  }, [aberto, dataSugerida, relogio.limite_em]);

  async function enviar() {
    setEnviando(true);
    try {
      await pedirProrrogacao(tarefaId, ate, motivo.trim());
      toast.success("Pedido enviado à Mara", {
        description: "O prazo continua o mesmo até ela decidir.",
      });
      onFechar(true);
    } catch (e) {
      toast.error("Não consegui enviar o pedido", {
        description: (e as { message?: string }).message,
      });
    } finally {
      setEnviando(false);
    }
  }

  const passaDoLimite = !!ate && ate > relogio.limite_em;
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-destructive" />
            Este prazo não pode ser adiado
          </DialogTitle>
          <DialogDescription>
            O prazo do caso vai até <strong>{dataBR(tetoSemPedido(relogio))}</strong>.
            Para passar disso, a Mara precisa aprovar. O limite é{" "}
            <strong>{dataBR(relogio.limite_em)}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pp-ate">Nova data pedida</Label>
            <Input
              id="pp-ate"
              type="date"
              max={relogio.limite_em}
              value={ate}
              onChange={(e) => setAte(e.target.value)}
            />
            {passaDoLimite && (
              <p className="text-xs text-destructive">
                Depois de {dataBR(relogio.limite_em)} nem com aprovação.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-motivo">Por que precisa de mais prazo?</Label>
            <Textarea
              id="pp-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: o parceiro ainda não mandou o laudo; cliente internado."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onFechar(false)} disabled={enviando}>
            Manter o prazo
          </Button>
          <Button
            onClick={() => void enviar()}
            disabled={enviando || !ate || passaDoLimite || motivo.trim().length < 10}
          >
            {enviando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Pedir à Mara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Radar da Mara (tela de Tarefas, só admin)
// ---------------------------------------------------------------------------

const SINAL: Record<LinhaRadar["sinal"], { rotulo: string; classe: string }> = {
  atrasada: { rotulo: "atrasada", classe: "border-red-300 text-red-700 dark:text-red-400" },
  reta_final: { rotulo: "reta final", classe: "border-red-300 text-red-700 dark:text-red-400" },
  espremida: { rotulo: "etapa apertada", classe: "border-amber-300 text-amber-700 dark:text-amber-400" },
  sem_tarefa: { rotulo: "sem tarefa aberta", classe: "border-amber-300 text-amber-700 dark:text-amber-400" },
  ok: { rotulo: "no prazo", classe: "text-muted-foreground" },
};

export function RadarPrazos() {
  const [linhas, setLinhas] = useState<LinhaRadar[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoProrrogacao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  const carregar = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([listarRadar(), listarPedidosPendentes()]);
      setLinhas(r);
      setPedidos(p);
    } catch (e) {
      console.error("radar_prazos:", e);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!linhas) return null;
  const alerta = linhas.filter((l) => l.sinal !== "ok");
  if (linhas.length === 0 && pedidos.length === 0) return null;

  async function decidir(p: PedidoProrrogacao, aprovar: boolean) {
    setDecidindo(p.id);
    try {
      await decidirProrrogacao(p.id, aprovar, obs[p.id]?.trim() || null);
      toast.success(aprovar ? "Prorrogação aprovada." : "Prorrogação negada.");
      await carregar();
    } catch (e) {
      toast.error("Não consegui registrar a decisão", {
        description: (e as { message?: string }).message,
      });
    } finally {
      setDecidindo(null);
    }
  }

  const temAlarme = alerta.length > 0 || pedidos.length > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          void carregar();
        }}
        className={
          "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors " +
          (temAlarme
            ? "border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            : "text-muted-foreground hover:bg-muted/50")
        }
        data-testid="radar-prazos"
      >
        <AlarmClock className="h-4 w-4 shrink-0" />
        <span className="font-medium">
          Prazos dos casos: {linhas.length} {linhas.length === 1 ? "relógio aberto" : "relógios abertos"}
        </span>
        <span className="text-xs opacity-80">
          {pedidos.length > 0 &&
            `· ${pedidos.length} ${pedidos.length === 1 ? "pedido" : "pedidos"} de prorrogação `}
          {alerta.length > 0 && `· ${alerta.length} em risco`}
        </span>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Radar de prazos</DialogTitle>
            <DialogDescription>
              Casos contando do indeferimento. As datas de cada etapa são fixas: atraso
              numa etapa tira dias da seguinte. Os que pedem atenção vêm primeiro.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {pedidos.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Pedidos de prorrogação</h3>
                {pedidos.map((p) => (
                  <div
                    key={p.id}
                    className="space-y-2 rounded-md border border-red-200 bg-red-50/40 p-3 text-sm dark:border-red-800 dark:bg-red-950/40"
                    data-testid="pedido-prorrogacao"
                  >
                    <p className="font-medium">{p.tarefa?.titulo ?? "Tarefa"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.solicitante?.nome ?? "Alguém da equipe"} pede até{" "}
                      <strong className="text-foreground">{dataBR(p.ate)}</strong>
                      {p.due_anterior && <> (hoje vence {dataHoraBR(p.due_anterior)})</>}
                      {p.relogio && <> · limite do caso {dataBR(p.relogio.limite_em)}</>}
                    </p>
                    <p className="whitespace-pre-wrap">{p.motivo}</p>
                    <Input
                      placeholder="Observação (opcional)"
                      value={obs[p.id] ?? ""}
                      onChange={(e) => setObs((o) => ({ ...o, [p.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={decidindo === p.id}
                        onClick={() => void decidir(p, true)}
                      >
                        <Check className="mr-1 h-4 w-4" />
                        Aprovar até {dataBR(p.ate)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decidindo === p.id}
                        onClick={() => void decidir(p, false)}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Negar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAberto(false);
                          navigate({ to: "/casos/$id", params: { id: p.caso_id } });
                        }}
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        Abrir caso
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Relógios abertos</h3>
              {[...alerta, ...linhas.filter((l) => l.sinal === "ok")].map((l) => (
                <div
                  key={l.relogio_id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  data-testid="radar-linha"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {l.cliente_nome ?? "(sem nome)"}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        dia {l.dia_atual} de {diasEntre(l.origem_em, l.limite_em)}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.etapa ? ETAPA_LABEL[l.etapa as RelogioEtapa] : "sem etapa aberta"}
                      {l.responsavel_nome && " · " + l.responsavel_nome}
                      {l.vence_em && " · vence " + dataBR(l.vence_em)}
                      {l.dias_previstos != null && l.dias_disponiveis != null &&
                        ` · ${Math.max(l.dias_disponiveis, 0)} de ${l.dias_previstos} dias`}
                      {l.origem_estimada && " · data do indeferimento estimada"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className={SINAL[l.sinal].classe}>
                      {SINAL[l.sinal].rotulo}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Abrir caso"
                      onClick={() => {
                        setAberto(false);
                        navigate({ to: "/casos/$id", params: { id: l.caso_id } });
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {linhas.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum relógio aberto.</p>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Faixa do relógio no painel de datas do caso
// ---------------------------------------------------------------------------

const ETAPAS_JUDICIAL: RelogioEtapa[] = ["analise", "montagem", "revisao", "protocolo"];
const ETAPAS_RECURSO: RelogioEtapa[] = ["analise", "recurso"];

export function RelogioDoCaso({ relogio }: { relogio: RelogioPrazo }) {
  const etapas = relogio.tipo === "recurso" ? ETAPAS_RECURSO : ETAPAS_JUDICIAL;
  const hoje = diaDoCaso(relogio);
  const total = limiteDias(relogio);
  const encerrado = relogio.status !== "aberto";
  return (
    <div className="space-y-1.5" data-testid="relogio-do-caso">
      <p className="text-xs text-muted-foreground">
        {relogio.tipo === "recurso" ? "Recurso ordinário" : "Até o protocolo judicial"}
        {encerrado
          ? relogio.status === "concluido" ? " · protocolado" : " · encerrado"
          : ` · dia ${hoje} de ${total}`}
        {relogio.liberado_ate && ` · liberado pela Mara até ${dataBR(relogio.liberado_ate)}`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {etapas.map((e) =>
          relogio.etapas[e] ? (
            <Badge key={e} variant="outline" className="font-normal">
              {ETAPA_LABEL[e]}: {dataBR(relogio.etapas[e] as string)}
            </Badge>
          ) : null,
        )}
        <Badge variant="outline" className="border-red-300 font-normal text-red-700 dark:text-red-400">
          Limite: {dataBR(relogio.limite_em)}
        </Badge>
      </div>
    </div>
  );
}
