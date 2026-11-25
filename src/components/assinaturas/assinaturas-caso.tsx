// Assinatura eletrônica do caso (#517, ZapSign).
//
// Duas peças, usadas pela aba Documentos do caso:
//   · <PainelAssinaturas>  — os envios do caso, com status, link de cada
//     signatário e "Atualizar" (lê o ZapSign agora);
//   · <EnviarAssinaturaDialog> — confirma e envia um documento do caso.
//
// A tela só LÊ `assinaturas`; quem escreve é a function `zapsign-enviar`.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, FileSignature, Loader2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { buscarLinkDeAssinatura, cancelarEnvioZapsign, chamarZapsign, EM_CURSO, excluirEnvioZapsign, type Assinatura, type Signatario, type StatusAssinatura } from "@/lib/assinaturas";
import { copiarTexto } from "@/lib/copiar";
import { dataHoraBR } from "@/lib/fuso";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
  /**
   * "Copiar link" entrega o `sign_url` pela RPC `assinatura_sign_url` (#545),
   * restrita a quem gerencia assinaturas (`documentos:enviar`) ou ao dono do
   * caso, e auditada. O botão só aparece para quem a RPC atende.
   */
  podeCopiarLink: boolean;
  /**
   * "Cancelar envio" e "Excluir" (#550): a function pede `documentos:excluir`
   * além de `documentos:enviar`. O botão só aparece para quem ela atende.
   */
  podeExcluir: boolean;
  /** Chamado quando um envio saiu do sistema (e talvez o PDF e as tarefas dele). */
  onExcluido: () => void;
}) {
  const { lista, erro, onMudou, podeAtualizar, podeCopiarLink, podeExcluir, onExcluido } = props;
  // envio cuja confirmação de cancelar/excluir está aberta
  const [confirmando, setConfirmando] = useState<{ assinatura: Assinatura; acao: "cancelar" | "excluir" } | null>(null);
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

  // O link não vem na lista (a view o esconde): busca sob demanda pela RPC, que
  // confere escopo e audita a leitura, e só então copia.
  async function copiarLink(assinaturaId: string, token: string) {
    try {
      const link = await buscarLinkDeAssinatura(assinaturaId, token);
      if (!link) {
        toast.error("O link de assinatura não está mais disponível.");
        return;
      }
      await copiarTexto(link, "Link de assinatura copiado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
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
                {podeExcluir && (a.status === "enviado" || a.status === "aberto") && (
                  <Button size="sm" variant="ghost" className="text-red-700 hover:text-red-800" onClick={() => setConfirmando({ assinatura: a, acao: "cancelar" })} data-cancelar-envio>
                    <XCircle className="mr-1.5 h-4 w-4" /> Cancelar envio
                  </Button>
                )}
                {podeExcluir && !EM_CURSO.includes(a.status) && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-700 hover:text-red-800" title="Excluir este envio do sistema" aria-label="Excluir este envio do sistema" onClick={() => setConfirmando({ assinatura: a, acao: "excluir" })} data-excluir-envio>
                    <Trash2 className="h-4 w-4" />
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
                    {s.status !== "assinou" && s.tem_link && EM_CURSO.includes(a.status) && podeCopiarLink && (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => void copiarLink(a.id, s.token)}>
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
      <ConfirmarEnvioDialog
        confirmando={confirmando}
        onFechar={() => setConfirmando(null)}
        onCancelado={(a) => onMudou(a)}
        onExcluido={onExcluido}
      />
    </section>
  );
}

/**
 * Confirmação de "Cancelar envio" (em curso: cancela no ZapSign) e de "Excluir"
 * (encerrado: sai do sistema). No excluir de um envio assinado, o PDF e as
 * tarefas só saem se a pessoa marcar — contrato de verdade fica, teste vai embora.
 */
function ConfirmarEnvioDialog(props: {
  confirmando: { assinatura: Assinatura; acao: "cancelar" | "excluir" } | null;
  onFechar: () => void;
  onCancelado: (a: Assinatura) => void;
  onExcluido: () => void;
}) {
  const { confirmando, onFechar, onCancelado, onExcluido } = props;
  const [apagarPdf, setApagarPdf] = useState(false);
  const [apagarTarefas, setApagarTarefas] = useState(false);
  const [rodando, setRodando] = useState(false);
  // cada confirmação começa com as caixas desmarcadas
  useEffect(() => {
    setApagarPdf(false);
    setApagarTarefas(false);
  }, [confirmando]);
  if (!confirmando) return null;
  const { assinatura: a, acao } = confirmando;
  const temPdf = !!a.documento_assinado_id;

  async function confirmar() {
    setRodando(true);
    try {
      if (acao === "cancelar") {
        const { assinatura } = await cancelarEnvioZapsign(a.id);
        toast.success("Envio cancelado: o link de assinatura não funciona mais.");
        onCancelado(assinatura);
      } else {
        await excluirEnvioZapsign(a.id, { apagarPdf: temPdf && apagarPdf, apagarTarefas });
        toast.success("Envio excluído do sistema.");
        onExcluido();
      }
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRodando(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(aberto) => !aberto && !rodando && onFechar()}>
      <AlertDialogContent data-confirmar-envio={acao}>
        <AlertDialogHeader>
          <AlertDialogTitle>{acao === "cancelar" ? "Cancelar este envio?" : "Excluir este envio do sistema?"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-foreground">{a.nome}</p>
              {acao === "cancelar" ? (
                <p>
                  O documento é excluído no ZapSign e o link de assinatura para de funcionar. O envio fica aqui como
                  &quot;Cancelado&quot;. O documento já contou no plano do ZapSign; cancelar não devolve.
                </p>
              ) : (
                <p>O envio sai do painel de assinaturas. Fica registrado na auditoria quem excluiu.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {acao === "excluir" && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            {temPdf && (
              <label className="flex items-start gap-2" data-apagar-pdf>
                <Checkbox checked={apagarPdf} onCheckedChange={(v) => setApagarPdf(v === true)} className="mt-0.5" />
                <span>
                  Apagar também o <strong>PDF assinado</strong> dos documentos do caso
                  <span className="block text-xs text-muted-foreground">Deixe desmarcado se o contrato vale: o PDF continua no caso.</span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2" data-apagar-tarefas>
              <Checkbox checked={apagarTarefas} onCheckedChange={(v) => setApagarTarefas(v === true)} className="mt-0.5" />
              <span>
                Apagar também as <strong>tarefas</strong> criadas por este envio
                <span className="block text-xs text-muted-foreground">&quot;Acompanhar assinatura&quot; e &quot;Contrato assinado — dar prosseguimento&quot;. O motivo fica no histórico do caso.</span>
              </span>
            </label>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirmar} disabled={rodando} data-confirmar>
            {rodando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {acao === "cancelar" ? "Cancelar envio" : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
