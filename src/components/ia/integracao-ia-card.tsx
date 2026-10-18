// Card "IA do escritório" (Configurações › Integrações). Desde #451 (parte 2)
// a chave de IA é do ESCRITÓRIO, como Legalmail e TI: provedor + modelo em
// config e a chave cifrada na function `integracoes-escritorio` (tipo "ia"),
// que valida o modelo, audita a troca e nunca devolve a chave. A lista de
// provedores e modelos vem do status da function (uma fonte só, os perfis de
// modelo do servidor).

import { useCallback, useEffect, useState } from "react";
import { Selecao } from "@/components/ui/selecao";
import { toast } from "sonner";
import { Loader2, Sparkles, Save, Plug, ShieldCheck, Globe } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { dataHoraBR } from "@/lib/fuso";
import type { IaProviderInfo } from "@/lib/ia/client";

interface StatusIa {
  config: { provider?: string; modelo?: string; hint?: string };
  ativo: boolean;
  segredo_definido_em: string | null;
  updated_at: string | null;
  providers: Record<string, IaProviderInfo>;
}

async function chamar(body: Record<string, unknown>): Promise<unknown> {
  const resp = await supabase.functions.invoke("integracoes-escritorio", { body: { tipo: "ia", ...body } });
  if (resp.error) {
    let msg = resp.error.message;
    try {
      const ctx = (resp.error as { context?: Response }).context;
      if (ctx) msg = ((await ctx.json()) as { error?: string }).error ?? msg;
    } catch {
      /* sem corpo */
    }
    throw new Error(msg);
  }
  const dados = resp.data as { error?: string } | null;
  if (dados?.error) throw new Error(dados.error);
  return resp.data;
}

export function IntegracaoIaCard() {
  const [status, setStatus] = useState<StatusIa | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [modelo, setModelo] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; erro?: string } | null>(null);

  const carregar = useCallback(async () => {
    setErroCarga(null);
    try {
      const r = (await chamar({ action: "status" })) as StatusIa;
      setStatus(r);
      if (r.config?.provider) setProvider(r.config.provider);
      setModelo(r.config?.modelo ?? "");
    } catch (e) {
      // Falha de leitura não pode virar "não configurado" calado.
      setErroCarga(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const providers = status?.providers ?? {};
  const modelosSugeridos = providers[provider]?.models ?? [];
  const configurada = !!status?.segredo_definido_em;

  async function testar() {
    if (!modelo.trim()) {
      toast.error("Informe o modelo");
      return;
    }
    setTestando(true);
    setTeste(null);
    try {
      const r = (await chamar({
        action: "testar",
        config: { provider, modelo: modelo.trim() },
        segredo: apiKey.trim() || undefined,
      })) as { ok: boolean; erro?: string };
      setTeste(r);
      if (r.ok) toast.success("Conexão OK");
      else toast.error(r.erro || "Falha ao testar");
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      setTeste({ ok: false, erro });
      toast.error(erro);
    } finally {
      setTestando(false);
    }
  }

  async function salvar(extra: { ativo?: boolean } = {}) {
    if (!modelo.trim()) {
      toast.error("Informe o modelo");
      return;
    }
    setSalvando(true);
    try {
      await chamar({
        action: "salvar",
        config: { provider, modelo: modelo.trim() },
        segredo: apiKey.trim() || undefined,
        ...extra,
      });
      setApiKey("");
      toast.success(
        extra.ativo === false ? "IA do escritório desligada" : "IA do escritório salva",
      );
      await carregar();
    } catch (e) {
      toast.error(`Não salvou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card data-card-integracao="ia">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          IA do escritório
          {status && (
            <Badge
              variant={configurada && status.ativo ? "default" : "secondary"}
              className="ml-1"
              data-integracao-estado
            >
              {configurada ? (status.ativo ? "ativa" : "desligada") : "não configurada"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          A IA lê documentos, sugere a próxima tarefa e redige mensagens para toda a equipe. A
          chave é do escritório: o consumo é cobrado na conta do provedor cadastrada aqui.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {erroCarga && (
          <p className="text-sm text-destructive">
            Não consegui ler a IA do escritório: {erroCarga}
          </p>
        )}
        {status === null && !erroCarga && (
          <div className="flex h-20 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {status && (
          <div className="space-y-4">
            <div
              className="flex gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200"
              data-aviso-ia-dados
            >
              <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Com a IA ligada, documentos e dados dos clientes (inclusive laudos e dados de
                saúde) são enviados ao provedor escolhido, que processa fora do Brasil. O contrato
                com o provedor é do escritório: confira se ele proíbe usar os dados para treinar
                modelos e qual é o prazo de retenção.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Provedor</Label>
                <Selecao
                  value={provider}
                  onChange={setProvider}
                  opcoes={Object.entries(providers).map(([key, info]) => ({
                    value: key,
                    label: info.label,
                  }))}
                  placeholder="Escolha o provedor"
                />
              </div>
              <div>
                <Label className="text-xs">Modelo</Label>
                <Input
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  placeholder="ex.: claude-sonnet-5-5"
                  list="ia-modelos"
                />
                <datalist id="ia-modelos">
                  {modelosSugeridos.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <Label className="text-xs">Chave de API do escritório</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  configurada
                    ? `Chave salva${status.config.hint ? ` (${status.config.hint})` : ""} — cole para substituir`
                    : "Cole a chave de API do escritório"
                }
                autoComplete="off"
              />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />A chave é cifrada no servidor e nunca volta para
                a tela.
                {status.segredo_definido_em && <> Definida em {dataHoraBR(status.segredo_definido_em)}.</>}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={testar} disabled={testando}>
                {testando ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <Plug className="h-3 w-3 mr-2" />
                )}
                Testar conexão
              </Button>
              <Button size="sm" onClick={() => void salvar({ ativo: true })} disabled={salvando}>
                {salvando ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <Save className="h-3 w-3 mr-2" />
                )}
                Salvar e ativar
              </Button>
              {teste && (
                <span
                  className={teste.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}
                  data-ia-teste
                >
                  {teste.ok ? "Conexão OK" : teste.erro}
                </span>
              )}
            </div>

            {configurada && (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">IA ligada para o escritório</p>
                  <p className="text-xs text-muted-foreground">
                    Desligada, nenhuma tela usa IA e nada é enviado ao provedor.
                  </p>
                </div>
                <Switch
                  checked={status.ativo}
                  disabled={salvando}
                  onCheckedChange={(v) => void salvar({ ativo: v })}
                  aria-label="Ligar a IA do escritório"
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
