// Assinatura eletrônica do caso (#517, ZapSign).
//
// Duas peças, usadas pela aba Documentos do caso:
//   · <PainelAssinaturas>  — os envios do caso, com status, link de cada
//     signatário e "Atualizar" (lê o ZapSign agora);
//   · <EnviarAssinaturaDialog> — confirma e envia um documento do caso.
//
// A tela só LÊ `assinaturas`; quem escreve é a function `zapsign-enviar`.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, FileSignature, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { chamarZapsign, EM_CURSO, type Assinatura, type Signatario, type StatusAssinatura } from "@/lib/assinaturas";
import { dataHoraBR } from "@/lib/fuso";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TelefoneComPais } from "@/components/telefone-com-pais";

const ROTULO_STATUS: Record<StatusAssinatura, string> = {
  enviando: "Enviando…",
  enviado: "Aguardando assinatura",
  aberto: "Em assinatura",
  gravando: "Guardando o assinado…",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado no ZapSign",
};
const ROTULO_SIGNATARIO: Record<Signatario["status"], string> = {
  pendente: "ainda não abriu",
  abriu: "abriu o link",
  assinou: "assinou",
};

/** O que o envio custa no ZapSign — o mesmo aviso nos dois diálogos (arquivo e modelo). */
export function AvisoDoEnvio() {
  return (
    <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground" data-aviso-envio>
      Cada envio conta um documento no plano do ZapSign, mesmo que depois seja cancelado. Com WhatsApp, o ZapSign manda
      o link também por lá, e esse envio é cobrado conforme o plano da conta.
    </p>
  );
}

/** Quem abriu e quem assinou: o documento segue "aberto" até o último assinar, mas isto muda antes. */
const situacaoDosSignatarios = (a: Assinatura): string => a.signatarios.map((s) => `${s.token}:${s.status}`).join("|");

export function PainelAssinaturas(props: {
  lista: Array<Assinatura> | null;
  erro: string | null;
  /** Chamado quando um envio mudou (status novo, PDF assinado gravado). */
  onMudou: (assinatura: Assinatura) => void;
  /**
   * "Atualizar" consulta o ZapSign pela function `zapsign-enviar`, que exige
   * `documentos:enviar` e a integração ligada. O painel é LIDO por todo
   * interno; o botão só aparece para quem a function atende.
   */
  podeAtualizar: boolean;
}) {
  const { lista, erro, onMudou, podeAtualizar } = props;
  // um conjunto, não um id só: "Atualizar" em dois envios seguidos não reabilita o botão do que ainda está consultando
  const [atualizando, setAtualizando] = useState<ReadonlySet<string>>(new Set());

  async function atualizar(a: Assinatura) {
    setAtualizando((s) => new Set(s).add(a.id));
    try {
      const { assinatura } = await chamarZapsign({ action: "sincronizar", assinatura_id: a.id });
      if (assinatura.status === "assinado" && a.status !== "assinado") toast.success("Assinado: o PDF já está nos documentos do caso.");
      else if (assinatura.status === a.status && situacaoDosSignatarios(assinatura) === situacaoDosSignatarios(a)) toast.info("Nada mudou no ZapSign desde a última consulta.");
      onMudou(assinatura);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAtualizando((s) => {
        const resto = new Set(s);
        resto.delete(a.id);
        return resto;
      });
    }
  }

  function copiar(link: string) {
    void navigator.clipboard.writeText(link).then(
      () => toast.success("Link de assinatura copiado."),
      () => toast.error("Não consegui copiar o link."),
    );
  }

  if (erro) return <p className="text-sm text-red-700">Não consegui ler as assinaturas deste caso: {erro}</p>;
  if (!lista?.length) return null;

  return (
    <section className="space-y-2 rounded-md border p-3" data-painel-assinaturas>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileSignature className="h-4 w-4" /> Assinaturas (ZapSign)
      </h3>
      <ul className="space-y-2">
        {lista.map((a) => (
          <li key={a.id} className="rounded-md border p-3" data-assinatura={a.id} data-assinatura-status={a.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.nome}</p>
                <p className="text-xs text-muted-foreground">
                  Enviado em {dataHoraBR(a.created_at)}
                  {a.assinado_em && ` · assinado em ${dataHoraBR(a.assinado_em)}`}
                  {a.sandbox && " · sandbox (sem validade jurídica)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={a.status === "assinado" ? "default" : a.status === "recusado" || a.status === "cancelado" ? "destructive" : "secondary"}>
                  {a.status === "assinado" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                  {ROTULO_STATUS[a.status]}
                </Badge>
                {podeAtualizar && EM_CURSO.includes(a.status) && (
                  <Button size="sm" variant="outline" onClick={() => atualizar(a)} disabled={atualizando.has(a.id)}>
                    {atualizando.has(a.id) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Atualizar
                  </Button>
                )}
              </div>
            </div>
            {a.signatarios.length > 0 && (
              <ul className="mt-2 space-y-1">
                {a.signatarios.map((s) => (
                  <li key={s.token || s.nome} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      <span className="font-medium">{s.nome}</span>{" "}
                      <span className="text-muted-foreground">
                        ({s.papel === "cliente" ? "cliente" : "escritório"}) · {ROTULO_SIGNATARIO[s.status]}
                        {s.assinado_em && ` em ${dataHoraBR(s.assinado_em)}`}
                      </span>
                    </span>
                    {s.status !== "assinou" && s.sign_url && EM_CURSO.includes(a.status) && (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => copiar(s.sign_url)}>
                        <Copy className="mr-1 h-3 w-3" /> Copiar link
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EnviarAssinaturaDialog(props: {
  /** O documento a enviar; `null` = fechado. */
  documento: { id: string; nome_arquivo: string } | null;
  onFechar: () => void;
  onEnviado: () => void;
}) {
  const { documento, onFechar, onEnviado } = props;
  const { usuario } = useAuth();
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [comEscritorio, setComEscritorio] = useState(true);
  const [nomeEsc, setNomeEsc] = useState("");
  const [emailEsc, setEmailEsc] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Cada abertura começa limpa, com quem está logado como segundo signatário.
  const documentoId = documento?.id ?? null;
  useEffect(() => {
    if (!documentoId) return;
    setEmail("");
    setTelefone("");
    setComEscritorio(true);
    setNomeEsc(usuario?.nome ?? "");
    setEmailEsc(usuario?.email ?? "");
  }, [documentoId, usuario?.nome, usuario?.email]);

  async function enviar() {
    if (!documento) return;
    setEnviando(true);
    try {
      // campo em branco = usa o contato do cadastro do cliente
      const cliente: Record<string, string> = {};
      if (email.trim()) cliente.email = email.trim();
      if (telefone.trim()) cliente.telefone = telefone.trim();
      const { aviso } = await chamarZapsign({
        action: "enviar",
        documento_id: documento.id,
        ...(Object.keys(cliente).length ? { cliente } : {}),
        ...(comEscritorio ? { segundo: { nome: nomeEsc.trim(), email: emailEsc.trim() } } : {}),
      });
      toast.success("Enviado para assinatura. O cliente recebe o link pelo ZapSign.");
      if (aviso) toast.warning(aviso);
      onEnviado();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={!!documento} onOpenChange={(aberto) => !aberto && !enviando && onFechar()}>
      <DialogContent data-dialog-assinatura>
        <DialogHeader>
          <DialogTitle>Enviar para assinatura</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{documento?.nome_arquivo}</span> vai para o ZapSign e o cliente
            do caso recebe o link para assinar. Quando todos assinarem, o PDF assinado entra nos documentos do caso.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Contato do cliente</p>
            <p className="text-xs text-muted-foreground">
              Em branco, vale o e-mail e o WhatsApp do cadastro. Preencha só para mandar a outro contato desta vez.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="assin-email">E-mail</Label>
                <Input id="assin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="do cadastro" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="assin-telefone">WhatsApp</Label>
                {/* remonta a cada documento: o país volta ao Brasil */}
                <TelefoneComPais key={documentoId ?? "fechado"} id="assin-telefone" value={telefone} onChange={setTelefone} placeholder="do cadastro" />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={comEscritorio} onCheckedChange={(v) => setComEscritorio(v === true)} />
              Alguém do escritório também assina
            </label>
            {comEscritorio && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="assin-nome-esc">Nome</Label>
                  <Input id="assin-nome-esc" value={nomeEsc} onChange={(e) => setNomeEsc(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="assin-email-esc">E-mail</Label>
                  <Input id="assin-email-esc" type="email" value={emailEsc} onChange={(e) => setEmailEsc(e.target.value)} />
                </div>
              </div>
            )}
          </div>
          <AvisoDoEnvio />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando || (comEscritorio && (!nomeEsc.trim() || !emailEsc.trim()))}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
            Enviar para assinatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
