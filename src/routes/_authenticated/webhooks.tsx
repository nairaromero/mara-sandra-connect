import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Webhook,
  ShieldAlert,
  Pencil,
  Trash2,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/webhooks")({
  component: WebhooksPage,
});

// Catalogo de eventos que o banco emite (triggers tg_webhook_*). O label e a
// descricao sao so de UI; o value e o que vai pra coluna eventos[] e bate com
// o tipo gravado em webhook_eventos pelos triggers.
const EVENTOS: { value: string; label: string; desc: string }[] = [
  { value: "caso.created", label: "Caso criado", desc: "Novo caso aberto no escritorio" },
  { value: "caso.status_changed", label: "Status do caso", desc: "Mudanca de status do caso" },
  { value: "caso.fase_changed", label: "Fase do caso", desc: "Mudanca de fase do caso" },
  { value: "andamento.created", label: "Novo andamento", desc: "Andamento registrado no caso" },
  { value: "documento.uploaded", label: "Documento enviado", desc: "Documento anexado ao caso" },
  { value: "solicitacao_documento.created", label: "Solicitacao de documento", desc: "Pedido de documento ao cliente" },
  { value: "solicitacao_documento.status_changed", label: "Status da solicitacao", desc: "Solicitacao de documento mudou de status" },
  { value: "repasse.status_changed", label: "Status de repasse", desc: "Mudanca no status de um repasse" },
  { value: "processo_admin.decisao", label: "Decisao administrativa", desc: "Decisao em processo administrativo" },
  { value: "processo_judicial.created", label: "Processo judicial", desc: "Novo processo judicial cadastrado" },
  { value: "analise_tecnica.disponivel", label: "Analise tecnica", desc: "Analise tecnica disponibilizada" },
];

interface ParceiroOption {
  id: string;
  nome: string | null;
  email: string | null;
}

interface DestinoRow {
  id: string;
  parceiro_id: string | null;
  url: string;
  eventos: string[];
  ativo: boolean;
  secret_id: string | null;
  created_at: string | null;
  parceiro: { nome: string | null; email: string | null } | null;
}

// Gera um segredo HMAC forte (32 bytes -> base64url, ~43 chars). Usa CSPRNG do
// browser. Mostrado UMA vez ao interno; o banco guarda no Vault e nunca devolve.
function gerarSegredo(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function WebhooksPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const isInterno = usuario?.tipo === "interno";

  const [destinos, setDestinos] = useState<DestinoRow[]>([]);
  const [parceiros, setParceiros] = useState<ParceiroOption[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- Formulario de criacao ----
  const [novoParceiro, setNovoParceiro] = useState<string>("");
  const [novaUrl, setNovaUrl] = useState("");
  const [novosEventos, setNovosEventos] = useState<string[]>([]);
  const [novoSegredo, setNovoSegredo] = useState("");
  const [criando, setCriando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // ---- Editar destino (url + eventos) ----
  const [editAlvo, setEditAlvo] = useState<DestinoRow | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editEventos, setEditEventos] = useState<string[]>([]);
  const [editSalvando, setEditSalvando] = useState(false);

  // ---- Redefinir segredo ----
  const [segredoAlvo, setSegredoAlvo] = useState<DestinoRow | null>(null);
  const [segredoNovo, setSegredoNovo] = useState("");
  const [segredoSalvando, setSegredoSalvando] = useState(false);
  const [segredoCopiado, setSegredoCopiado] = useState(false);

  // ---- Excluir destino ----
  const [excluirAlvo, setExcluirAlvo] = useState<DestinoRow | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  useEffect(() => {
    if (usuario && !isInterno) {
      toast.error("Acesso restrito a equipe interna.");
      navigate({ to: "/" });
    }
  }, [usuario, isInterno, navigate]);

  async function loadDados() {
    setLoading(true);
    const [destResp, parcResp] = await Promise.all([
      supabase
        .from("webhook_destinos")
        .select(
          "id, parceiro_id, url, eventos, ativo, secret_id, created_at, parceiro:parceiro_id(nome, email)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("usuarios")
        .select("id, nome, email")
        .eq("tipo", "parceiro")
        .eq("ativo", true)
        .order("nome", { ascending: true }),
    ]);
    if (destResp.error) {
      console.error(destResp.error);
      toast.error("Falha ao carregar webhooks.");
    } else {
      setDestinos((destResp.data as unknown as DestinoRow[]) ?? []);
    }
    if (parcResp.error) {
      console.error(parcResp.error);
    } else {
      setParceiros((parcResp.data as ParceiroOption[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (isInterno) loadDados();
  }, [isInterno]);

  function toggleEvento(
    value: string,
    set: React.Dispatch<React.SetStateAction<string[]>>,
  ) {
    set((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value],
    );
  }

  async function copiar(texto: string, marcar: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(texto);
      marcar(true);
      setTimeout(() => marcar(false), 2000);
    } catch {
      toast.error("Nao foi possivel copiar. Selecione e copie manualmente.");
    }
  }

  async function criarDestino() {
    if (!novoParceiro) {
      toast.error("Selecione o parceiro de destino.");
      return;
    }
    if (!isHttpsUrl(novaUrl)) {
      toast.error("Informe uma URL https valida.");
      return;
    }
    if (novosEventos.length === 0) {
      toast.error("Selecione ao menos um evento.");
      return;
    }
    if (novoSegredo.trim().length < 16) {
      toast.error("Gere ou informe um segredo de pelo menos 16 caracteres.");
      return;
    }
    setCriando(true);
    try {
      const ins = await supabase
        .from("webhook_destinos")
        .insert({
          parceiro_id: novoParceiro,
          url: novaUrl.trim(),
          eventos: novosEventos,
          ativo: true,
        })
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      const destinoId = (ins.data as { id: string }).id;

      const sec = await supabase.rpc("set_webhook_secret", {
        p_destino_id: destinoId,
        p_secret: novoSegredo.trim(),
      });
      if (sec.error) {
        // Destino ficou sem segredo (secret_id null). O interno pode redefinir
        // depois pela acao "Redefinir segredo"; nao deixamos um destino orfao
        // silencioso, entao avisamos.
        throw new Error(
          "Destino criado, mas o segredo falhou: " +
            (sec.error.message || "erro desconhecido") +
            ". Use 'Redefinir segredo' na lista.",
        );
      }

      toast.success(
        "Webhook criado. Copie o segredo agora - ele nao sera mostrado de novo.",
      );
      setNovoParceiro("");
      setNovaUrl("");
      setNovosEventos([]);
      setNovoSegredo("");
      await loadDados();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao criar webhook.");
    } finally {
      setCriando(false);
    }
  }

  async function toggleAtivo(d: DestinoRow) {
    const resp = await supabase
      .from("webhook_destinos")
      .update({ ativo: !d.ativo })
      .eq("id", d.id);
    if (resp.error) {
      console.error(resp.error);
      toast.error("Falha ao alterar status.");
    } else {
      setDestinos((prev) =>
        prev.map((x) => (x.id === d.id ? { ...x, ativo: !x.ativo } : x)),
      );
    }
  }

  function abrirEditar(d: DestinoRow) {
    setEditAlvo(d);
    setEditUrl(d.url);
    setEditEventos([...d.eventos]);
  }

  async function salvarEdit() {
    if (!editAlvo) return;
    if (!isHttpsUrl(editUrl)) {
      toast.error("Informe uma URL https valida.");
      return;
    }
    if (editEventos.length === 0) {
      toast.error("Selecione ao menos um evento.");
      return;
    }
    setEditSalvando(true);
    try {
      const resp = await supabase
        .from("webhook_destinos")
        .update({ url: editUrl.trim(), eventos: editEventos })
        .eq("id", editAlvo.id);
      if (resp.error) throw resp.error;
      toast.success("Webhook atualizado.");
      setEditAlvo(null);
      await loadDados();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao atualizar webhook.");
    } finally {
      setEditSalvando(false);
    }
  }

  function abrirSegredo(d: DestinoRow) {
    setSegredoAlvo(d);
    setSegredoNovo("");
    setSegredoCopiado(false);
  }

  async function salvarSegredo() {
    if (!segredoAlvo) return;
    if (segredoNovo.trim().length < 16) {
      toast.error("Gere ou informe um segredo de pelo menos 16 caracteres.");
      return;
    }
    setSegredoSalvando(true);
    try {
      const resp = await supabase.rpc("set_webhook_secret", {
        p_destino_id: segredoAlvo.id,
        p_secret: segredoNovo.trim(),
      });
      if (resp.error) throw resp.error;
      toast.success(
        "Segredo atualizado. Copie agora - nao sera mostrado de novo.",
      );
      setSegredoAlvo(null);
      await loadDados();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao redefinir segredo.");
    } finally {
      setSegredoSalvando(false);
    }
  }

  async function excluirConfirmado() {
    if (!excluirAlvo) return;
    setExcluindo(true);
    try {
      const resp = await supabase
        .from("webhook_destinos")
        .delete()
        .eq("id", excluirAlvo.id);
      if (resp.error) throw resp.error;
      toast.success("Webhook excluido.");
      setExcluirAlvo(null);
      await loadDados();
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao excluir webhook.");
    } finally {
      setExcluindo(false);
    }
  }

  function nomeParceiro(d: DestinoRow): string {
    return d.parceiro?.nome || d.parceiro?.email || "Parceiro removido";
  }

  if (!isInterno) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">Acesso restrito a equipe interna.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Webhooks
        </h1>
        <p className="text-sm text-muted-foreground">
          Notificacoes enviadas a parceiros externos quando algo muda no caso.
          O segredo assina cada entrega (HMAC-SHA256) e fica guardado cifrado -
          so e mostrado no momento da criacao.
        </p>
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4" />
              Novo destino de webhook
            </CardTitle>
            <CardDescription>
              Escolha o parceiro, a URL de entrega (https) e os eventos que ele
              deve receber.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Parceiro *</Label>
                <Select value={novoParceiro} onValueChange={setNovoParceiro}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o parceiro" />
                  </SelectTrigger>
                  <SelectContent>
                    {parceiros.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        Nenhum parceiro ativo
                      </div>
                    ) : (
                      parceiros.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome || p.email || p.id}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">URL de entrega (https) *</Label>
                <Input
                  value={novaUrl}
                  onChange={(e) => setNovaUrl(e.target.value)}
                  placeholder="https://parceiro.com/webhooks/msv"
                  inputMode="url"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Eventos *</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {EVENTOS.map((ev) => (
                  <label
                    key={ev.value}
                    htmlFor={"novo-" + ev.value}
                    className="flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      id={"novo-" + ev.value}
                      checked={novosEventos.includes(ev.value)}
                      onCheckedChange={() =>
                        toggleEvento(ev.value, setNovosEventos)
                      }
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium leading-none">
                        {ev.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{ev.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Segredo de assinatura *</Label>
              <div className="flex gap-2">
                <Input
                  value={novoSegredo}
                  onChange={(e) => setNovoSegredo(e.target.value)}
                  placeholder="Clique em Gerar para criar um segredo forte"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNovoSegredo(gerarSegredo())}
                >
                  <KeyRound className="h-4 w-4 mr-1" />
                  Gerar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!novoSegredo}
                  onClick={() => copiar(novoSegredo, setCopiado)}
                  aria-label="Copiar segredo"
                >
                  {copiado ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-[var(--gold)] font-medium">
                Copie e entregue ao parceiro com seguranca. Apos salvar, o
                segredo nao podera mais ser visto - so redefinido.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={criarDestino} disabled={criando}>
                {criando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Webhook className="h-4 w-4 mr-2" />
                Criar webhook
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Destinos cadastrados</CardTitle>
            <CardDescription>
              {destinos.length} {destinos.length === 1 ? "destino" : "destinos"}{" "}
              no total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : destinos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhum webhook cadastrado ainda. Use o formulario acima para
                criar o primeiro.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parceiro</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-20 text-center">Eventos</TableHead>
                    <TableHead className="w-24">Segredo</TableHead>
                    <TableHead className="w-20 text-center">Ativo</TableHead>
                    <TableHead className="w-32 text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {destinos.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">
                        {nomeParceiro(d)}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[220px] truncate font-mono text-xs">
                        {d.url}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{d.eventos.length}</Badge>
                      </TableCell>
                      <TableCell>
                        {d.secret_id ? (
                          <Badge variant="secondary">Definido</Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive">
                            Pendente
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={d.ativo}
                          onCheckedChange={() => toggleAtivo(d)}
                          aria-label="Ativar ou desativar webhook"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => abrirSegredo(d)}
                            aria-label="Redefinir segredo"
                            title="Redefinir segredo"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => abrirEditar(d)}
                            aria-label="Editar webhook"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExcluirAlvo(d)}
                            aria-label="Excluir webhook"
                            title="Excluir"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Dialog: editar url + eventos */}
        <Dialog
          open={editAlvo !== null}
          onOpenChange={(o) => {
            if (!editSalvando && !o) setEditAlvo(null);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar webhook</DialogTitle>
              <DialogDescription>
                Ajuste a URL de entrega e os eventos. O segredo nao muda aqui -
                use "Redefinir segredo".
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">URL de entrega (https)</Label>
                <Input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://parceiro.com/webhooks/msv"
                  inputMode="url"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Eventos</Label>
                <div className="grid gap-2">
                  {EVENTOS.map((ev) => (
                    <label
                      key={ev.value}
                      htmlFor={"edit-" + ev.value}
                      className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        id={"edit-" + ev.value}
                        checked={editEventos.includes(ev.value)}
                        onCheckedChange={() =>
                          toggleEvento(ev.value, setEditEventos)
                        }
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium leading-none">
                          {ev.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ev.desc}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setEditAlvo(null)}
                disabled={editSalvando}
              >
                Cancelar
              </Button>
              <Button onClick={salvarEdit} disabled={editSalvando}>
                {editSalvando && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: redefinir segredo */}
        <Dialog
          open={segredoAlvo !== null}
          onOpenChange={(o) => {
            if (!segredoSalvando && !o) setSegredoAlvo(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Redefinir segredo</DialogTitle>
              <DialogDescription>
                Gere um novo segredo para{" "}
                {segredoAlvo ? nomeParceiro(segredoAlvo) : "este destino"}. O
                segredo antigo deixa de valer imediatamente - combine a troca
                com o parceiro.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs">Novo segredo</Label>
              <div className="flex gap-2">
                <Input
                  value={segredoNovo}
                  onChange={(e) => setSegredoNovo(e.target.value)}
                  placeholder="Clique em Gerar"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSegredoNovo(gerarSegredo())}
                >
                  <KeyRound className="h-4 w-4 mr-1" />
                  Gerar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!segredoNovo}
                  onClick={() => copiar(segredoNovo, setSegredoCopiado)}
                  aria-label="Copiar segredo"
                >
                  {segredoCopiado ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-[var(--gold)] font-medium">
                Copie antes de salvar - nao sera mostrado de novo.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setSegredoAlvo(null)}
                disabled={segredoSalvando}
              >
                Cancelar
              </Button>
              <Button onClick={salvarSegredo} disabled={segredoSalvando}>
                {segredoSalvando && (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                )}
                Salvar segredo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* AlertDialog: confirmar exclusao */}
        <AlertDialog
          open={excluirAlvo !== null}
          onOpenChange={(o) => {
            if (!excluindo && !o) setExcluirAlvo(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir webhook?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    O destino{" "}
                    <strong>
                      {excluirAlvo ? nomeParceiro(excluirAlvo) : ""}
                    </strong>{" "}
                    deixara de receber notificacoes. Esta acao e{" "}
                    <strong>irreversivel</strong> e o segredo associado e
                    descartado.
                  </p>
                  <p className="text-muted-foreground">
                    O historico de entregas (webhook_eventos) e preservado para
                    auditoria.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={excluindo}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  excluirConfirmado();
                }}
                disabled={excluindo}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {excluindo && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                Sim, excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ClientOnly>
    </div>
  );
}
