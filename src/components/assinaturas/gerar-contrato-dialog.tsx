// "Gerar contrato pelo ZapSign" (#522): escolher um modelo de contrato da conta
// do ZapSign do escritório, conferir os campos (já preenchidos com o cadastro
// do cliente) e enviar para assinatura — sem sair do caso.
//
// Dois passos no mesmo diálogo:
//   1. ESCOLHER — todos os modelos da conta, achados rápido: busca pelo nome,
//      os sugeridos para o tipo de benefício do caso no topo e o resto agrupado
//      pela pasta do ZapSign;
//   2. PREENCHER — os campos do modelo, o contato do cliente e o tipo com que o
//      PDF assinado entra nos documentos do caso.
// Quem escreve é a function `zapsign-enviar`; daqui em diante o fluxo é o mesmo
// do envio de um arquivo (tarefas, painel de assinaturas, PDF assinado).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileSignature, Folder, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { chamarZapsign, detalharModeloZapsign, listarModelosZapsign, type CampoDoModelo, type ModeloZapsign } from "@/lib/assinaturas";
import { filtrarModelos, modelosSugeridos, porPasta } from "@/lib/assinaturas-modelos";
import { TIPOS_DOCUMENTO_OPTIONS } from "@/lib/documentos/tipos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Selecao } from "@/components/ui/selecao";

interface Detalhe {
  modelo: ModeloZapsign;
  campos: Array<CampoDoModelo>;
  cliente: { nome: string; email: string; telefone: string };
}

export function GerarContratoDialog(props: {
  aberto: boolean;
  casoId: string;
  /** Tipo de benefício do caso: é dele que saem os modelos sugeridos. */
  tipoBeneficio: string | null;
  onFechar: () => void;
  onEnviado: () => void;
}) {
  const { aberto, casoId, tipoBeneficio, onFechar, onEnviado } = props;
  const [modelos, setModelos] = useState<Array<ModeloZapsign> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("contrato_honorarios");
  const [enviando, setEnviando] = useState(false);

  // Cada abertura começa na lista, lida de novo (o modelo criado agora no ZapSign já aparece).
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setModelos(null);
    setErro(null);
    setBusca("");
    setDetalhe(null);
    setAbrindo(null);
    listarModelosZapsign().then(
      (lista) => vivo && setModelos(lista),
      (e: unknown) => vivo && setErro(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      vivo = false;
    };
  }, [aberto]);

  const achados = useMemo(() => filtrarModelos(modelos ?? [], busca), [modelos, busca]);
  // com busca digitada a lista já é curta: a sugestão só aparece na lista inteira
  const sugeridos = useMemo(() => (busca.trim() ? [] : modelosSugeridos(modelos ?? [], tipoBeneficio)), [modelos, busca, tipoBeneficio]);
  const grupos = useMemo(() => porPasta(achados), [achados]);

  async function escolher(m: ModeloZapsign) {
    setAbrindo(m.token);
    try {
      const d = await detalharModeloZapsign(casoId, m.token);
      setRespostas(Object.fromEntries(d.campos.map((c) => [c.variavel, c.sugestao])));
      setEmail("");
      setTelefone("");
      setTipoDocumento("contrato_honorarios");
      setDetalhe(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAbrindo(null);
    }
  }

  async function enviar() {
    if (!detalhe) return;
    setEnviando(true);
    try {
      const cliente: Record<string, string> = {};
      if (email.trim()) cliente.email = email.trim();
      if (telefone.trim()) cliente.telefone = telefone.trim();
      await chamarZapsign({
        action: "enviar_modelo",
        caso_id: casoId,
        modelo_token: detalhe.modelo.token,
        respostas,
        tipo_documento: tipoDocumento,
        ...(Object.keys(cliente).length ? { cliente } : {}),
      });
      toast.success("Contrato enviado para assinatura. O cliente recebe o link pelo ZapSign.");
      onEnviado();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  const faltando = detalhe ? detalhe.campos.filter((c) => c.obrigatorio && !(respostas[c.variavel] ?? "").trim()) : [];

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && !enviando && onFechar()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl" data-dialog-modelos>
        <DialogHeader>
          <DialogTitle>{detalhe ? detalhe.modelo.nome : "Gerar contrato pelo ZapSign"}</DialogTitle>
          <DialogDescription>
            {detalhe
              ? "Confira os campos: o que o cadastro do cliente já sabe veio preenchido. Depois o contrato segue para assinatura."
              : "Escolha o modelo do serviço que será prestado. São os modelos da conta do ZapSign deste escritório."}
          </DialogDescription>
        </DialogHeader>

        {!detalhe ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pelo nome do modelo ou da pasta"
                aria-label="Buscar modelo"
                className="pl-9"
                data-busca-modelo
              />
            </div>
            {erro && <p className="text-sm text-red-700">Não consegui ler os modelos: {erro}</p>}
            {modelos === null && !erro && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo os modelos do ZapSign…
              </div>
            )}
            {modelos !== null && (
              <>
                <p className="text-xs text-muted-foreground" data-contagem-modelos>
                  {busca.trim() ? `${achados.length} de ${modelos.length} modelos` : `${modelos.length} ${modelos.length === 1 ? "modelo" : "modelos"}`}
                </p>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {modelos.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      A conta do ZapSign ainda não tem modelo de contrato. Crie um no ZapSign (Modelos → Criar modelo, em DOCX) e ele aparece aqui.
                    </p>
                  )}
                  {modelos.length > 0 && achados.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nenhum modelo com “{busca.trim()}”.</p>
                  )}
                  {sugeridos.length > 0 && (
                    <section data-modelos-sugeridos>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5" /> Sugeridos para {tipoBeneficio}
                      </h3>
                      <ListaDeModelos modelos={sugeridos} abrindo={abrindo} onEscolher={escolher} mostrarPasta />
                    </section>
                  )}
                  {grupos.map((g) => (
                    <section key={g.pasta} data-modelos-pasta={g.pasta}>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Folder className="h-3.5 w-3.5" /> {g.rotulo} <span className="font-normal">({g.modelos.length})</span>
                      </h3>
                      <ListaDeModelos modelos={g.modelos} abrindo={abrindo} onEscolher={escolher} />
                    </section>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" data-campos-modelo>
            {detalhe.campos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este modelo não tem campo para preencher.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {detalhe.campos.map((c) => (
                  <div key={c.variavel} className="space-y-1">
                    <Label htmlFor={`campo-${c.variavel}`}>
                      {c.rotulo}
                      {c.obrigatorio && <span className="text-red-600"> *</span>}
                      {c.sugestao && respostas[c.variavel] === c.sugestao && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">do cadastro</span>
                      )}
                    </Label>
                    <Input
                      id={`campo-${c.variavel}`}
                      value={respostas[c.variavel] ?? ""}
                      onChange={(e) => setRespostas((r) => ({ ...r, [c.variavel]: e.target.value }))}
                    />
                    {c.ajuda && <p className="text-xs text-muted-foreground">{c.ajuda}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">Quem assina: {detalhe.cliente.nome}</p>
              <p className="text-xs text-muted-foreground">
                Em branco, vale o e-mail e o WhatsApp do cadastro. Preencha só para mandar a outro contato desta vez.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="modelo-email">E-mail</Label>
                  <Input id="modelo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={detalhe.cliente.email || "sem e-mail no cadastro"} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="modelo-telefone">WhatsApp</Label>
                  <Input id="modelo-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder={detalhe.cliente.telefone || "sem telefone no cadastro"} />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="modelo-tipo">O PDF assinado entra no caso como</Label>
              <Selecao id="modelo-tipo" opcoes={TIPOS_DOCUMENTO_OPTIONS} value={tipoDocumento} onChange={setTipoDocumento} />
            </div>
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Cada envio conta um documento no plano do ZapSign, mesmo que depois seja cancelado.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {detalhe ? (
            <Button variant="ghost" onClick={() => setDetalhe(null)} disabled={enviando}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Outro modelo
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={enviando}>
              Cancelar
            </Button>
            {detalhe && (
              <Button onClick={enviar} disabled={enviando || faltando.length > 0} title={faltando.length ? `Falta preencher: ${faltando.map((c) => c.rotulo).join(", ")}` : undefined}>
                {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
                Enviar para assinatura
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListaDeModelos(props: {
  modelos: ReadonlyArray<ModeloZapsign>;
  abrindo: string | null;
  onEscolher: (m: ModeloZapsign) => void;
  /** Na seção de sugeridos o modelo vem fora da pasta dele: mostra de qual é. */
  mostrarPasta?: boolean;
}) {
  return (
    <ul className="divide-y rounded-md border">
      {props.modelos.map((m) => (
        <li key={m.token}>
          <button
            type="button"
            onClick={() => props.onEscolher(m)}
            disabled={props.abrindo !== null}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-60"
            data-modelo={m.token}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 font-medium">{m.nome}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {props.mostrarPasta && m.pasta !== "/" && <Badge variant="secondary">{m.pasta.replace(/^\/+|\/+$/g, "")}</Badge>}
              {props.abrindo === m.token && <Loader2 className="h-4 w-4 animate-spin" />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
