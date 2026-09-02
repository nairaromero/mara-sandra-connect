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

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fimDoDiaBR, inputDateBRParaIso, isoParaInputDateBR } from "@/lib/fuso";
import { TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
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

export interface SolicitacaoEditavel {
  id: string;
  tipo: string;
  descricao: string | null;
  origem: string;
  // "Enviar até" do parceiro (fatal − 3). Editável aqui inclusive nas de
  // template — é como a equipe define o prazo da exigência judicial antiga
  // (sem backfill) ou ajusta um prazo que mudou.
  prazo_at: string | null;
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
  }, [solic]);

  const origemEditavel = origem === "externa" || origem === "interna";
  // Nome personalizado é opcional na edição: solicitação de template nasce
  // tipo=outro sem nome (a descrição é o despacho do INSS), e exigir um nome
  // aqui travaria justamente o caso em que mais se precisa editar.
  const valido = !!tipo;

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
