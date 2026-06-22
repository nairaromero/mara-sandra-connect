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

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  FileDown,
  X,
  AlertCircle,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
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
  /** Caminho relativo da subpasta (ex.: "Diversos"). Vazio = raiz. */
  pastaRelativa: string;
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
   * Nome da pasta raiz vinculada ao caso. Usado como label do grupo de
   * arquivos que estao "na raiz" da pasta (sem subpasta).
   */
  pastaRaizNome?: string | null;
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

/** Tira extensao (.pdf, .jpg, etc.) pra usar o nome cru como rotulo livre. */
function nomeSemExtensao(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return filename;
  const ext = filename.slice(idx + 1);
  // Só remove se parece extensao real (2-5 chars alfanumericos).
  if (/^[a-z0-9]{2,5}$/i.test(ext)) return filename.slice(0, idx);
  return filename;
}

/** URL deep-link pra abrir o arquivo no Drive (PDF, Google Doc, imagem, etc.). */
function urlDrive(fileId: string): string {
  return "https://drive.google.com/file/d/" + fileId + "/view";
}

export function DrivePickerDialog(props: DrivePickerDialogProps) {
  const { arquivosSelecionados, accessToken, onFechar, tiposDocumento, pastaRaizNome, onConfirmar } =
    props;

  // Dialog aberto quando ha arquivos selecionados
  const aberto = arquivosSelecionados !== null && arquivosSelecionados.length > 0;

  const [itens, setItens] = useState<Array<Item>>([]);
  const [importando, setImportando] = useState(false);
  // Pastas expandidas/recolhidas no preview. Default: raiz aberta.
  const [pastasExpandidas, setPastasExpandidas] = useState<Set<string>>(
    new Set([""]),
  );

  function togglePasta(pasta: string) {
    setPastasExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(pasta)) next.delete(pasta);
      else next.add(pasta);
      return next;
    });
  }

  function setSelecaoPasta(pasta: string, novo: boolean) {
    setItens((prev) =>
      prev.map((it) =>
        (it.drive.pastaRelativa ?? "") === pasta
          ? { ...it, selecionado: novo }
          : it,
      ),
    );
  }

  // Quando os arquivos selecionados mudam, reinicia o estado da preview
  // com tipos inferidos por nome.
  useEffect(() => {
    if (arquivosSelecionados && arquivosSelecionados.length > 0) {
      const items: Array<Item> = arquivosSelecionados.map((f) => {
        const tipoInferido = inferirTipoPorNome(f.name);
        return {
          drive: f,
          selecionado: true,
          tipo: tipoInferido,
          // Pra "outro", pre-preenche com o nome do arquivo (sem extensao)
          // pra evitar trabalho manual de nomear cada um. Usuario pode editar.
          tipoPersonalizado: tipoInferido === "outro" ? nomeSemExtensao(f.name) : "",
          baixando: false,
          erro: null,
          arquivoBaixado: null,
        };
      });
      setItens(items);
      // Expande todas as pastas vindas (raiz + subpastas) por default
      const pastas = new Set(items.map((i) => i.drive.pastaRelativa ?? ""));
      setPastasExpandidas(pastas);
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
      prev.map((it, idx) => {
        if (idx !== i) return it;
        // Mudou pra "outro" e ainda nao tem rotulo: pre-enche com filename.
        // Mudou pra outro tipo: limpa o rotulo livre (vai usar label do tipo).
        const novoPersonalizado =
          novoTipo === "outro"
            ? it.tipoPersonalizado || nomeSemExtensao(it.drive.name)
            : "";
        return { ...it, tipo: novoTipo, tipoPersonalizado: novoPersonalizado };
      }),
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

  // Agrupa por pasta relativa. Raiz aparece primeiro, depois subpastas em
  // ordem alfabetica.
  const grupos = useMemo(() => {
    const map = new Map<string, Array<{ item: Item; idx: number }>>();
    itens.forEach((item, idx) => {
      const key = item.drive.pastaRelativa ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ item, idx });
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "" && b !== "") return -1;
      if (b === "" && a !== "") return 1;
      return a.localeCompare(b);
    });
  }, [itens]);

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
      toast.error("Cada arquivo precisa de um tipo. 'Outro' precisa rótulo.");
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
          pastaRelativa: it.drive.pastaRelativa ?? "",
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
            Revise os arquivos selecionados, ajuste o tipo se necessário, e
            clique em Importar. Tamanho máximo: {MAX_FILE_SIZE_MB} MB por arquivo.
          </DialogDescription>
        </DialogHeader>

        {itens.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {selecionados.length} de {itens.length} selecionado(s)
              {grupos.length > 1 && " em " + grupos.length + " pasta(s)"}
            </p>
            {grupos.map(([pasta, entradas]) => {
              const expandida = pastasExpandidas.has(pasta);
              const selecionadosNaPasta = entradas.filter(
                (e) => e.item.selecionado,
              ).length;
              const todosSelecionados = selecionadosNaPasta === entradas.length;
              const labelPasta = pasta === ""
                ? (pastaRaizNome || "(raiz)")
                : pastaRaizNome
                  ? pastaRaizNome + "/" + pasta
                  : pasta;
              return (
                <div
                  key={pasta || "_root"}
                  className="border rounded-md overflow-hidden"
                >
                  {/* Header da pasta - clicar expande/recolhe */}
                  <button
                    type="button"
                    onClick={() => togglePasta(pasta)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 text-left"
                  >
                    {expandida ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {expandida ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-[var(--gold)]" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-[var(--gold)]" />
                    )}
                    <span className="text-sm font-medium truncate flex-1">
                      {labelPasta}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {selecionadosNaPasta}/{entradas.length}
                    </span>
                    {/* Checkbox de selecionar/desselecionar todos da pasta */}
                    <span
                      role="checkbox"
                      aria-checked={todosSelecionados}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelecaoPasta(pasta, !todosSelecionados);
                      }}
                      className={
                        "h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center " +
                        (todosSelecionados
                          ? "bg-primary border-primary text-primary-foreground"
                          : "bg-background border-input")
                      }
                      title={
                        todosSelecionados
                          ? "Desmarcar todos da pasta"
                          : "Marcar todos da pasta"
                      }
                    >
                      {todosSelecionados && (
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>

                  {/* Lista de arquivos da pasta */}
                  {expandida && (
                    <ul className="divide-y">
                      {entradas.map(({ item: it, idx: i }) => (
                        <li
                          key={it.drive.id}
                          className={
                            "p-3 space-y-2 " +
                            (it.selecionado ? "" : "bg-muted/30 opacity-60")
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
                            <a
                              href={urlDrive(it.drive.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0 mt-1"
                              title="Abrir no Google Drive (nova aba)"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Abrir</span>
                            </a>
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
                  )}
                </div>
              );
            })}
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
