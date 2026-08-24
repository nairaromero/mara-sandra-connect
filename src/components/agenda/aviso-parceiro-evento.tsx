// Bloco "Aviso ao parceiro" embutido nos formulários de agendamento
// (AgendaSheet e TarefaSheet). A revisão do texto acontece AQUI, antes de
// salvar — substitui o passo extra da antiga fila /a-enviar. Desmarcar o
// envio deixa o trigger do banco criar a tarefa "Enviar aviso ao parceiro"
// pra alguém mandar depois.

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  rotulo: string; // "perícia" | "audiência"
  ativo: boolean;
  onAtivoChange: (v: boolean) => void;
  texto: string;
  onTextoChange: (v: string) => void;
}

export function AvisoParceiroEvento({
  rotulo,
  ativo,
  onAtivoChange,
  texto,
  onTextoChange,
}: Props) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-emerald-400 bg-emerald-50/40 p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="ev-aviso-ativo"
          checked={ativo}
          onCheckedChange={(v) => onAtivoChange(v === true)}
        />
        <Label htmlFor="ev-aviso-ativo" className="text-emerald-900">
          Enviar aviso da {rotulo} ao parceiro ao salvar
        </Label>
      </div>
      {ativo && (
        <>
          <Textarea
            aria-label="Texto do aviso ao parceiro"
            value={texto}
            onChange={(e) => onTextoChange(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />
          <p className="text-xs text-emerald-900/70">
            Revise e ajuste à vontade — o parceiro recebe este texto como
            comentário do caso, por e-mail, na hora do salvamento. Desmarcando,
            nasce uma tarefa "Enviar aviso ao parceiro" pra mandar depois.
          </p>
        </>
      )}
    </div>
  );
}
