// Abrir um documento para ver na tela, sem baixar — a parte de dados do
// visualizador (src/components/documentos/visualizador-documento.tsx).
//
// Mora aqui o que, copiado, perderia um pedaço na cópia:
//   · URL assinada de 5 minutos, e NUNCA a URL do storage direto no iframe:
//     cross-origin + Content-Disposition viram download forçado, e o
//     visualizador de PDF do Chrome não renderiza dentro do sandbox. Por isso
//     o arquivo é baixado e vira `blob:` same-origin;
//   · o acesso vai para a trilha (LGPD art. 37) por `log_acesso_documento`;
//   · o que não abre no navegador (DOCX, XLSX, ZIP…) avisa em vez de abrir um
//     iframe que baixaria o arquivo por fora do bloqueio do parceiro.

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { abreNoNavegador, rotuloDaExtensao } from "@/lib/documentos/arquivo";

/** O mínimo que o visualizador precisa de um documento. */
export interface DocumentoVisualizavel {
  id: string;
  nome_arquivo: string | null;
  storage_path: string;
}

export interface Visualizacao {
  doc: DocumentoVisualizavel;
  url: string;
}

/**
 * Abre e fecha a visualização. Quem usa renderiza `<VisualizadorDocumento>`
 * com o que `aberto` devolver.
 */
export function useVisualizadorDocumento() {
  const [aberto, setAberto] = useState<Visualizacao | null>(null);
  const [carregando, setCarregando] = useState(false);

  const fechar = useCallback(() => {
    setAberto((atual) => {
      // Libera a memória do blob: criado em `abrir`.
      if (atual?.url.startsWith("blob:")) URL.revokeObjectURL(atual.url);
      return null;
    });
  }, []);

  const abrir = useCallback(async (d: DocumentoVisualizavel) => {
    if (!abreNoNavegador(d.nome_arquivo)) {
      toast.error(
        `Visualização disponível apenas para PDF e imagens. Este arquivo (${rotuloDaExtensao(
          d.nome_arquivo,
        )}) precisa ser baixado para abrir.`,
      );
      return;
    }
    setCarregando(true);
    try {
      const resp = await supabase.storage.from("documentos").createSignedUrl(d.storage_path, 300);
      if (resp.error) throw resp.error;
      const assinada = resp.data?.signedUrl;
      if (!assinada) throw new Error("Não foi possível gerar link de visualização");

      // Trilha de acesso (LGPD art. 37) — não segura a abertura.
      supabase
        .rpc("log_acesso_documento", { p_documento_id: d.id, p_acao: "visualizacao" })
        .then(undefined, () => {});

      const arquivo = await fetch(assinada);
      if (!arquivo.ok) throw new Error("Erro ao baixar arquivo para visualização");
      setAberto({ doc: d, url: URL.createObjectURL(await arquivo.blob()) });
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string })?.message || "Erro ao abrir o documento");
    } finally {
      setCarregando(false);
    }
  }, []);

  /**
   * O que não abre na tela (DOCX, XLSX, ZIP…) ainda precisa ser visto: abre o
   * arquivo em outra aba já como download, pela mesma URL assinada e com o
   * mesmo registro na trilha.
   */
  const baixar = useCallback(async (d: DocumentoVisualizavel) => {
    setCarregando(true);
    try {
      const { data, error } = await supabase.storage
        .from("documentos")
        .createSignedUrl(d.storage_path, 60, { download: d.nome_arquivo ?? true });
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("Não foi possível gerar o link do arquivo");
      supabase
        .rpc("log_acesso_documento", { p_documento_id: d.id, p_acao: "download" })
        .then(undefined, () => {});
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string })?.message || "Erro ao baixar o documento");
    } finally {
      setCarregando(false);
    }
  }, []);

  return { aberto, carregando, abrir, baixar, fechar };
}
