// Ver um documento sem baixar — um lugar só (pedido da Naira, 2026-10-19:
// o mesmo olho que existe na aba Documentos passou a ser preciso dentro da
// conferência da tarefa, para escolher o tipo certo sem abrir o arquivo).
//
// Tudo o que importa mora aqui, porque é o tipo de coisa que, copiada, perde
// um pedaço na cópia:
//   · URL assinada de 5 minutos, e NUNCA a URL do storage direto no iframe:
//     cross-origin + Content-Disposition viram download forçado, e o
//     visualizador de PDF do Chrome não renderiza dentro do sandbox. Por isso
//     o arquivo é baixado e vira `blob:` same-origin;
//   · o acesso vai para a trilha (LGPD art. 37) por `log_acesso_documento`;
//   · marca d'água com quem está vendo, e clique-direito/arrastar bloqueados —
//     é o que segura o parceiro, que não pode baixar;
//   · o que não abre no navegador (DOCX, XLSX, ZIP…) avisa em vez de abrir um
//     iframe que baixaria o arquivo por fora do bloqueio.

import { useAuth } from "@/hooks/use-auth";
import { formatarBR } from "@/lib/fuso";
import { ehImagemDoc } from "@/lib/documentos/arquivo";
import type { Visualizacao } from "@/hooks/use-visualizador-documento";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function VisualizadorDocumento({
  aberto,
  onFechar,
}: {
  aberto: Visualizacao | null;
  onFechar: () => void;
}) {
  const { usuario } = useAuth();
  const nome = aberto?.doc.nome_arquivo ?? "";

  return (
    <Dialog
      open={aberto !== null}
      onOpenChange={(o) => {
        if (!o) onFechar();
      }}
    >
      <DialogContent
        className="max-w-4xl max-h-[95vh] overflow-hidden p-0"
        onContextMenu={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-base">{nome}</DialogTitle>
          <DialogDescription className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2 mt-1">
            <strong>Documento confidencial.</strong> Captura de tela, gravação ou compartilhamento
            configura responsabilidade legal. Acesso registrado para auditoria.
          </DialogDescription>
        </DialogHeader>
        {aberto && (
          <div
            className="relative bg-muted/30 select-none"
            style={{ height: "75vh" }}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
          >
            {ehImagemDoc(nome) ? (
              <img
                src={aberto.url}
                alt={nome}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                className="w-full h-full object-contain pointer-events-none"
              />
            ) : (
              // Sem sandbox: o visualizador de PDF do Chrome precisa rodar
              // scripts para renderizar. Como a URL é blob: same-origin
              // (gerada por nós no client), o risco é baixo.
              <iframe
                src={aberto.url + "#toolbar=0&navpanes=0&scrollbar=1"}
                title={nome}
                className="w-full h-full"
              />
            )}
            {/* Marca d'água com quem está vendo */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center overflow-hidden">
              <div
                className="font-bold text-gray-400/30 -rotate-12 text-center whitespace-pre-line leading-tight"
                style={{ fontSize: "2rem" }}
              >
                {usuario?.nome || "Confidencial"}
                {"\n"}
                {usuario?.email || ""}
                {"\n"}
                {formatarBR(new Date(), { dateStyle: "short", timeStyle: "medium" })}
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" size="sm" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
