// Edita uma solicitação de documento PENDENTE (só interno; a RLS
// solicitacoes_modify já libera UPDATE pra is_interno()). Usado na aba
// Documentos do caso e na tela /documentos ("Documentos pendentes").
//
// Mesmos campos do "Nova solicitação". Convenção herdada de lá: tipo=outro
// guarda o nome personalizado como prefixo "[Nome] " da descrição, porque a
// tabela não tem coluna tipo_personalizado. Aqui o prefixo é separado ao abrir
// e remontado ao salvar, pra editar como dois campos.
//
// Origem de template ("template:exigencia") não é editável: ela é o que liga a
// solicitação ao fluxo de exigência (trigger que cria a tarefa "cumprir
// exigência" quando atendida). Só externa/interna podem ser trocadas.
//
// Processo e responsável também se editam aqui (card #357, Naira 2026-09-18):
// o processo decide a coluna do kanban do parceiro e o responsável é quem
// providencia (origem interna) ou quem analisa o documento quando ele volta
// (origem externa). As frentes do caso e a equipe são buscadas ao abrir — o
// diálogo é usado em duas telas (caso e /documentos) e na segunda cada linha é
// de um caso diferente.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fimDoDiaBR, inputDateBRParaIso, isoParaInputDateBR } from "@/lib/fuso";
import { TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
import { listarInternosAtivos } from "@/lib/tarefas/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ORIGEM_LABEL: Record<string, string> = {
  interna: "Interna (escritório)",
  externa: "Externa (parceiro/cliente)",
};

// "" = ninguém escolheu ainda · "sem" = cliente sem processo ·
// "admin:<id>" / "judicial:<id>" = frente escolhida.
const SEM_PROCESSO = "sem";

export interface SolicitacaoEditavel {
  id: string;
  caso_id: string;
  tipo: string;
  descricao: string | null;
  origem: string;
  // "Enviar até" do parceiro (fatal − 3). Editável aqui inclusive nas de
  // template — é como a equipe define o prazo da exigência judicial antiga
  // (sem backfill) ou ajusta um prazo que mudou.
  prazo_at: string | null;
  // Card #357: frente do pedido e dono da tarefa que nasce dele.
  processo_admin_id?: string | null;
  processo_judicial_id?: string | null;
  responsavel_id?: string | null;
}

export function EditarSolicitacaoDialog(props: {
  solic: SolicitacaoEditavel | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { solic, onFechar, onSalvo } = props;
  const [tipo, setTipo] = useState("");
  const [tipoPersonalizado, setTipoPersonalizado] = useState("");
  const [descricao, setDescricao] = useState("");
  const [origem, setOrigem] = useState("externa");
  const [prazo, setPrazo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [processoToken, setProcessoToken] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [frentes, setFrentes] = useState<Array<{ token: string; rotulo: string }> | null>(null);
  const [internos, setInternos] = useState<
    Array<{ id: string; nome: string | null; email: string | null }>
  >([]);

  // Re-hidrata o formulário a cada solicitação aberta.
  useEffect(() => {
    if (!solic) return;
    setTipo(solic.tipo);
    setOrigem(solic.origem);
    setPrazo(isoParaInputDateBR(solic.prazo_at));
    const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(solic.descricao ?? "");
    if (solic.tipo === "outro" && m) {
      setTipoPersonalizado(m[1]);
      setDescricao(m[2]);
    } else {
      setTipoPersonalizado("");
      setDescricao(solic.descricao ?? "");
    }
    setResponsavelId(solic.responsavel_id ?? "");
    setProcessoToken(
      solic.processo_judicial_id
        ? "judicial:" + solic.processo_judicial_id
        : solic.processo_admin_id
          ? "admin:" + solic.processo_admin_id
          : "",
    );
  }, [solic]);

  // Frentes do caso aberto. `null` = ainda carregando — sem isso o Salvar
  // passaria batido antes de a lista chegar.
  const casoId = solic?.caso_id ?? null;
  useEffect(() => {
    if (!casoId) {
      setFrentes(null);
      return;
    }
    let vivo = true;
    setFrentes(null);
    Promise.all([
      supabase
        .from("processos_admin")
        .select("id, numero_requerimento")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true }),
      supabase
        .from("processos_judiciais")
        .select("id, numero_processo")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true }),
    ])
      .then(([admin, judicial]) => {
        if (!vivo) return;
        if (admin.error) throw admin.error;
        if (judicial.error) throw judicial.error;
        setFrentes([
          ...(admin.data ?? []).map((p) => ({
            token: "admin:" + p.id,
            rotulo: "Requerimento " + (p.numero_requerimento || "(sem número)"),
          })),
          ...(judicial.data ?? []).map((p) => ({
            token: "judicial:" + p.id,
            rotulo: "Processo judicial " + (p.numero_processo || "(sem número)"),
          })),
        ]);
      })
      .catch((e) => {
        console.error("frentes do caso:", e);
        if (vivo) {
          setFrentes([]);
          toast.error("Não consegui carregar os processos do caso");
        }
      });
    return () => {
      vivo = false;
    };
  }, [casoId]);

  useEffect(() => {
    if (!solic || internos.length > 0) return;
    listarInternosAtivos()
      .then(setInternos)
      .catch((e) => console.error("listarInternosAtivos:", e));
  }, [solic, internos.length]);

  const origemEditavel = origem === "externa" || origem === "interna";
  // Nome personalizado é opcional na edição: solicitação de template nasce
  // tipo=outro sem nome (a descrição é o despacho do INSS), e exigir um nome
  // aqui travaria justamente o caso em que mais se precisa editar.
  //
  // Processo obrigatório quando o caso tem alguma frente (card #357) —
  // "Cliente sem processo" é uma das respostas. Enquanto as frentes carregam,
  // o Salvar fica travado: liberar aqui gravaria pedido sem frente calado.
  const frentesProntas = frentes !== null;
  const temFrentes = (frentes?.length ?? 0) > 0;
  const valido =
    !!tipo &&
    frentesProntas &&
    (!temFrentes || !!processoToken) &&
    (origem !== "interna" || !!responsavelId);

  async function salvar() {
    if (!solic || !valido) return;
    setSalvando(true);
    try {
      const descricaoFinal =
        tipo === "outro" && tipoPersonalizado.trim()
          ? "[" + tipoPersonalizado.trim() + "] " + descricao.trim()
          : descricao.trim();
      const prazoIsoBase = prazo ? inputDateBRParaIso(prazo) : null;
      const resp = await supabase
        .from("solicitacoes_documento")
        .update({
          tipo,
          descricao: descricaoFinal || null,
          origem,
          prazo_at: prazoIsoBase ? fimDoDiaBR(prazoIsoBase).toISOString() : null,
          processo_admin_id: processoToken.startsWith("admin:")
            ? processoToken.slice(6)
            : null,
          processo_judicial_id: processoToken.startsWith("judicial:")
            ? processoToken.slice(9)
            : null,
          responsavel_id: responsavelId || null,
        })
        .eq("id", solic.id);
      if (resp.error) throw resp.error;
      toast.success("Solicitação atualizada");
      onSalvo();
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string })?.message || "Erro ao salvar solicitação");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!solic} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar solicitação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Tipo de documento</Label>
            <DocTypeCombobox
              options={TIPOS_DOCUMENTO_OPTIONS}
              value={tipo}
              onChange={setTipo}
              placeholder="Selecione ou busque o tipo..."
            />
          </div>
          {tipo === "outro" && (
            <div>
              <Label className="text-xs">Nome do documento</Label>
              <Input
                placeholder="Ex.: Cartão do INSS, Decisão do MS..."
                value={tipoPersonalizado}
                onChange={(e) => setTipoPersonalizado(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Quem vai providenciar?</Label>
            {origemEditavel ? (
              <Select value={origem} onValueChange={setOrigem}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="externa">Externa - parceiro ou cliente envia</SelectItem>
                  <SelectItem value="interna">Interna - escritório providencia</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                {ORIGEM_LABEL[origem] || origem} — veio de template, a origem não muda.
              </p>
            )}
          </div>
          {origem === "interna" && (
            <div>
              <Label className="text-xs">Responsável na equipe (obrigatório)</Label>
              <Select value={responsavelId} onValueChange={setResponsavelId}>
                <SelectTrigger aria-label="Responsável na equipe">
                  <SelectValue placeholder="Quem vai providenciar" />
                </SelectTrigger>
                <SelectContent>
                  {internos.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome || u.email || u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                A tarefa "Providenciar documentos" passa para o nome dessa pessoa.
              </p>
            </div>
          )}
          {temFrentes && (
            <div>
              <Label className="text-xs">Processo *</Label>
              <Select value={processoToken} onValueChange={setProcessoToken}>
                <SelectTrigger aria-label="Processo do pedido">
                  <SelectValue placeholder="Escolha o processo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_PROCESSO}>Cliente sem processo</SelectItem>
                  {(frentes ?? []).map((f) => (
                    <SelectItem key={f.token} value={f.token}>
                      {f.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                É o processo que decide em qual coluna o parceiro vê o pedido: requerimento
                vai para Administrativo, ação para Judiciais.
              </p>
            </div>
          )}
          {origem === "externa" && internos.length > 0 && (
            <div>
              <Label className="text-xs">Quem analisa quando voltar (opcional)</Label>
              <Select
                value={responsavelId || "auto"}
                onValueChange={(v) => setResponsavelId(v === "auto" ? "" : v)}
              >
                <SelectTrigger aria-label="Quem analisa quando voltar">
                  <SelectValue placeholder="Definir automaticamente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Definir automaticamente</SelectItem>
                  {internos.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome || u.email || u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Quando o documento chegar, a tarefa de conferir abre no nome dessa pessoa.
              </p>
            </div>
          )}
          {origem !== "interna" && (
            <div>
              <Label className="text-xs">Prazo para envio ("enviar até" do parceiro)</Label>
              <Input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                aria-label="Prazo para envio"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Regra da casa: fatal real menos 3 dias. Vazio = sem prazo (sem lembretes).
              </p>
            </div>
          )}
          <div>
            <Label className="text-xs">Observação</Label>
            <Textarea
              rows={8}
              placeholder="Detalhes sobre o documento necessário..."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !valido}>
            {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
