import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

// Gestão de webhooks — aba "Webhooks" das Configurações, só admin (a tela pai
// decide quem vê; no banco, o RLS de webhook_destinos usa is_admin()). Até
// 2026-09-14 era a página /webhooks, com item próprio na sidebar; a rota agora
// só redireciona pra /configuracoes?tab=webhooks.

// Catalogo de eventos que o banco emite (triggers tg_webhook_*). O label e a
// descricao sao so de UI; o value e o que vai pra coluna eventos[] e bate com
// o tipo gravado em webhook_eventos pelos triggers.
const EVENTOS: { value: string; label: string; desc: string }[] = [
  { value: "caso.created", label: "Caso criado", desc: "Novo caso aberto no escritório" },
  { value: "caso.status_changed", label: "Status do caso", desc: "Mudança de status do caso" },
  { value: "caso.fase_changed", label: "Fase do caso", desc: "Mudança de fase do caso" },
  { value: "andamento.created", label: "Novo andamento", desc: "Andamento registrado no caso" },
  { value: "documento.uploaded", label: "Documento enviado", desc: "Documento anexado ao caso" },
  {
    value: "solicitacao_documento.created",
    label: "Solicitação de documento",
    desc: "Pedido de documento ao cliente",
  },
  {
    value: "solicitacao_documento.status_changed",
    label: "Status da solicitação",
    desc: "Solicitação de documento mudou de status",
  },
  // Repasse pausado na UI (mantido no backend) - ver issue #247 (repasses).
  // { value: "repasse.status_changed", label: "Status de repasse", desc: "Mudanca no status de um repasse" },
  {
    value: "processo_admin.decisao",
    label: "Decisão administrativa",
    desc: "Decisão em processo administrativo",
  },
  {
    value: "processo_judicial.created",
    label: "Processo judicial",
    desc: "Novo processo judicial cadastrado",
  },
  {
    value: "analise_tecnica.disponivel",
    label: "Análise técnica",
    desc: "Análise técnica disponibilizada",
  },
];

interface ParceiroOption {
  id: string;
  nome: string | null;
  email: string | null;
}

interface DestinoRow {
  id: string;
  url: string;
  eventos: string[];
  ativo: boolean;
  secret_id: string | null;
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

function nomeParceiro(d: DestinoRow): string {
  return d.parceiro?.nome || d.parceiro?.email || "Parceiro removido";
}

// Lista de checkboxes de eventos — a mesma no "Novo" e no "Editar".
function EscolhaEventos({
  prefixo,
  marcados,
  alternar,
}: {
  prefixo: string;
  marcados: string[];
  alternar: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {EVENTOS.map((ev) => (
        <label
          key={ev.value}
          htmlFor={prefixo + ev.value}
          className="flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover:bg-muted/50"
        >
          <Checkbox
            id={prefixo + ev.value}
            checked={marcados.includes(ev.value)}
            onCheckedChange={() => alternar(ev.value)}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-none">{ev.label}</p>
            <p className="text-xs text-muted-foreground">{ev.desc}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

// Campo de segredo com Gerar + Copiar — o mesmo no "Novo" e no "Redefinir".
function CampoSegredo({
  valor,
  mudar,
  copiado,
  copiar,
  placeholder,
}: {
  valor: string;
  mudar: (v: string) => void;
  copiado: boolean;
  copiar: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex gap-2">
      <Input
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
        autoComplete="off"
      />
      <Button type="button" variant="outline" onClick={() => mudar(gerarSegredo())}>
        <KeyRound className="h-4 w-4 mr-1" />
        Gerar
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={!valor}
        onClick={copiar}
        aria-label="Copiar segredo"
      >
        {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

// Redefinir segredo / Editar / Excluir — os mesmos três no card (mobile) e na
// linha da tabela (desktop).
function AcoesDestino({
  onSegredo,
  onEditar,
  onExcluir,
}: {
  onSegredo: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  return (
    <div className="flex justify-end gap-0.5">
      <Button
        size="sm"
        variant="ghost"
        onClick={onSegredo}
        aria-label="Redefinir segredo"
        title="Redefinir segredo"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEditar}
        aria-label="Editar webhook"
        title="Editar"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onExcluir}
        aria-label="Excluir webhook"
        title="Excluir"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function WebhooksCard() {
  const [destinos, setDestinos] = useState<DestinoRow[]>([]);
  const [parceiros, setParceiros] = useState<ParceiroOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Falha de carga ≠ lista vazia. Antes, erro virava "Nenhum webhook
  // cadastrado" / "Nenhum parceiro ativo" — e quem acreditava no vazio criava
  // um destino duplicado.
  const [erroDestinos, setErroDestinos] = useState(false);
  const [erroParceiros, setErroParceiros] = useState(false);

  // ---- Novo destino (dialog) ----
  const [novoAberto, setNovoAberto] = useState(false);
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

  async function loadDados() {
    setLoading(true);
    const [destResp, parcResp] = await Promise.all([
      supabase
        .from("webhook_destinos")
        // Só o que a tela lê. A ordem é feita no banco (não precisa de
        // created_at no select) e o nome do parceiro vem pela FK parceiro_id.
        .select("id, url, eventos, ativo, secret_id, parceiro:parceiro_id(nome, email)")
        .order("created_at", { ascending: false }),
      supabase
        .from("usuarios_escritorio")
        .select("id, nome, email")
        .eq("eh_parceiro", true)
        .eq("ativo", true)
        .order("nome", { ascending: true }),
    ]);
    if (destResp.error) {
      console.error(destResp.error);
      toast.error("Falha ao carregar webhooks.");
      setErroDestinos(true);
    } else {
      setDestinos((destResp.data as unknown as DestinoRow[]) ?? []);
      setErroDestinos(false);
    }
    if (parcResp.error) {
      console.error(parcResp.error);
      toast.error("Falha ao carregar parceiros.");
      setErroParceiros(true);
    } else {
      setParceiros((parcResp.data as ParceiroOption[]) ?? []);
      setErroParceiros(false);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadDados();
  }, []);

  function toggleEvento(value: string, set: React.Dispatch<React.SetStateAction<string[]>>) {
    set((prev) => (prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]));
  }

  async function copiar(texto: string, marcar: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(texto);
      marcar(true);
      setTimeout(() => marcar(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  function limparNovo() {
    setNovoParceiro("");
    setNovaUrl("");
    setNovosEventos([]);
    setNovoSegredo("");
    setCopiado(false);
  }

  async function criarDestino() {
    if (!novoParceiro) {
      toast.error("Selecione o parceiro de destino.");
      return;
    }
    if (!isHttpsUrl(novaUrl)) {
      toast.error("Informe uma URL https válida.");
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
        // O destino JÁ existe (sem segredo). Fecha o dialog e recarrega a lista
        // mesmo assim: deixar o formulário aberto convidava a clicar "Criar" de
        // novo e duplicar o destino, e sem recarregar o órfão nem aparecia pra
        // receber o "Redefinir segredo" que a mensagem manda usar.
        console.error(sec.error);
        toast.error(
          "Destino criado, mas o segredo falhou: " +
            (sec.error.message || "erro desconhecido") +
            ". Use 'Redefinir segredo' na lista.",
        );
        setNovoAberto(false);
        limparNovo();
        await loadDados();
        return;
      }

      toast.success("Webhook criado. Copie o segredo agora - ele não será mostrado de novo.");
      setNovoAberto(false);
      limparNovo();
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
    const resp = await supabase.from("webhook_destinos").update({ ativo: !d.ativo }).eq("id", d.id);
    if (resp.error) {
      console.error(resp.error);
      toast.error("Falha ao alterar status.");
    } else {
      setDestinos((prev) => prev.map((x) => (x.id === d.id ? { ...x, ativo: !x.ativo } : x)));
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
      toast.error("Informe uma URL https válida.");
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
      toast.success("Segredo atualizado. Copie agora - não será mostrado de novo.");
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
      const resp = await supabase.from("webhook_destinos").delete().eq("id", excluirAlvo.id);
      if (resp.error) throw resp.error;
      toast.success("Webhook excluído.");
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base flex items-center gap-2">
              <Webhook className="h-4 w-4" />
              Webhooks
            </CardTitle>
            <CardDescription>
              Notificações enviadas a parceiros externos quando algo muda no caso. O segredo assina
              cada entrega (HMAC-SHA256) e fica guardado cifrado - só é mostrado no momento da
              criação.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNovoAberto(true)}
            disabled={loading || erroDestinos}
            title={erroDestinos ? "Carregue a lista antes de criar um destino" : undefined}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Novo webhook
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : erroDestinos ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-destructive">
              Não foi possível carregar os webhooks. A lista pode não estar vazia — tente de novo
              antes de criar um destino.
            </p>
            <Button variant="outline" size="sm" onClick={() => loadDados()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Tentar de novo
            </Button>
          </div>
        ) : destinos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum webhook cadastrado ainda. Use "Novo webhook" para criar o primeiro.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {destinos.length}{" "}
              {destinos.length === 1 ? "destino cadastrado" : "destinos cadastrados"}
            </p>
            {/* Mobile: cards */}
            <div className="md:hidden space-y-3">
              {destinos.map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{nomeParceiro(d)}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {d.url}
                      </div>
                    </div>
                    <Switch
                      checked={d.ativo}
                      onCheckedChange={() => toggleAtivo(d)}
                      aria-label="Ativar ou desativar webhook"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary">
                        {d.eventos.length} {d.eventos.length === 1 ? "evento" : "eventos"}
                      </Badge>
                      {d.secret_id ? (
                        <Badge variant="secondary">Segredo definido</Badge>
                      ) : (
                        <Badge variant="outline" className="text-destructive">
                          Segredo pendente
                        </Badge>
                      )}
                    </div>
                    <AcoesDestino
                      onSegredo={() => abrirSegredo(d)}
                      onEditar={() => abrirEditar(d)}
                      onExcluir={() => setExcluirAlvo(d)}
                    />
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parceiro</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-20 text-center">Eventos</TableHead>
                    <TableHead className="w-24">Segredo</TableHead>
                    <TableHead className="w-20 text-center">Ativo</TableHead>
                    <TableHead className="w-32 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {destinos.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{nomeParceiro(d)}</TableCell>
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
                      <TableCell>
                        <AcoesDestino
                          onSegredo={() => abrirSegredo(d)}
                          onEditar={() => abrirEditar(d)}
                          onExcluir={() => setExcluirAlvo(d)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>

      {/* Dialog: novo destino */}
      <Dialog
        open={novoAberto}
        onOpenChange={(o) => {
          if (!criando) setNovoAberto(o);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo webhook</DialogTitle>
            <DialogDescription>
              Escolha o parceiro, a URL de entrega (https) e os eventos que ele deve receber.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Parceiro *</Label>
                <Select value={novoParceiro} onValueChange={setNovoParceiro}>
                  <SelectTrigger aria-label="Parceiro">
                    <SelectValue placeholder="Selecione o parceiro" />
                  </SelectTrigger>
                  <SelectContent>
                    {erroParceiros ? (
                      <div className="px-2 py-1.5 text-sm text-destructive">
                        Não foi possível carregar os parceiros
                      </div>
                    ) : parceiros.length === 0 ? (
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
                <Label htmlFor="novo-webhook-url" className="text-xs">
                  URL de entrega (https) *
                </Label>
                <Input
                  id="novo-webhook-url"
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
              <EscolhaEventos
                prefixo="novo-"
                marcados={novosEventos}
                alternar={(v) => toggleEvento(v, setNovosEventos)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Segredo de assinatura *</Label>
              <CampoSegredo
                valor={novoSegredo}
                mudar={setNovoSegredo}
                copiado={copiado}
                copiar={() => copiar(novoSegredo, setCopiado)}
                placeholder="Clique em Gerar para criar um segredo forte"
              />
              <p className="text-xs text-[var(--gold)] font-medium">
                Copie e entregue ao parceiro com segurança. Após salvar, o segredo não poderá mais
                ser visto - só redefinido.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoAberto(false)} disabled={criando}>
              Cancelar
            </Button>
            <Button onClick={criarDestino} disabled={criando}>
              {criando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Webhook className="h-4 w-4 mr-2" />
              Criar webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: editar url + eventos */}
      <Dialog
        open={editAlvo !== null}
        onOpenChange={(o) => {
          if (!editSalvando && !o) setEditAlvo(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar webhook</DialogTitle>
            <DialogDescription>
              Ajuste a URL de entrega e os eventos. O segredo não muda aqui - use "Redefinir
              segredo".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="editar-webhook-url" className="text-xs">
                URL de entrega (https)
              </Label>
              <Input
                id="editar-webhook-url"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://parceiro.com/webhooks/msv"
                inputMode="url"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Eventos</Label>
              <EscolhaEventos
                prefixo="edit-"
                marcados={editEventos}
                alternar={(v) => toggleEvento(v, setEditEventos)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditAlvo(null)} disabled={editSalvando}>
              Cancelar
            </Button>
            <Button onClick={salvarEdit} disabled={editSalvando}>
              {editSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
              Gere um novo segredo para {segredoAlvo ? nomeParceiro(segredoAlvo) : "este destino"}.
              O segredo antigo deixa de valer imediatamente - combine a troca com o parceiro.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Novo segredo</Label>
            <CampoSegredo
              valor={segredoNovo}
              mudar={setSegredoNovo}
              copiado={segredoCopiado}
              copiar={() => copiar(segredoNovo, setSegredoCopiado)}
              placeholder="Clique em Gerar"
            />
            <p className="text-xs text-[var(--gold)] font-medium">
              Copie antes de salvar - não será mostrado de novo.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSegredoAlvo(null)} disabled={segredoSalvando}>
              Cancelar
            </Button>
            <Button onClick={salvarSegredo} disabled={segredoSalvando}>
              {segredoSalvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
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
                  O destino <strong>{excluirAlvo ? nomeParceiro(excluirAlvo) : ""}</strong> deixará
                  de receber notificações. Esta ação é <strong>irreversível</strong> e o segredo
                  associado é descartado.
                </p>
                <p className="text-muted-foreground">
                  O histórico de entregas (webhook_eventos) é preservado para auditoria.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
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
    </Card>
  );
}
