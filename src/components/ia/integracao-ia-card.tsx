// Card "Integracao de IA" da tela de Configuracoes.
// Cada usuario (interno ou parceiro) escolhe provider + modelo e cola a propria
// chave (BYOK). A chave e cifrada na edge function; aqui nunca recebemos de volta
// a chave em claro, so um "hint" mascarado.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Save, Plug, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { iaConfig, IA_PROVIDERS, type IaProviderInfo } from "@/lib/ia/client";

export function IntegracaoIaCard() {
  const [carregando, setCarregando] = useState(true);
  const [providers, setProviders] = useState<Record<string, IaProviderInfo>>(IA_PROVIDERS);
  const [configurado, setConfigurado] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const [provider, setProvider] = useState("anthropic");
  const [modelo, setModelo] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [alternando, setAlternando] = useState(false);

  async function carregar() {
    const { data } = await iaConfig.status();
    if (data) {
      if (data.providers_suportados && Object.keys(data.providers_suportados).length) {
        setProviders(data.providers_suportados);
      }
      setConfigurado(data.configurado);
      setAtivo(data.ativo);
      setHint(data.hint);
      if (data.provider) setProvider(data.provider);
      if (data.modelo) setModelo(data.modelo);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  const modelosSugeridos = providers[provider]?.models ?? [];

  async function testar() {
    if (!modelo.trim()) {
      toast.error("Informe o modelo");
      return;
    }
    setTestando(true);
    const { data, error } = await iaConfig.testar({
      provider,
      modelo: modelo.trim(),
      api_key: apiKey.trim() || undefined,
    });
    setTestando(false);
    if (data?.ok) toast.success("Conexao OK");
    else toast.error(error?.message || "Falha ao testar");
  }

  async function salvar() {
    if (!modelo.trim()) {
      toast.error("Informe o modelo");
      return;
    }
    if (apiKey.trim().length < 12) {
      toast.error("Cole uma chave de API valida");
      return;
    }
    setSalvando(true);
    const { data, error } = await iaConfig.salvar({
      provider,
      modelo: modelo.trim(),
      api_key: apiKey.trim(),
      ativo: true,
    });
    setSalvando(false);
    if (data?.ok) {
      toast.success("Integracao salva e ativada");
      setApiKey("");
      await carregar();
    } else {
      toast.error(error?.message || "Falha ao salvar");
    }
  }

  async function alternarAtivo(novo: boolean) {
    setAlternando(true);
    const { data, error } = await iaConfig.ativar(novo);
    setAlternando(false);
    if (data?.ok) {
      setAtivo(data.ativo);
      toast.success(novo ? "Assistente ativado" : "Assistente desativado");
    } else {
      toast.error(error?.message || "Falha ao alterar");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Integracao de IA
        </CardTitle>
        <CardDescription>
          Conecte seu provedor de IA (cada um usa a propria chave). O assistente consulta seus dados
          e pode criar/atualizar registros (respeitando suas permissoes), sempre pedindo
          confirmacao.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {carregando ? (
          <div className="flex h-20 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Provedor</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o provedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(providers).map(([key, info]) => (
                      <SelectItem key={key} value={key}>
                        {info.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Modelo</Label>
                <Input
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  placeholder="ex.: claude-sonnet-4-5"
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
              <Label className="text-xs">Chave de API</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  configurado && hint
                    ? "Chave salva (" + hint + ") - cole para substituir"
                    : "Cole sua chave de API"
                }
                autoComplete="off"
              />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />A chave e cifrada no servidor e nunca volta para
                a tela.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={testar} disabled={testando}>
                {testando ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <Plug className="h-3 w-3 mr-2" />
                )}
                Testar conexao
              </Button>
              <Button size="sm" onClick={salvar} disabled={salvando}>
                {salvando ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <Save className="h-3 w-3 mr-2" />
                )}
                Salvar e ativar
              </Button>
            </div>

            {configurado && (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Assistente ativo</p>
                  <p className="text-xs text-muted-foreground">
                    Mostra o botao do assistente nas telas.
                  </p>
                </div>
                <Switch
                  checked={ativo}
                  disabled={alternando}
                  onCheckedChange={alternarAtivo}
                  aria-label="Ativar assistente"
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
