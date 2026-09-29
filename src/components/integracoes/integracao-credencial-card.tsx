// Card genérico de integração com credencial POR ESCRITÓRIO (Legalmail,
// Tramitação Inteligente): campos de config + chave/token cifrados na function
// `integracoes-escritorio` (nunca voltam ao navegador), Testar e o estado.
// Mesmo padrão do card do WhatsApp (integracao-whatsapp-card.tsx).
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Loader2, Save, PlugZap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { dataHoraBR } from "@/lib/fuso";
import { useIntegracoesEscritorio } from "@/hooks/use-integracoes";

interface Status {
  tipo: string;
  config: Record<string, string | undefined>;
  ativo: boolean;
  segredo_definido_em: string | null;
  updated_at: string | null;
}

export interface CampoCredencial {
  chave: string;
  rotulo: string;
  placeholder?: string;
}

export function IntegracaoCredencialCard(props: {
  tipo: "legalmail" | "ti";
  titulo: string;
  descricao: string;
  icone: ComponentType<{ className?: string }>;
  campos: Array<CampoCredencial>;
  rotuloSegredo: string;
  ajudaSegredo?: string;
}) {
  const { tipo, titulo, descricao, campos, rotuloSegredo, ajudaSegredo } = props;
  const Icone = props.icone;
  const integracoes = useIntegracoesEscritorio();
  const [status, setStatus] = useState<Status | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [segredo, setSegredo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; http?: number; erro?: string; detalhe?: string | null } | null>(null);

  const chamar = useCallback(
    async (body: Record<string, unknown>) => {
      const resp = await supabase.functions.invoke("integracoes-escritorio", { body: { tipo, ...body } });
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
      return resp.data as unknown;
    },
    [tipo],
  );

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = (await chamar({ action: "status" })) as Status;
      setStatus(r);
      const v: Record<string, string> = {};
      for (const c of campos) v[c.chave] = r.config?.[c.chave] ?? "";
      setValores(v);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [chamar, campos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(extra: { ativo?: boolean } = {}) {
    setSalvando(true);
    try {
      await chamar({ action: "salvar", config: valores, segredo: segredo || undefined, ...extra });
      setSegredo("");
      toast.success(`${titulo}: configuração salva.`);
      await carregar();
      integracoes.recarregar();
    } catch (e) {
      toast.error(`Não salvou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    try {
      const r = (await chamar({ action: "testar" })) as { ok: boolean; http?: number; erro?: string; detalhe?: string | null };
      setTeste(r);
    } catch (e) {
      setTeste({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestando(false);
    }
  }

  const legado = integracoes.lista?.find((i) => i.tipo === tipo)?.legado === true;
  const configurada = !!status?.segredo_definido_em;

  return (
    <Card data-card-integracao={tipo}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icone className="h-4 w-4" />
          {titulo}
          {status && (
            <Badge variant={configurada && status.ativo ? "default" : "secondary"} className="ml-1" data-integracao-estado>
              {configurada ? (status.ativo ? "ativo" : "desligado") : legado ? "configuração do sistema" : "não configurado"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {erro && <p className="text-sm text-red-700">Não consegui ler a integração: {erro}</p>}
        {status === null && !erro && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}
        {status && (
          <>
            {legado && !configurada && (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" data-integracao-legado>
                Este escritório ainda usa a credencial antiga do sistema. Cadastre a sua aqui para deixar de depender dela.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {campos.map((c) => (
                <div key={c.chave} className="space-y-1">
                  <Label htmlFor={`${tipo}-${c.chave}`}>{c.rotulo}</Label>
                  <Input
                    id={`${tipo}-${c.chave}`}
                    value={valores[c.chave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
                    placeholder={c.placeholder}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor={`${tipo}-segredo`}>
                  {rotuloSegredo}
                  {status.segredo_definido_em && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (definida em {dataHoraBR(status.segredo_definido_em)}; deixe em branco para manter)
                    </span>
                  )}
                </Label>
                <Input
                  id={`${tipo}-segredo`}
                  type="password"
                  value={segredo}
                  onChange={(e) => setSegredo(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                {ajudaSegredo && <p className="text-xs text-muted-foreground">{ajudaSegredo}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => salvar()} disabled={salvando}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={testar} disabled={testando || !configurada}>
                {testando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Testar conexão
              </Button>
              {configurada && (
                <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={status.ativo} disabled={salvando} onCheckedChange={(v) => salvar({ ativo: v })} aria-label="Integração ativa" />
                  ativa
                </label>
              )}
            </div>
            {teste && (
              <p className={"text-sm " + (teste.ok ? "text-emerald-700" : "text-red-700")} data-teste-integracao={tipo}>
                {teste.ok ? `Conectado (HTTP ${teste.http})` : `Falhou: ${teste.erro ?? `HTTP ${teste.http}`}${teste.detalhe ? ` — ${teste.detalhe}` : ""}`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
