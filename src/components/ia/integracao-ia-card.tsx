// Card "IA do escritório" (Configurações › Integrações). Desde #451 (parte 2)
// a chave de IA é do ESCRITÓRIO, como Legalmail e TI: provedor + modelo em
// config e a chave cifrada na function `integracoes-escritorio` (tipo "ia"),
// que valida o modelo, audita a troca e nunca devolve a chave. A lista de
// provedores e modelos vem do status da function (uma fonte só, os perfis de
// modelo do servidor).

import { useCallback, useEffect, useState } from "react";
import { Selecao } from "@/components/ui/selecao";
import { toast } from "sonner";
import { Loader2, Sparkles, Save, Plug, ShieldCheck, Globe, ListChecks } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { dataBR, dataHoraBR } from "@/lib/fuso";
import type { IaProviderInfo } from "@/lib/ia/client";
import {
  ESFORCO_POR_TAREFA,
  lerEsforcos,
  NIVEIS_ESFORCO,
  ROTULO_ESFORCO,
  TAREFAS_IA,
  type Esforco,
  type EsforcosDoEscritorio,
  type TarefaIA,
} from "@shared/ia-esforco";
import { perfilDoModelo } from "@shared/ia-providers";

interface StatusIa {
  config: { provider?: string; modelo?: string; hint?: string; workspace_id?: string; esforcos?: unknown };
  ativo: boolean;
  segredo_definido_em: string | null;
  updated_at: string | null;
  providers: Record<string, IaProviderInfo>;
}

/** Um modelo que a chave enxerga (resposta da ação "modelos"). */
interface ModeloDaChave {
  id: string;
  nome: string;
  situacao: "ativo" | "descontinuado";
  lePdf: boolean | null;
  saiEm: string | null;
  recomendado: boolean;
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
  const [workspace, setWorkspace] = useState("");
  // Modelos que ESTA chave enxerga. É a lista de escolha do modelo (Naira,
  // 27/10: a lista recomendada fixa não fazia sentido se dá para perguntar à
  // chave). Com chave salva, carrega sozinha ao abrir a tela.
  const [daChave, setDaChave] = useState<ModeloDaChave[] | null>(null);
  const [listando, setListando] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  // De qual chave é a lista acima: a salva ou a colada agora (ainda não salva).
  const [listaDe, setListaDe] = useState<"salva" | "colada" | null>(null);
  // Esforço por tarefa que o escritório trocou (o resto segue o padrão do sistema).
  const [esforcos, setEsforcos] = useState<EsforcosDoEscritorio>({});
  const [salvandoEsforco, setSalvandoEsforco] = useState(false);

  const carregar = useCallback(async () => {
    setErroCarga(null);
    try {
      const r = (await chamar({ action: "status" })) as StatusIa;
      setStatus(r);
      if (r.config?.provider) setProvider(r.config.provider);
      setModelo(r.config?.modelo ?? "");
      setWorkspace(r.config?.workspace_id ?? "");
      setEsforcos(lerEsforcos(r.config?.esforcos));
    } catch (e) {
      // Falha de leitura não pode virar "não configurado" calado.
      setErroCarga(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const providers = status?.providers ?? {};

  /** O que vai à function: o workspace só existe para a Anthropic. */
  const configDaTela = () => ({
    provider,
    modelo: modelo.trim(),
    workspace_id: provider === "anthropic" ? workspace.trim() : "",
  });

  /** `salva`: confere a chave guardada no servidor, mesmo com algo colado no campo. */
  async function verModelos(qual: "tela" | "salva" = "tela") {
    const colada = qual === "salva" ? "" : apiKey.trim();
    setListando(true);
    setErroLista(null);
    setListaDe(colada ? "colada" : "salva");
    try {
      const r = (await chamar({
        action: "modelos",
        config: configDaTela(),
        segredo: colada || undefined,
      })) as { ok: boolean; erro?: string; modelos?: ModeloDaChave[] };
      if (!r.ok) {
        setDaChave(null);
        setErroLista(r.erro ?? "Não consegui listar os modelos desta chave.");
        return;
      }
      setDaChave(r.modelos ?? []);
    } catch (e) {
      setDaChave(null);
      setErroLista(e instanceof Error ? e.message : String(e));
    } finally {
      setListando(false);
    }
  }
  const configurada = !!status?.segredo_definido_em;

  // Com chave salva, a lista (e o selo de chave válida) vem sozinha ao abrir.
  // Listar não custa nada no provedor e não vira linha de uso.
  const [listouAoAbrir, setListouAoAbrir] = useState(false);
  useEffect(() => {
    if (!status || listouAoAbrir) return;
    setListouAoAbrir(true);
    if (status.segredo_definido_em) void verModelos("salva");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na primeira carga do status
  }, [status, listouAoAbrir]);

  // O selo da chave. "Válida" = o provedor respondeu à lista de modelos com ela.
  const chave: { texto: string; tom: "ok" | "erro" | "neutro" | "espera"; titulo?: string } = apiKey.trim()
    ? listaDe === "colada" && daChave && !listando
      ? { texto: "chave nova válida — falta salvar", tom: "ok" }
      : listaDe === "colada" && erroLista && !listando
        ? { texto: "chave nova recusada", tom: "erro", titulo: erroLista }
        : { texto: "chave nova — não conferida", tom: "neutro" }
    : !configurada
      ? { texto: "sem chave", tom: "neutro" }
      : listando
        ? { texto: "conferindo a chave…", tom: "espera" }
        : listaDe === "salva" && daChave
          ? { texto: `chave salva e válida${status?.config.hint ? ` · ${status.config.hint}` : ""}`, tom: "ok" }
          : listaDe === "salva" && erroLista
            ? { texto: "chave salva, mas recusada pelo provedor", tom: "erro", titulo: erroLista }
            : { texto: `chave salva${status?.config.hint ? ` · ${status.config.hint}` : ""}`, tom: "neutro" };
  const corDoSelo = {
    ok: "border-emerald-500/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
    erro: "border-destructive/50 bg-destructive/10 text-destructive",
    neutro: "border-border bg-muted text-muted-foreground",
    espera: "border-border bg-muted text-muted-foreground",
  }[chave.tom];
  // O modelo salvo continua visível mesmo se a chave não o enxergar mais.
  const modeloForaDaLista = !!daChave && !!modelo.trim() && !daChave.some((m) => m.id === modelo.trim());

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
        config: configDaTela(),
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

  // O que está na tela difere do salvo?
  const esforcosSalvos = lerEsforcos(status?.config.esforcos);
  const tarefasNaTela = (Object.keys(TAREFAS_IA) as TarefaIA[]).filter((t) => TAREFAS_IA[t].naTela);
  const esforcoMudou = tarefasNaTela.some((t) => esforcos[t] !== esforcosSalvos[t]);
  // Haiku 4.5, OpenAI, Opus 4.x sem raciocínio: o modelo não recebe esforço.
  const perfilAtual = perfilDoModelo(provider, modelo.trim());
  const modeloRecebeEsforco =
    !!perfilAtual.esforco && perfilAtual.raciocinio !== "nenhum" && perfilAtual.raciocinio !== "desligado";

  async function salvarEsforcos() {
    setSalvandoEsforco(true);
    try {
      // Só o esforço: provedor, modelo, chave e ligado/desligado ficam como estão.
      await chamar({ action: "salvar", config: { esforcos } });
      toast.success("Esforço da IA salvo");
      await carregar();
    } catch (e) {
      toast.error(`Não salvou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvandoEsforco(false);
    }
  }

  async function salvar(extra: { ativo?: boolean } = {}) {
    if (!modelo.trim()) {
      toast.error("Informe o modelo");
      return;
    }
    setSalvando(true);
    const trocouChave = !!apiKey.trim();
    try {
      await chamar({
        action: "salvar",
        config: configDaTela(),
        segredo: apiKey.trim() || undefined,
        ...extra,
      });
      setApiKey("");
      // A chave nova agora é a salva: confere de novo para o selo e a lista.
      if (trocouChave) void verModelos("salva");
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

            <div>
              <div>
                <Label className="text-xs">Provedor</Label>
                <Selecao
                  value={provider}
                  onChange={(v) => {
                    setProvider(v);
                    setDaChave(null);
                    setErroLista(null);
                    setListaDe(null);
                  }}
                  opcoes={Object.entries(providers).map(([key, info]) => ({
                    value: key,
                    label: info.label,
                  }))}
                  placeholder="Escolha o provedor"
                />
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs">Chave de API do escritório</Label>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${corDoSelo}`}
                  title={chave.titulo}
                  data-ia-chave-estado={chave.tom}
                >
                  {chave.tom === "espera" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {chave.tom === "ok" && <ShieldCheck className="h-3 w-3" />}
                  {chave.texto}
                </span>
              </div>
              <Input semGerenciadorDeSenha
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  // Chave nova: a lista e o selo da anterior não valem mais.
                  if (listaDe === "colada" || e.target.value.trim()) {
                    setDaChave(null);
                    setErroLista(null);
                    setListaDe(null);
                  }
                }}
                placeholder={
                  configurada
                    ? `Chave salva${status.config.hint ? ` (${status.config.hint})` : ""} — cole para substituir`
                    : "Cole a chave de API do escritório"
                }
              />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />A chave é cifrada no servidor e nunca volta para
                a tela.
                {status.segredo_definido_em && <> Definida em {dataHoraBR(status.segredo_definido_em)}.</>}
              </p>
            </div>

            {provider === "anthropic" && (
              <div>
                <Label className="text-xs" htmlFor="ia-workspace">
                  ID do workspace da Anthropic (opcional)
                </Label>
                <Input semGerenciadorDeSenha
                  id="ia-workspace"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="wrkspc_…"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Só para chave que vale para mais de um workspace. Chave criada dentro de um
                  workspace (Console da Anthropic › Workspaces) não precisa disto.
                </p>
              </div>
            )}

            <div className="space-y-2" data-ia-modelo>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs">
                  Modelo
                  {modelo.trim() && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      escolhido: <span className="font-mono text-foreground">{modelo.trim()}</span>
                    </span>
                  )}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void verModelos()}
                  disabled={listando || (!configurada && !apiKey.trim())}
                  data-ia-ver-modelos
                >
                  {listando ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <ListChecks className="h-3 w-3 mr-2" />}
                  {daChave ? "Atualizar modelos" : "Ver modelos desta chave"}
                </Button>
              </div>
              {erroLista && <p className="text-xs text-destructive">{erroLista}</p>}
              {!daChave && !erroLista && !listando && (
                <p className="text-xs text-muted-foreground">
                  {configurada || apiKey.trim()
                    ? "Clique em \u201cVer modelos desta chave\u201d para escolher entre os modelos que ela enxerga."
                    : "Cole a chave acima e clique em \u201cVer modelos desta chave\u201d."}
                </p>
              )}
              {daChave && (
                <div className="rounded-md border p-2" data-ia-modelos-da-chave>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {daChave.length} modelo(s) disponível(is) nesta chave. Clique para escolher.
                  </p>
                  {modeloForaDaLista && (
                    <p className="mb-1 text-xs text-destructive">
                      O modelo escolhido ({modelo.trim()}) não está entre os desta chave — escolha outro.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {daChave.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModelo(m.id)}
                        title={m.nome}
                        aria-pressed={m.id === modelo.trim()}
                        className={
                          "rounded-full border px-2 py-0.5 text-xs " +
                          (m.id === modelo.trim()
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted")
                        }
                        data-modelo={m.id}
                      >
                        {m.id}
                        {m.recomendado && " · recomendado"}
                        {m.lePdf === false && " · não lê PDF"}
                        {m.situacao === "descontinuado" &&
                          ` · sai do ar${m.saiEm ? " em " + dataBR(m.saiEm) : ""}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

            {configurada && (
              <div className="space-y-3 rounded-md border border-border px-3 py-3" data-ia-esforco>
                <div>
                  <p className="text-sm font-medium">Esforço do raciocínio por tarefa</p>
                  <p className="text-xs text-muted-foreground">
                    Quanto a IA pensa antes de responder. Mais esforço: respostas mais cuidadosas,
                    porém mais lentas e com mais consumo na conta do provedor. Cada chamada fica
                    registrada com o esforço usado.
                  </p>
                  {!modeloRecebeEsforco && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-ia-esforco-sem-efeito>
                      O modelo escolhido ({modelo.trim() || "nenhum"}) não recebe esforço: estas
                      escolhas passam a valer com um modelo que recebe (Claude Opus 5.5, Sonnet 5.5).
                    </p>
                  )}
                </div>
                <div className="divide-y">
                  {tarefasNaTela.map((t) => {
                    const padrao = ESFORCO_POR_TAREFA[t];
                    return (
                      <div key={t} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="text-sm">{TAREFAS_IA[t].rotulo}</span>
                        <div className="w-48">
                          <Selecao
                            value={esforcos[t] ?? "padrao"}
                            onChange={(v) =>
                              setEsforcos((atual) => {
                                const novo = { ...atual };
                                if (v === "padrao" || v === padrao) delete novo[t];
                                else novo[t] = v as Esforco;
                                return novo;
                              })
                            }
                            opcoes={[
                              { value: "padrao", label: `Padrão (${ROTULO_ESFORCO[padrao]})` },
                              ...NIVEIS_ESFORCO.filter((n) => n !== padrao).map((n) => ({
                                value: n,
                                label: ROTULO_ESFORCO[n],
                              })),
                            ]}
                            aria-label={`Esforço: ${TAREFAS_IA[t].rotulo}`}
                            data-selecao={`esforco-${t}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void salvarEsforcos()}
                    disabled={!esforcoMudou || salvandoEsforco}
                    data-ia-salvar-esforco
                  >
                    {salvandoEsforco ? (
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-2" />
                    )}
                    Salvar esforço
                  </Button>
                  {esforcoMudou && <span className="text-xs text-muted-foreground">Alterações não salvas.</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
