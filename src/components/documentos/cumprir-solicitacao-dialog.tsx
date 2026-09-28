// Cumprir uma solicitação de documento a partir de QUALQUER tela (card #357,
// Naira 2026-09-18). Nasceu pra tarefa "Providenciar documentos": ela abria no
// nome de alguém da equipe, mas concluir a tarefa não fechava o pedido — dava
// documento no caso, tarefa feita e pedido pendente pra sempre.
//
// Mesma mecânica dos modais gêmeos da aba Documentos do caso e do hub
// /documentos (upload por src/lib/documentos/cumprimento.ts, vinculando cada
// arquivo à solicitação). Aqui o pedido é interno, então o anexo é obrigatório:
// cumprir sem documento é o buraco que estamos fechando.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import {
  rotuloSolicitacao,
  subirArquivosCumprimento,
  tiposDaSolicitacao,
  type ArquivoCumprimento,
  type ItemSolicitacao,
} from "@/lib/documentos/cumprimento";
import { validateFileSize } from "@/lib/upload-limits";
import { uploadDocumentoDriveSeNecessario } from "@/lib/google-drive";
import { ArquivosCumprimento } from "@/components/documentos/arquivos-cumprimento";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SolicitacaoCarregada {
  id: string;
  caso_id: string;
  tipo: string;
  tipos: ItemSolicitacao[] | null;
  descricao: string | null;
  status: string;
  documento_id: string | null;
  gdrive_folder_id: string | null;
}

export function CumprirSolicitacaoDialog(props: {
  /** null = fechado */
  solicitacaoId: string | null;
  onFechar: () => void;
  /** cumprida com sucesso — o caller recarrega o que mostra */
  onCumprida?: () => void;
}) {
  const { solicitacaoId, onFechar, onCumprida } = props;
  const { usuario } = useAuth();
  const [solic, setSolic] = useState<SolicitacaoCarregada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [arquivos, setArquivos] = useState<ArquivoCumprimento[]>([]);
  const [comentario, setComentario] = useState("");
  const [salvando, setSalvando] = useState(false);
  // O caller passa `onFechar` como arrow nova a cada render; com ela nas deps
  // do efeito, qualquer re-render do pai recarregava o pedido e LIMPAVA os
  // arquivos já escolhidos. A ref mantém a função atual sem virar dependência.
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  useEffect(() => {
    if (!solicitacaoId) {
      setSolic(null);
      return;
    }
    let vivo = true;
    setCarregando(true);
    setArquivos([]);
    setComentario("");
    supabase
      .from("solicitacoes_documento")
      .select("id, caso_id, tipo, tipos, descricao, status, documento_id, casos(gdrive_folder_id)")
      .eq("id", solicitacaoId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        setCarregando(false);
        if (error) {
          console.error("carregar solicitação:", error);
          toast.error("Não consegui abrir o pedido de documento");
          fecharRef.current();
          return;
        }
        if (!data) {
          toast.info("Este pedido não existe mais.");
          fecharRef.current();
          return;
        }
        // O join vem como objeto ou array conforme a tipagem gerada; normaliza.
        const casoJoin = data.casos as unknown as
          | { gdrive_folder_id: string | null }
          | Array<{ gdrive_folder_id: string | null }>
          | null;
        const caso = Array.isArray(casoJoin) ? (casoJoin[0] ?? null) : casoJoin;
        setSolic({
          id: data.id as string,
          caso_id: data.caso_id as string,
          tipo: data.tipo as string,
          tipos: (data.tipos ?? null) as SolicitacaoCarregada["tipos"],
          descricao: (data.descricao ?? null) as string | null,
          status: data.status as string,
          documento_id: (data.documento_id ?? null) as string | null,
          gdrive_folder_id: caso?.gdrive_folder_id ?? null,
        });
      });
    return () => {
      vivo = false;
    };
  }, [solicitacaoId]);

  const tiposPedidos = solic ? tiposDaSolicitacao(solic.tipo, solic.tipos) : [];
  const rotulo = solic ? rotuloSolicitacao(solic.tipo, solic.tipos) : "";
  const jaResolvida = !!solic && solic.status !== "pendente";

  async function cumprir() {
    if (!solic || !usuario) return;
    if (arquivos.length === 0) {
      toast.error("Anexe o documento", {
        description: "O pedido só se fecha com o documento que ele pedia.",
      });
      return;
    }
    for (const a of arquivos) {
      const erro = validateFileSize(a.file);
      if (erro) {
        toast.error(erro);
        return;
      }
    }
    setSalvando(true);
    try {
      // Corrida: alguém pode ter cumprido pelo hub enquanto este modal
      // estava aberto. Erro de leitura ≠ "está pendente" — só segue quando a
      // resposta chega de verdade.
      const atual = await supabase
        .from("solicitacoes_documento")
        .select("status")
        .eq("id", solic.id)
        .maybeSingle();
      if (atual.error) throw atual.error;
      if (!atual.data || atual.data.status !== "pendente") {
        toast.info("Este pedido já foi cumprido.");
        onCumprida?.();
        onFechar();
        return;
      }

      const r = await subirArquivosCumprimento({
        arquivos,
        casoId: solic.caso_id,
        solicitacaoId: solic.id,
        usuarioId: usuario.id,
        isInterno: usuario.tipo === "interno",
      });
      if (r.falhas.length > 0) {
        // Não fecha o pedido com arquivo faltando: os que subiram já estão
        // vinculados, os que falharam continuam na lista.
        setArquivos(r.falhas);
        toast.error(
          `${r.enviados} de ${r.enviados + r.falhas.length} arquivo(s) enviados — ` +
            "os que falharam continuam na lista, tente de novo.",
        );
        return;
      }

      // Espelho no Drive (mesma regra da aba do caso): só interno, e falha
      // aqui não desfaz nada — o app é a fonte de verdade.
      if (solic.gdrive_folder_id && usuario.tipo === "interno") {
        for (const criado of r.criados) {
          try {
            const gdriveId = await uploadDocumentoDriveSeNecessario(
              criado.file,
              criado.nome,
              solic.gdrive_folder_id,
            );
            if (gdriveId) {
              await supabase
                .from("documentos")
                .update({ gdrive_file_id: gdriveId })
                .eq("id", criado.docId);
            }
          } catch (err) {
            console.warn("[drive] falha ao espelhar no Drive:", err);
            toast.warning(
              "Documento salvo no app, mas falhou ao subir no Drive: " +
                ((err as { message?: string })?.message ?? "erro desconhecido"),
            );
          }
        }
      }

      const update: Record<string, unknown> = {
        status: "atendido",
        data_atendimento: new Date().toISOString(),
        comentario: comentario.trim() || null,
      };
      // documento_id (legado, 1:1) aponta pro primeiro arquivo.
      if (r.primeiroDocId && !solic.documento_id) update.documento_id = r.primeiroDocId;
      const resp = await supabase
        .from("solicitacoes_documento")
        .update(update)
        .eq("id", solic.id);
      if (resp.error) throw resp.error;

      // Badge de pendentes na sidebar sem esperar o poll. A tarefa
      // "Providenciar documentos" se conclui sozinha no banco
      // (_solicitacao_resolvida_fecha_providenciar).
      window.dispatchEvent(new Event("msc:solicitacoes-mudou"));
      toast.success(
        r.enviados > 1
          ? `Pedido cumprido — ${r.enviados} documentos anexados`
          : "Pedido cumprido — documento anexado",
      );
      onCumprida?.();
      onFechar();
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string })?.message || "Erro ao cumprir o pedido");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!solicitacaoId} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cumprir pedido de documento</DialogTitle>
          <DialogDescription>
            {rotulo || "Carregando…"}
          </DialogDescription>
        </DialogHeader>

        {carregando && (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 mr-2 inline animate-spin" />
            Abrindo o pedido…
          </p>
        )}

        {solic && jaResolvida && (
          <p className="text-sm text-muted-foreground">
            Este pedido já foi resolvido — não há o que anexar.
          </p>
        )}

        {solic && !jaResolvida && (
          <div className="space-y-3">
            {solic.descricao && (
              <div className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                {solic.descricao}
              </div>
            )}
            <ArquivosCumprimento
              tiposSolicitacao={tiposPedidos}
              arquivos={arquivos}
              onChange={setArquivos}
              obrigatorio
            />
            <div>
              <Label className="text-xs">Observação (opcional)</Label>
              <Textarea
                rows={3}
                placeholder="Ex.: veio só a primeira via, pedi a segunda ao cliente"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={cumprir} disabled={salvando || !solic || jaResolvida}>
            {salvando ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Anexar e cumprir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
