// A pasta que chega por LINK, no topo da aba Documentos (card #434).
//
// Decisão da Naira (2026-10-18): o parceiro que não anexa nada manda um link do
// OneDrive (ou de um Google de outra conta) com a pasta do cliente. O link
// passa a viver no caso — o parceiro cola o dele no portal, a equipe cola o que
// recebeu por WhatsApp, e quem organiza acha sem procurar na conversa.
//
// Não há integração com a Microsoft: quem organiza baixa de lá e sobe aqui. O
// link é atalho, não sincronização.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, FolderOpen, Link2, Loader2, Pencil, Plus, X } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { lerLista } from "@/lib/leitura";
import { useAuth } from "@/hooks/use-auth";
import {
  normalizarLinkPasta,
  provedorDaPasta,
  type PastaExterna,
} from "@/lib/documentos/pasta-externa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  casoId: string;
  /** Chamado depois de gravar: o andamento do caso nasce do gatilho. */
  onChange?: () => void;
}

export function PastasExternas({ casoId, onChange }: Props) {
  const { usuario, podeEscrever } = useAuth();
  const [pastas, setPastas] = useState<PastaExterna[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<PastaExterna | "nova" | null>(null);

  const ehParceiro = usuario?.tipo === "parceiro";
  const podeMexer = podeEscrever("caso_pastas_externas");
  // O parceiro só mexe no link que ELE colou — é o que a policy aceita. Sem
  // isto a tela ofereceria o lápis e o banco recusaria na hora de salvar.
  const mexeNesta = (p: PastaExterna) =>
    podeMexer && (!ehParceiro || p.criado_por === usuario?.id);

  const carregar = useCallback(() => {
    let vivo = true;
    lerLista<PastaExterna>(
      supabase
        .from("caso_pastas_externas")
        .select("id, caso_id, url, rotulo, criado_por, created_at, atualizado_em")
        .eq("caso_id", casoId)
        .order("created_at"),
      "pastas por link do caso",
    )
      .then((linhas) => {
        if (!vivo) return;
        setErro(null);
        setPastas(linhas);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        // Erro de leitura não é "não tem pasta": dizer que não tem manda a
        // pessoa procurar o link no WhatsApp de novo.
        console.error(e);
        setErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [casoId]);

  useEffect(() => carregar(), [carregar]);

  async function salvar(bruto: string, rotulo: string, alvo: PastaExterna | "nova") {
    const url = normalizarLinkPasta(bruto);
    if (!url) {
      toast.error("Cole o endereço completo da pasta (começando com https://).");
      return false;
    }
    const campos = { url, rotulo: rotulo.trim() || null };
    const resp =
      alvo === "nova"
        ? await supabase
            .from("caso_pastas_externas")
            .insert({ caso_id: casoId, ...campos, criado_por: usuario?.id ?? null })
        : await supabase.from("caso_pastas_externas").update(campos).eq("id", alvo.id);
    if (resp.error) {
      const dup = resp.error.code === "23505";
      toast.error(dup ? "Esse link já está neste caso." : "Não consegui salvar o link.");
      console.error(resp.error);
      return false;
    }
    toast.success(alvo === "nova" ? "Link da pasta salvo." : "Link atualizado.");
    setEditando(null);
    carregar();
    onChange?.();
    return true;
  }

  async function remover(pasta: PastaExterna) {
    if (!window.confirm("Tirar este link do caso? Os arquivos na pasta não são apagados.")) return;
    const { error } = await supabase.from("caso_pastas_externas").delete().eq("id", pasta.id);
    if (error) {
      toast.error("Não consegui tirar o link.");
      console.error(error);
      return;
    }
    carregar();
    onChange?.();
  }

  if (erro) {
    return (
      <p className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Não consegui ver se este caso tem pasta por link. Recarregue a página antes de concluir que
        não tem.
      </p>
    );
  }

  if (pastas === null) return null;

  // Sem nenhum link: um convite curto, no tom de quem está lendo a tela.
  if (pastas.length === 0) {
    if (!podeMexer) return null;
    if (editando === "nova") {
      return (
        <div className="rounded-md border p-3">
          <Formulario
            titulo="Link da pasta (OneDrive, Google Drive, Dropbox…)"
            onSalvar={(u, r) => salvar(u, r, "nova")}
            onCancelar={() => setEditando(null)}
          />
        </div>
      );
    }
    return (
      <Button
        size="sm"
        variant="outline"
        className="text-xs"
        onClick={() => setEditando("nova")}
      >
        <Link2 className="mr-2 h-3.5 w-3.5" />
        {ehParceiro
          ? "Tenho os documentos em uma pasta — colar o link"
          : "Adicionar link de pasta externa"}
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/5 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium">
        <FolderOpen className="h-3.5 w-3.5 text-[var(--gold)]" />
        {pastas.length === 1 ? "Pasta por link" : `Pastas por link (${pastas.length})`}
      </p>

      <ul className="space-y-2">
        {pastas.map((p) =>
          editando !== "nova" && editando?.id === p.id ? (
            <li key={p.id}>
              <Formulario
                titulo="Link da pasta"
                urlInicial={p.url}
                rotuloInicial={p.rotulo ?? ""}
                onSalvar={(u, r) => salvar(u, r, p)}
                onCancelar={() => setEditando(null)}
              />
            </li>
          ) : (
            <li key={p.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  {p.rotulo?.trim() || `Pasta no ${provedorDaPasta(p.url)}`}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <p className="truncate text-[11px] text-muted-foreground">{p.url}</p>
              </div>
              {mexeNesta(p) && (
                <div className="flex shrink-0 items-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    title="Editar link"
                    onClick={() => setEditando(p)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    title="Tirar link do caso"
                    onClick={() => remover(p)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </li>
          ),
        )}
      </ul>

      {/* Um link é o normal; mais de um acontece (pasta do cliente + processo
          antigo), então o segundo fica a um clique e sem destaque. */}
      {podeMexer && editando === "nova" && (
        <div className="mt-2 border-t pt-2">
          <Formulario
            titulo="Outro link"
            onSalvar={(u, r) => salvar(u, r, "nova")}
            onCancelar={() => setEditando(null)}
          />
        </div>
      )}
      {podeMexer && editando === null && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 h-6 px-1 text-[11px] text-muted-foreground"
          onClick={() => setEditando("nova")}
        >
          <Plus className="mr-1 h-3 w-3" />
          Outro link
        </Button>
      )}
    </div>
  );
}

function Formulario({
  titulo,
  urlInicial = "",
  rotuloInicial = "",
  onSalvar,
  onCancelar,
}: {
  titulo: string;
  urlInicial?: string;
  rotuloInicial?: string;
  onSalvar: (url: string, rotulo: string) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const [url, setUrl] = useState(urlInicial);
  const [rotulo, setRotulo] = useState(rotuloInicial);
  const [salvando, setSalvando] = useState(false);

  async function enviar() {
    if (salvando) return;
    setSalvando(true);
    try {
      await onSalvar(url, rotulo);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{titulo}</p>
      <Input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://1drv.ms/f/…"
        onKeyDown={(e) => {
          if (e.key === "Enter") void enviar();
          if (e.key === "Escape") onCancelar();
        }}
      />
      <Input
        value={rotulo}
        onChange={(e) => setRotulo(e.target.value)}
        placeholder="Como chamar esta pasta (opcional)"
        onKeyDown={(e) => {
          if (e.key === "Enter") void enviar();
          if (e.key === "Escape") onCancelar();
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={enviar} disabled={salvando || !url.trim()}>
          {salvando && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
