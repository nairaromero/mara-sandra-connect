// Card "WhatsApp (Evolution)" em Configuracoes -> Integracoes: a instancia do
// Evolution DESTE escritorio. Tudo passa pela edge function
// integracoes-escritorio (a chave da API e cifrada la e nunca volta); o card
// so le config sem segredo. Quem ve/mexe: quem gerencia integracoes (admin).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, KeyRound, Loader2, MessageCircle, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { dataHoraBR } from "@/lib/fuso";
import { useAuth } from "@/hooks/use-auth";

interface StatusWhatsapp {
  config: { base_url?: string; instance?: string; inbound_token?: string; numero?: string };
  ativo: boolean;
  segredo_definido_em: string | null;
  updated_at: string | null;
}

async function chamar(body: Record<string, unknown>) {
  const resp = await supabase.functions.invoke("integracoes-escritorio", { body: { tipo: "whatsapp", ...body } });
  const r = (resp.data ?? {}) as Record<string, unknown>;
  if (resp.error || r.error) {
    let msg = (r.error as string | undefined) ?? resp.error?.message ?? "Falha";
    const ctx = (resp.error as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === "function") {
      const corpo = (await ctx.json().catch(() => null)) as { error?: string } | null;
      if (corpo?.error) msg = corpo.error;
    }
    throw new Error(msg);
  }
  return r;
}

export function IntegracaoWhatsappCard() {
  const { usuario, pode } = useAuth();
  const [status, setStatus] = useState<StatusWhatsapp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [instance, setInstance] = useState("");
  const [numero, setNumero] = useState("");
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; estado: string | null; erro?: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = (await chamar({ action: "status" })) as unknown as StatusWhatsapp;
      setStatus(r);
      setErro(null);
      setBaseUrl(r.config?.base_url ?? "");
      setInstance(r.config?.instance ?? "");
      setNumero(r.config?.numero ?? "");
    } catch (e) {
      // erro NAO vira "sem integracao"
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (usuario?.id) void carregar();
  }, [carregar, usuario?.id]);

  async function salvar(extra: Record<string, unknown> = {}) {
    setSalvando(true);
    try {
      await chamar({ action: "salvar", config: { base_url: baseUrl, instance, numero }, segredo: chave || undefined, ...extra });
      setChave("");
      toast.success("Integração do WhatsApp salva.");
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function gerarToken() {
    setSalvando(true);
    try {
      await chamar({ action: "gerar_token" });
      toast.success("Token de entrada novo. Atualize o webhook no Evolution.");
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    try {
      const r = (await chamar({ action: "testar" })) as unknown as { ok: boolean; estado: string | null; erro?: string; detalhe?: string | null };
      setTeste({ ok: r.ok, estado: r.estado ?? null, erro: r.erro ?? r.detalhe ?? undefined });
    } catch (e) {
      setTeste({ ok: false, estado: null, erro: (e as Error).message });
    } finally {
      setTestando(false);
    }
  }

  if (usuario && (usuario.tipo !== "interno" || !pode("integracoes:gerenciar"))) return null;

  const webhookUrl =
    typeof window !== "undefined" && status?.config?.inbound_token
      ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-inbound?token=${status.config.inbound_token}`
      : null;

  return (
    <Card data-card-whatsapp>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          WhatsApp (Evolution)
          {status && (
            <Badge variant={status.ativo && status.config?.instance ? "default" : "secondary"} className="ml-1">
              {status.config?.instance ? (status.ativo ? "ativo" : "desligado") : "não configurado"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          A instância do Evolution <strong>deste escritório</strong>: por ela chegam as mensagens dos parceiros
          e saem as respostas. A chave da API fica cifrada no servidor e nunca volta para o navegador.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Saída (mensagens do sistema ao parceiro): a fila é drenada pela function
            whatsapp-outbox-enviar (pg_cron, sem n8n) com a chave DESTE escritório.
            A saída está pausada desde 20/08 (migration_pausa_whatsapp_saida);
            retomar é decisão do escritório padrão. Entrada e teste seguem valendo. */}
        <p className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" data-whatsapp-envio="pausado">
          <Badge variant="secondary">Pausado</Badge>
          Envio de mensagens pelo sistema: a fila é entregue por esta instância (sem n8n), mas a saída está pausada até ser retomada.
        </p>
        {erro && <p className="text-sm text-red-700">Não consegui ler a integração: {erro}</p>}
        {status === null && !erro && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}
        {status !== null && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="wa-url">URL do Evolution</Label>
                <Input id="wa-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://evo.exemplo.com" />
              </div>
              <div>
                <Label htmlFor="wa-inst">Instância</Label>
                <Input id="wa-inst" value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="meu-escritorio" />
              </div>
              <div>
                <Label htmlFor="wa-num">Número (opcional, só para exibir)</Label>
                <Input id="wa-num" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="55 11 99999-0000" />
              </div>
              <div>
                <Label htmlFor="wa-key">
                  Chave da API{" "}
                  {status.segredo_definido_em && (
                    <span className="text-xs font-normal text-muted-foreground">
                      (definida em {dataHoraBR(status.segredo_definido_em)}; deixe em branco para manter)
                    </span>
                  )}
                </Label>
                <Input id="wa-key" type="password" value={chave} onChange={(e) => setChave(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => salvar()} disabled={salvando || !baseUrl.trim() || !instance.trim()}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={testar} disabled={testando || !status.config?.instance}>
                {testando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Testar conexão
              </Button>
              <label className="ml-auto flex items-center gap-2 text-sm">
                <Switch checked={status.ativo} disabled={salvando || !status.config?.instance} onCheckedChange={(v) => salvar({ ativo: v })} aria-label="Integração ativa" />
                {status.ativo ? "Ativa" : "Desligada"}
              </label>
            </div>
            {teste && (
              <p className={"flex items-center gap-2 text-sm " + (teste.ok ? "text-emerald-700" : "text-red-700")} data-teste-whatsapp>
                {teste.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {teste.ok ? `Conectado — estado: ${teste.estado ?? "?"}` : `Falhou: ${teste.erro ?? "sem resposta"}`}
              </p>
            )}
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Webhook de entrada (configurar no Evolution)</span>
                <Button size="sm" variant="ghost" onClick={gerarToken} disabled={salvando || !status.config?.instance}>
                  {status.config?.inbound_token ? "Gerar token novo" : "Gerar token"}
                </Button>
              </div>
              {webhookUrl ? (
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs" data-webhook-url>
                    {webhookUrl}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="Copiar URL do webhook"
                    onClick={() => {
                      void navigator.clipboard.writeText(webhookUrl).then(() => toast.success("URL copiada."), () => toast.error("Não consegui copiar."));
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Salve a instância e gere o token: a URL aparece aqui.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
