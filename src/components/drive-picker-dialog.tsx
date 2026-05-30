// =============================================================================
// DrivePickerDialog - reusable modal that opens Google Drive Picker, lets the
// user preview/edit the selected files (checkbox + tipo dropdown via heuristic),
// and on confirm returns the files ready to be uploaded.
//
// Padrao de uso:
//   const [aberto, setAberto] = useState(false);
//
//   <DrivePickerDialog
//     aberto={aberto}
//     onOpenChange={setAberto}
//     tiposDocumento={TIPOS_DOC_OPTIONS}
//     onConfirmar={async (arquivos) => {
//       // arquivos: Array<{ file: File, tipo: string, tipoPersonalizado: string }>
//       // faz upload dos arquivos pro Supabase Storage, cria registros em documentos, etc.
//     }}
//   />
// =============================================================================

import { useEffect, useState } from "react";
import { Loader2, FileDown, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import {
  downloadDriveFile,
  nomeDownloadFinal,
  type DrivePickedFile,
} from "@/lib/google-drive";
import { inferirTipoPorNome } from "@/lib/doc-type-inference";
import { validateFileSize, MAX_FILE_SIZE_MB } from "@/lib/upload-limits";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DocTypeCombobox,
  type DocTypeOption,
} from "@/components/doc-type-combobox";

/** Estrutura entregue ao onConfirmar - 1 item por arquivo escolhido. */
export interface DriveImportedFile {
  file: File;
  tipo: string;
  tipoPersonalizado: string;
  /** ID do arquivo no Drive - permite dedupe em syncs futuros. */
  gdriveFileId: string;
}

interface DrivePickerDialogProps {
  /**
   * Arquivos ja selecionados no Picker pelo parent component.
   * Quando null, dialog fica fechado. Quando array nao-vazio, dialog abre
   * mostrando preview/tipo pra cada arquivo.
   */
  arquivosSelecionados: Array<DrivePickedFile> | null;
  accessToken: string;
  onFechar: () => void;
  tiposDocumento: Array<DocTypeOption>;
  /**
   * Chamada quando o usuario clica em "Importar N arquivos". O componente
   * desabilita os controles e mostra spinner ate a promise resolver.
   * Em erro, o dialog fica aberto pro usuario tentar de novo.
   */
  onConfirmar: (arquivos: Array<DriveImportedFile>) => Promise<void>;
}

interface Item {
  drive: DrivePickedFile;
  selecionado: boolean;
  tipo: string;
  tipoPersonalizado: string;
  baixando: boolean;
  erro: string | null;
  /** File ja baixado, pronto pra ser entregue ao onConfirmar */
  arquivoBaixado: File | null;
}

function formatBytes(n: number): string {
  if (n <= 0) return "?";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function DrivePickerDialog(props: DrivePickerDialogProps) {
  const { arquivosSelecionados, accessToken, onFechar, tiposDocumento, onConfirmar } =
    props;

  // Dialog aberto quando ha arquivos selecionados
  const aberto = arquivosSelecionados !== null && arquivosSelecionados.length > 0;

  const [itens, setItens] = useState<Array<Item>>([]);
  const [importando, setImportando] = useState(false);

  // Quando os arquivos selecionados mudam, reinicia o estado da preview
  // com tipos inferidos por nome.
  useEffect(() => {
    if (arquivosSelecionados && arquivosSelecionados.length > 0) {
      const items: Array<Item> = arquivosSelecionados.map((f) => ({
        drive: f,
        selecionado: true,
        tipo: inferirTipoPorNome(f.name),
        tipoPersonalizado: "",
        baixando: false,
        erro: null,
        arquivoBaixado: null,
      }));
      setItens(items);
      setImportando(false);
    } else {
      setItens([]);
      setImportando(false);
    }
  }, [arquivosSelecionados]);

  function toggleSelecionado(i: number) {
    setItens((prev) =>
      prev.map((it, idx) =>
        idx === i ? { ...it, selecionado: !it.selecionado } : it,
      ),
    );
  }

  function atualizarTipo(i: number, novoTipo: string) {
    setItens((prev) =>
      prev.map((it, idx) =>
        idx === i
          ? { ...it, tipo: novoTipo, tipoPersonalizado: novoTipo === "outro" ? it.tipoPersonalizado : "" }
          : it,
      ),
    );
  }

  function atualizarTipoPersonalizado(i: number, texto: string) {
    setItens((prev) =>
      prev.map((it, idx) =>
        idx === i ? { ...it, tipoPersonalizado: texto } : it,
      ),
    );
  }

  const selecionados = itens.filter((it) => it.selecionado);

  // Valida que todos os selecionados tem tipo, e tipo='outro' tem rotulo livre.
  const todosValidos =
    selecionados.length > 0 &&
    selecionados.every(
      (it) =>
        it.tipo &&
        (it.tipo !== "outro" || it.tipoPersonalizado.trim().length > 0),
    );

  async function handleImportar() {
    if (!todosValidos) {
      toast.error("Cada arquivo precisa de um tipo. 'Outro' precisa rotulo.");
      return;
    }
    setImportando(true);
    try {
      // 1) Baixa cada arquivo selecionado do Drive em sequencia
      const baixados: Array<Item> = [];
      for (let i = 0; i < itens.length; i++) {
        if (!itens[i].selecionado) {
          baixados.push(itens[i]);
          continue;
        }
        setItens((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, baixando: true, erro: null } : it,
          ),
        );
        try {
          const blob = await downloadDriveFile(itens[i].drive, accessToken);
          // Cria File a partir do blob (preservando nome ajustado pra Google Docs)
          const nomeFinal = nomeDownloadFinal(itens[i].drive);
          const file = new File([blob], nomeFinal, { type: blob.type });
          // Valida tamanho local antes de subir
          const erroTam = validateFileSize(file);
          if (erroTam) {
            setItens((prev) =>
              prev.map((it, idx) =>
                idx === i
                  ? { ...it, baixando: false, erro: erroTam }
                  : it,
              ),
            );
            baixados.push({ ...itens[i], erro: erroTam });
            continue;
          }
          const novoItem: Item = {
            ...itens[i],
            baixando: false,
            erro: null,
            arquivoBaixado: file,
          };
          setItens((prev) =>
            prev.map((it, idx) => (idx === i ? novoItem : it)),
          );
          baixados.push(novoItem);
        } catch (err) {
          const msg = (err as { message?: string })?.message ||
            "Falha ao baixar do Drive";
          setItens((prev) =>
            prev.map((it, idx) =>
              idx === i ? { ...it, baixando: false, erro: msg } : it,
            ),
          );
          baixados.push({ ...itens[i], erro: msg });
        }
      }

      // 2) Filtra apenas os que baixaram OK e estavam selecionados
      const okParaImportar: Array<DriveImportedFile> = baixados
        .filter(
          (it) => it.selecionado && it.arquivoBaixado && !it.erro,
        )
        .map((it) => ({
          file: it.arquivoBaixado as File,
          tipo: it.tipo,
          tipoPersonalizado: it.tipoPersonalizado,
          gdriveFileId: it.drive.id,
        }));

      if (okParaImportar.length === 0) {
        toast.error("Nenhum arquivo foi baixado com sucesso.");
        return;
      }

      // 3) Entrega pra logica do consumer (upload pro Storage + insert)
      await onConfirmar(okParaImportar);

      const falhas = baixados.filter((it) => it.selecionado && it.erro).length;
      if (falhas === 0) {
        toast.success(okParaImportar.length + " documento(s) importado(s) do Drive.");
        onFechar();
      } else {
        toast.warning(
          okParaImportar.length + " importado(s), " + falhas + " falharam (ver lista).",
        );
        // Mantem dialog aberto pro usuario ver os erros
      }
    } catch (err) {
      console.error(err);
      const msg = (err as { message?: string })?.message ||
        "Erro ao importar do Drive";
      toast.error(msg);
    } finally {
      setImportando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        // Bloqueia fechar enquanto importando (upload em andamento).
        if (importando) return;
        if (!o) onFechar();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        onPointerDownOutside={(e) => {
          if (importando) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (importando) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (importando) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Importar do Google Drive</DialogTitle>
          <DialogDescription>
            Revise os arquivos selecionados, ajuste o tipo se necessario, e
            clique em Importar. Tamanho maximo: {MAX_FILE_SIZE_MB} MB por arquivo.
          </DialogDescription>
        </DialogHeader>

        {itens.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {selecionados.length} de {itens.length} selecionado(s)
            </p>
            <ul className="space-y-2">
              {itens.map((it, i) => (
                <li
                  key={it.drive.id}
                  className={
                    "border rounded-md p-3 space-y-2 " +
                    (it.selecionado ? "bg-background" : "bg-muted/30 opacity-60")
                  }
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={it.selecionado}
                      onChange={() => toggleSelecionado(i)}
                      disabled={importando}
                      className="h-4 w-4 mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {it.drive.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {it.drive.mimeType}
                        {it.drive.sizeBytes > 0 &&
                          " - " + formatBytes(it.drive.sizeBytes)}
                      </p>
                      {it.erro && (
                        <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                          <AlertCircle className="h-3 w-3" />
                          {it.erro}
                        </p>
                      )}
                    </div>
                    {it.baixando && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {it.selecionado && (
                    <div className="ml-6 space-y-2">
                      <DocTypeCombobox
                        options={tiposDocumento}
                        value={it.tipo}
                        onChange={(v) => atualizarTipo(i, v)}
                        disabled={importando}
                        placeholder="Escolha o tipo"
                      />
                      {it.tipo === "outro" && (
                        <Input
                          placeholder="Nome livre do documento"
                          value={it.tipoPersonalizado}
                          onChange={(e) =>
                            atualizarTipoPersonalizado(i, e.target.value)
                          }
                          disabled={importando}
                        />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onFechar()}
            disabled={importando}
          >
            <X className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
          <Button
            onClick={handleImportar}
            disabled={importando || !todosValidos || itens.length === 0}
          >
            {importando ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Importar {selecionados.length} arquivo
            {selecionados.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
