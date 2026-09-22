// Configuracoes -> Escritorio (admin): a marca do escritorio — nome de
// exibicao, logo e cor. O logo vai pro bucket publico `marcas`
// (<escritorio_id>/logo.<ext>; a policy so deixa quem configura o escritorio
// gravar no caminho dele) e a URL publica e gravada pela RPC
// escritorio_definir_marca. Depois de salvar, os vinculos sao relidos e o
// topo muda na hora.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { iniciaisDe } from "@/lib/marca-escritorio";

const TIPOS = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_BYTES = 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp" };

export function EscritorioMarcaCard() {
  const { escritorio, pode, recarregarVinculos } = useAuth();
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNome(escritorio?.marca?.nome_exibicao ?? "");
    setCor(escritorio?.marca?.cor ?? "");
  }, [escritorio?.escritorio_id, escritorio?.marca?.nome_exibicao, escritorio?.marca?.cor]);

  if (!escritorio || !pode("escritorio:configurar")) return null;
  const logo = escritorio.marca?.logo_url || null;
  const nomeAtual = escritorio.marca?.nome_exibicao || escritorio.escritorio_nome;

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.rpc("escritorio_definir_marca", {
      p_nome_exibicao: nome.trim() || escritorio!.escritorio_nome,
      p_cor: cor.trim() === "" ? "" : cor.trim(),
    });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Marca do escritório salva.");
    await recarregarVinculos();
  }

  async function enviarLogo(file: File) {
    if (!TIPOS.includes(file.type)) return toast.error("Use PNG, JPG, SVG ou WebP.");
    if (file.size > MAX_BYTES) return toast.error("O logo precisa ter até 1 MB.");
    setEnviandoLogo(true);
    try {
      const path = `${escritorio!.escritorio_id}/logo.${EXT[file.type]}`;
      const { error: eUp } = await supabase.storage.from("marcas").upload(path, file, { upsert: true, contentType: file.type, cacheControl: "60" });
      if (eUp) throw new Error(eUp.message);
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/marcas/${path}?v=${Date.now()}`;
      const { error } = await supabase.rpc("escritorio_definir_marca", { p_logo_url: url });
      if (error) throw new Error(error.message);
      toast.success("Logo atualizado.");
      await recarregarVinculos();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviandoLogo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function removerLogo() {
    setEnviandoLogo(true);
    const { error } = await supabase.rpc("escritorio_definir_marca", { p_limpar_logo: true });
    setEnviandoLogo(false);
    if (error) return toast.error(error.message);
    toast.success("Logo removido; o nome passa a aparecer no lugar.");
    await recarregarVinculos();
  }

  return (
    <Card data-card-marca>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Marca do escritório
        </CardTitle>
        <CardDescription>
          O que aparece no topo do sistema, nos e-mails e nas mensagens deste escritório. Antes do login e no rodapé
          fica a marca do produto (Legal Connect).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 p-4" data-previa-marca>
          {logo ? (
            <img src={logo} alt={nomeAtual} className="max-h-16 max-w-[220px] object-contain" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md text-sm font-bold text-white" style={{ background: cor || "#b8862e" }}>
              {iniciaisDe(nomeAtual)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-serif text-lg font-semibold" style={cor ? { color: cor } : undefined}>{nomeAtual}</div>
            <div className="text-xs text-muted-foreground">Prévia de como o escritório aparece no topo.</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div>
            <Label htmlFor="marca-nome">Nome de exibição</Label>
            <Input id="marca-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={escritorio.escritorio_nome} maxLength={80} />
          </div>
          <div>
            <Label htmlFor="marca-cor">Cor de destaque (opcional)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Escolher cor"
                value={/^#[0-9a-fA-F]{6}$/.test(cor) ? cor : "#b8862e"}
                onChange={(e) => setCor(e.target.value)}
                className="h-9 w-10 cursor-pointer rounded border bg-background p-0.5"
              />
              <Input id="marca-cor" value={cor} onChange={(e) => setCor(e.target.value)} placeholder="#RRGGBB" className="font-mono" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label>Logo</Label>
          <p className="text-xs text-muted-foreground">PNG, JPG, SVG ou WebP, até 1 MB. Fica público (aparece nos e-mails).</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={arquivoRef}
              type="file"
              accept={TIPOS.join(",")}
              className="hidden"
              aria-label="Arquivo do logo"
              data-input-logo
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void enviarLogo(f);
              }}
            />
            <Button variant="outline" onClick={() => arquivoRef.current?.click()} disabled={enviandoLogo}>
              {enviandoLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              {logo ? "Trocar logo" : "Enviar logo"}
            </Button>
            {logo && (
              <Button variant="ghost" className="text-red-700" onClick={removerLogo} disabled={enviandoLogo}>
                <Trash2 className="mr-2 h-4 w-4" />
                Remover logo
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
