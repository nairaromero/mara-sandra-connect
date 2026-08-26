// Lista de arquivos do cumprimento de solicitação — compartilhada entre a aba
// Documentos do caso e o hub /documentos (modais gêmeos). Cada arquivo tem o
// próprio TIPO (dropdown igual ao do upload da aba) e nome editável; trocar o
// tipo recalcula o nome padrão (pedido da Naira, 2026-08-26 — solicitação
// "outro" deixava tudo como "Outro.pdf").

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocTypeCombobox } from "@/components/doc-type-combobox";
import { TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { MAX_FILE_SIZE_MB } from "@/lib/upload-limits";
import {
  nomePadraoUnico,
  type ArquivoCumprimento,
} from "@/lib/documentos/cumprimento";

interface Props {
  /** Tipos pedidos na solicitação, na ordem — viram o default de cada
   * arquivo novo (1º arquivo = 1º documento pedido, e assim por diante). */
  tiposSolicitacao: string[];
  arquivos: ArquivoCumprimento[];
  onChange: (arquivos: ArquivoCumprimento[]) => void;
  obrigatorio?: boolean;
}

export function ArquivosCumprimento({
  tiposSolicitacao,
  arquivos,
  onChange,
  obrigatorio = false,
}: Props) {
  function adicionar(files: File[]) {
    const novos = [...arquivos];
    for (const f of files) {
      const tipoDefault =
        tiposSolicitacao[Math.min(novos.length, tiposSolicitacao.length - 1)] ??
        "outro";
      novos.push({
        file: f,
        tipo: tipoDefault,
        nome: nomePadraoUnico(tipoDefault, f, novos.map((x) => x.nome)),
      });
    }
    onChange(novos);
  }

  function trocarTipo(i: number, tipo: string) {
    onChange(
      arquivos.map((a, j) =>
        j === i
          ? {
              ...a,
              tipo,
              // Nome recalculado pro tipo novo, único frente aos demais.
              nome: nomePadraoUnico(
                tipo,
                a.file,
                arquivos.filter((_, k) => k !== i).map((x) => x.nome),
              ),
            }
          : a,
      ),
    );
  }

  return (
    <div>
      <Label className="text-xs">Arquivos {obrigatorio && "(pelo menos um)"}</Label>
      <input
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) adicionar(files);
          // Limpa o input: permite adicionar mais arquivos depois.
          e.target.value = "";
        }}
        className="block w-full text-sm border rounded-md p-2"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
      />
      <p className="text-xs text-muted-foreground mt-1">
        Pode escolher vários de uma vez (ou adicionar aos poucos). Tamanho
        máximo: {MAX_FILE_SIZE_MB} MB por arquivo.
      </p>
      {arquivos.length > 0 && (
        <div className="mt-2 space-y-3">
          <Label className="text-xs">
            Tipo e nome de cada arquivo — mantenha a extensão (.pdf, .jpg, etc.)
          </Label>
          {arquivos.map((a, i) => (
            <div key={i} className="rounded-md border p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <DocTypeCombobox
                    options={TIPOS_DOCUMENTO_OPTIONS}
                    value={a.tipo}
                    onChange={(t) => trocarTipo(i, t)}
                    placeholder="Tipo do documento..."
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(arquivos.filter((_, j) => j !== i))}
                  title="Remover arquivo"
                  aria-label={"Remover arquivo " + (i + 1)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Input
                value={a.nome}
                onChange={(e) =>
                  onChange(
                    arquivos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)),
                  )
                }
                placeholder="Ex: RG_e_CPF_Joao.pdf"
                className="text-sm"
                aria-label={"Nome do arquivo " + (i + 1)}
              />
              <p className="text-xs text-muted-foreground truncate">{a.file.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
