// A pasta que chega por LINK, no topo da aba Documentos (card #434).
//
// Decisão da Naira (2026-10-18): o parceiro que não anexa nada manda um link do
// OneDrive (ou de um Google de outra conta) com a pasta do cliente. O link
// passa a viver no caso — o parceiro cola o dele no portal, a equipe cola o que
// recebeu por WhatsApp, e quem organiza acha sem procurar na conversa.
//
// Não há integração com a Microsoft: quem organiza baixa de lá e sobe aqui. O
// link é atalho, não sincronização.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ExternalLink,
  FolderOpen,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import {
  lerPastasDoCaso,
  normalizarLinkPasta,
  provedorDaPasta,
  ROTULO_DO_LINK,
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
  // Ids sendo conferidos agora (o parceiro pode ter esquecido de compartilhar).
  const [conferindo, setConferindo] = useState<Set<string>>(new Set());

  const ehParceiro = usuario?.tipo === "parceiro";
  const podeMexer = podeEscrever("caso_pastas_externas");
  // O parceiro só mexe no link que ELE colou — é o que a policy aceita. Sem
  // isto a tela ofereceria o lápis e o banco recusaria na hora de salvar.
  const mexeNesta = (p: PastaExterna) =>
    podeMexer && (!ehParceiro || p.criado_por === usuario?.id);

  // A tela ainda está montada? A conferência do link leva até 8s, e a pessoa
  // pode ter saído da aba no meio — sem isto, o fim dela mexia em estado de
  // componente que já não existe e disparava uma leitura à toa.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const carregar = useCallback(() => {
    lerPastasDoCaso(casoId)
      .then((linhas) => {
        if (!montado.current) return;
        setErro(null);
        setPastas(linhas);
      })
      .catch((e: Error) => {
        if (!montado.current) return;
        // Erro de leitura não é "não tem pasta": dizer que não tem manda a
        // pessoa procurar o link no WhatsApp de novo.
        console.error(e);
        setErro(e.message);
      });
  }, [casoId]);

  useEffect(() => carregar(), [carregar]);

  async function salvar(bruto: string, rotulo: string, alvo: PastaExterna | "nova") {
    const url = normalizarLinkPasta(bruto);
    if (!url) {
      toast.error("Cole o endereço completo da pasta (começando com https://).");
      return false;
    }
    // Link trocado nasce sem checagem e o autor é quem está logado — as duas
    // coisas o BANCO garante (gatilho `_pasta_externa_antes`), não esta tela.
    const campos = { url, rotulo: rotulo.trim() || null };
    const resp =
      alvo === "nova"
        ? await supabase
            .from("caso_pastas_externas")
            .insert({ caso_id: casoId, ...campos })
            .select("id")
            .single()
        : await supabase
            .from("caso_pastas_externas")
            .update(campos)
            .eq("id", alvo.id)
            .select("id")
            .single();
    if (resp.error) {
      const dup = resp.error.code === "23505";
      toast.error(dup ? "Esse link já está neste caso." : "Não consegui salvar o link.");
      console.error(resp.error);
      return false;
    }
    toast.success(alvo === "nova" ? "Link da pasta salvo." : "Link atualizado.");
    setEditando(null);
    onChange?.();
    // Conferir na hora é o ponto do pedido (Naira, 20/10): quem colou está na
    // tela e ainda pode arrumar o compartilhamento. A conferência recarrega a
    // lista no fim; até lá, recarrega já para o link aparecer.
    carregar();
    if (resp.data?.id) void conferir(resp.data.id as string);
    return true;
  }

  /**
   * Pede ao servidor para abrir o link sem credencial. Quem GRAVA o que viu é
   * a function (a tela não grava mais: o banco recusa veredito vindo de
   * pessoa). Nunca estoura a tela: não conseguir conferir é um resultado.
   */
  async function conferir(id: string) {
    setConferindo((atual) => new Set(atual).add(id));
    try {
      const { data, error } = await supabase.functions.invoke("checar-link-pasta", {
        body: { pasta_id: id },
      });
      if (error) {
        console.error("checar-link-pasta:", await mensagemDeErroEdge(error, "falhou"));
        if (montado.current) toast.error("Não consegui conferir o link agora.");
      } else if (data?.status === "fechado" && montado.current) {
        toast.warning("O link pede login — peça ao parceiro para compartilhar a pasta.");
      }
    } finally {
      if (montado.current) {
        setConferindo((atual) => {
          const novo = new Set(atual);
          novo.delete(id);
          return novo;
        });
        carregar();
      }
    }
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
                <LinkDaPasta pasta={p} conferindo={conferindo.has(p.id)} mostrarEndereco>
                  {mexeNesta(p) && !conferindo.has(p.id) && (
                    <button
                      type="button"
                      onClick={() => conferir(p.id)}
                      className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                      conferir
                    </button>
                  )}
                </LinkDaPasta>
              </div>
              {/* Lápis some durante a conferência: trocar o link no meio dela
                  é o que deixava o veredito do endereço velho no novo. */}
              {mexeNesta(p) && !conferindo.has(p.id) && (
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

/**
 * O link de uma pasta e o que a última checagem viu — a aba Documentos e a
 * tarefa de organizar mostram por aqui (antes a tarefa tinha a própria cópia,
 * sem o selo de compartilhamento).
 */
export function LinkDaPasta({
  pasta,
  conferindo = false,
  mostrarEndereco = false,
  children,
}: {
  pasta: PastaExterna;
  conferindo?: boolean;
  mostrarEndereco?: boolean;
  /** Ação ao lado do selo (o "conferir" da aba Documentos). */
  children?: ReactNode;
}) {
  return (
    <>
      <a
        href={pasta.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-sm font-medium hover:underline"
      >
        {pasta.rotulo?.trim() || `Pasta no ${provedorDaPasta(pasta.url)}`}
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
      {mostrarEndereco && <p className="truncate text-[11px] text-muted-foreground">{pasta.url}</p>}
      {/* O que a última checagem viu ao tentar abrir sem login. */}
      <p className="mt-0.5 flex items-center gap-1">
        {conferindo ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> conferindo o compartilhamento…
          </span>
        ) : pasta.checado_status ? (
          <span
            className={"rounded px-1 text-[10px] " + ROTULO_DO_LINK[pasta.checado_status].tom}
            title={pasta.checado_detalhe ?? undefined}
            data-link-checagem={pasta.checado_status}
          >
            {ROTULO_DO_LINK[pasta.checado_status].texto}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">sem conferência</span>
        )}
        {children}
      </p>
    </>
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
