import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, UploadCloud, CheckCircle2, AlertTriangle } from "lucide-react";

import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";

// Pagina PUBLICA de upload por link. A IA (preparar_upload_documento) gera um
// link tipo /upload?u=<signedUrl>&n=<nome>. Quem tem o link (advogado ou
// cliente) escolhe o arquivo e ele vai DIRETO para o Storage (PUT na URL
// assinada) - nao passa pela IA nem pelo nosso backend.
export const Route = createFileRoute("/upload")({
  validateSearch: (s: Record<string, unknown>): { u?: string; n?: string } => {
    const out: { u?: string; n?: string } = {};
    if (typeof s.u === "string") out.u = s.u;
    if (typeof s.n === "string") out.n = s.n;
    return out;
  },
  component: UploadPage,
});

function UploadPage() {
  const { u, n } = Route.useSearch();
  const [file, setFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (!u || !file) return;
    setEnviando(true);
    setErro(null);
    try {
      const resp = await fetch(u, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error("Falha no envio (" + resp.status + "): " + t.slice(0, 200));
      }
      setOk(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao enviar o arquivo");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ClientOnly fallback={null}>
      <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-[var(--gold)]" />
            <h1 className="text-lg font-semibold">Enviar documento</h1>
          </div>

          {!u && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> Link invalido ou incompleto.
            </p>
          )}

          {u && ok && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="font-medium">Documento enviado com sucesso!</p>
              <p className="text-sm text-muted-foreground">Pode fechar esta pagina.</p>
            </div>
          )}

          {u && !ok && (
            <div className="space-y-4">
              {n && (
                <p className="text-sm text-muted-foreground">
                  Documento solicitado: <span className="font-medium text-foreground">{n}</span>
                </p>
              )}
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground hover:file:opacity-90"
              />
              {erro && (
                <p className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {erro}
                </p>
              )}
              <Button className="w-full" onClick={enviar} disabled={!file || enviando}>
                {enviando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="mr-2 h-4 w-4" />
                )}
                Enviar
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                O arquivo vai direto e seguro para o sistema. O link expira em ~2h.
              </p>
            </div>
          )}
        </div>
      </div>
    </ClientOnly>
  );
}
