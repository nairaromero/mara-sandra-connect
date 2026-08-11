// Dialog "Importar do Legalmail" — tela de Clientes, só interno.
//
// Traz os processos que existem no Legalmail e ainda não estão no sistema,
// agrupados POR CLIENTE, pra importar um de cada vez (pedido da Naira: migrar
// aos poucos, não tudo de uma vez).
//
// Por que o casamento é por nome, e por que ele nunca é automático:
// o Legalmail não devolve o CPF do polo ativo em nenhum endpoint aproveitável.
// Então a única chave possível é o nome, que admite homônimo. Medido contra a
// base em 11/08/2026: dos 397 nomes distintos no Legalmail, 27 casavam com
// exatamente 1 cliente e ZERO casavam com 2+. Mas "zero hoje" não é "zero
// sempre" — conforme a base cresce, colisão vira questão de tempo. Por isso:
//
//   - o vínculo é sempre PROPOSTO e confirmado por uma pessoa;
//   - 2+ candidatos (`ambiguo`) não vêm pré-selecionados — a pessoa escolhe;
//   - mostramos assunto, tribunal e órgão julgador junto, que é o que
//     desempata sem CPF;
//   - o número do processo fica visível pra conferência na fonte.
//
// Depois da primeira importação o risco some: a chave passa a ser o número do
// processo, que é exato. O nome só é usado uma vez por processo.
//
// A gravação é feita aqui (RLS permite interno inserir cliente/caso) e a parte
// de processo + movimentações é delegada à `sync-legalmail-caso`, que já existe
// e já é usada na tela do caso.

import { useMemo, useState } from "react";
import { Download, Loader2, Search, AlertTriangle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Match = "cliente_existe" | "cliente_novo" | "ambiguo" | "sem_nome";

interface ProcessoLM {
  legalmail_id: string;
  numero_processo: string | null;
  polo_ativo: string | null;
  polo_passivo: string | null;
  tribunal: string | null;
  orgao_julgador: string | null;
  assunto: string | null;
  nome_classe: string | null;
  data_distribuicao: string | null;
  match: Match;
  cliente_id: string | null;
  clientes_possiveis: Array<string> | null;
}

interface Resposta {
  total_legalmail: number;
  ja_no_sistema: number;
  novos: number;
  processos: Array<ProcessoLM>;
}

/** Um cliente do Legalmail = um nome + os processos dele. */
interface Grupo {
  nome: string;
  match: Match;
  cliente_id: string | null;
  clientes_possiveis: Array<string> | null;
  processos: Array<ProcessoLM>;
}

function agrupar(processos: Array<ProcessoLM>): Array<Grupo> {
  const mapa = new Map<string, Grupo>();
  for (const p of processos) {
    const chave = (p.polo_ativo ?? "").trim() || "__sem_nome__";
    const g = mapa.get(chave);
    if (g) {
      g.processos.push(p);
    } else {
      mapa.set(chave, {
        nome: p.polo_ativo ?? "",
        match: p.match,
        cliente_id: p.cliente_id,
        clientes_possiveis: p.clientes_possiveis,
        processos: [p],
      });
    }
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function BadgeMatch({ m }: { m: Match }) {
  if (m === "cliente_existe") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-700">
        Já existe cliente com esse nome
      </Badge>
    );
  }
  if (m === "ambiguo") {
    return <Badge variant="destructive">Vários clientes com esse nome</Badge>;
  }
  if (m === "sem_nome") {
    return <Badge variant="outline">Sem nome no Legalmail</Badge>;
  }
  return <Badge variant="secondary">Cliente novo</Badge>;
}

export function ImportarLegalmailDialog({ onImported }: { onImported: () => void }) {
  const { usuario } = useAuth();
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [resumo, setResumo] = useState<Resposta | null>(null);
  const [grupos, setGrupos] = useState<Array<Grupo>>([]);
  const [busca, setBusca] = useState("");

  // Passo 2: um grupo escolhido, aguardando confirmação.
  const [alvo, setAlvo] = useState<Grupo | null>(null);
  const [tipoBeneficio, setTipoBeneficio] = useState("");
  const [tipos, setTipos] = useState<Array<string>>([]);
  const [vincularAoExistente, setVincularAoExistente] = useState(true);
  const [importando, setImportando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const resp = await supabase.functions.invoke("listar-processos-legalmail", {
        body: { limite_novos: 2000 },
      });
      if (resp.error) throw resp.error;
      const data = resp.data as Resposta;
      setResumo(data);
      setGrupos(agrupar(data.processos ?? []));
      setCarregou(true);
    } catch (err) {
      console.error(err);
      toast.error(await mensagemDeErroEdge(err, "Falha ao consultar o Legalmail"));
    } finally {
      setCarregando(false);
    }
  }

  async function abrirConfirmacao(g: Grupo) {
    setAlvo(g);
    setVincularAoExistente(g.match === "cliente_existe");
    // Sugere o tipo pelo assunto do Legalmail, mas quem decide é a pessoa.
    const assunto = (g.processos[0]?.assunto ?? "").toLowerCase();
    setTipoBeneficio("");
    if (tipos.length === 0) {
      const resp = await supabase
        .from("tipos_beneficio")
        .select("nome")
        .eq("ativo", true)
        .order("ordem");
      const lista = ((resp.data as Array<{ nome: string }>) ?? []).map((t) => t.nome);
      setTipos(lista);
      const sugerido = lista.find((t) => {
        const n = t.toLowerCase();
        if (assunto.includes("acidente")) return n.includes("acidente");
        if (assunto.includes("tempo de contribu")) return n.includes("tempo de contribu");
        if (assunto.includes("idade")) return n.includes("idade");
        if (assunto.includes("incapacidade")) return n.includes("incapacidade");
        if (assunto.includes("pens")) return n.includes("pens");
        if (assunto.includes("loas") || assunto.includes("assistencial")) {
          return n.includes("LOAS") || n.includes("BPC");
        }
        return false;
      });
      if (sugerido) setTipoBeneficio(sugerido);
    }
  }

  async function importar() {
    if (!alvo || !usuario) return;
    if (!tipoBeneficio) {
      toast.error("Escolha o tipo de benefício");
      return;
    }
    const vincular = vincularAoExistente && alvo.match === "cliente_existe" && alvo.cliente_id;
    if (!vincular && !alvo.nome.trim()) {
      toast.error("Sem nome no Legalmail — cadastre o cliente à mão e importe pela tela do caso");
      return;
    }

    setImportando(true);
    try {
      // 1) Cliente: reaproveita o existente (se a pessoa confirmou) ou cria um
      //    novo. O Legalmail não dá CPF, então o cadastro nasce só com o nome e
      //    precisa ser completado depois.
      let clienteId = vincular ? (alvo.cliente_id as string) : null;
      if (!clienteId) {
        const ins = await supabase
          .from("clientes")
          .insert({ nome: alvo.nome.trim(), created_by: usuario.id })
          .select("id")
          .single();
        if (ins.error) throw ins.error;
        clienteId = (ins.data as { id: string }).id;
      }

      // 2) Caso
      const casoIns = await supabase
        .from("casos")
        .insert({ cliente_id: clienteId, tipo_beneficio: tipoBeneficio })
        .select("id")
        .single();
      if (casoIns.error) throw casoIns.error;
      const casoId = (casoIns.data as { id: string }).id;

      // 3) Processo + movimentações ficam com a função que já faz isso.
      const idprocessos = alvo.processos
        .map((p) => Number(p.legalmail_id))
        .filter((n) => Number.isFinite(n));
      const sync = await supabase.functions.invoke("sync-legalmail-caso", {
        body: { caso_id: casoId, usuario_id: usuario.id, idprocessos },
      });
      if (sync.error) throw sync.error;
      const s = sync.data as {
        processos_criados?: number;
        movimentacoes_importadas?: number;
        erros?: Array<{ idprocesso: number; motivo: string }>;
      };

      toast.success(
        `${alvo.nome || "Cliente"} importado: ${s.processos_criados ?? 0} processo(s), ` +
          `${s.movimentacoes_importadas ?? 0} movimentação(ões).` +
          (vincular ? " Vinculado ao cliente existente." : " Cliente criado — falta o CPF."),
      );
      if (s.erros?.length) {
        toast.warning(`${s.erros.length} processo(s) não vieram: ${s.erros[0].motivo}`);
      }

      // Tira o grupo importado da lista, pra ficar claro o que já foi feito.
      setGrupos((gs) => gs.filter((g) => g.nome !== alvo.nome));
      setAlvo(null);
      onImported();
    } catch (err) {
      console.error(err);
      toast.error(await mensagemDeErroEdge(err, "Falha ao importar do Legalmail"));
    } finally {
      setImportando(false);
    }
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return grupos;
    return grupos.filter((g) => g.nome.toLowerCase().includes(q));
  }, [grupos, busca]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setAlvo(null);
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Download className="h-4 w-4 mr-1" />
        Importar do Legalmail
      </Button>

      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {alvo === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Importar do Legalmail</DialogTitle>
              <DialogDescription>
                Processos que estão no Legalmail e ainda não estão aqui, agrupados por cliente.
                Importe um cliente de cada vez.
              </DialogDescription>
            </DialogHeader>

            {!carregou ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  A consulta lê o acervo inteiro do Legalmail e leva cerca de um minuto.
                </p>
                <Button onClick={carregar} disabled={carregando}>
                  {carregando ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Consultando o Legalmail…
                    </>
                  ) : (
                    "Buscar no Legalmail"
                  )}
                </Button>
              </div>
            ) : (
              <>
                {resumo && (
                  <p className="text-xs text-muted-foreground">
                    {resumo.total_legalmail} processos no Legalmail · {resumo.ja_no_sistema} já
                    cadastrados · <strong>{resumo.novos} novos</strong> em {grupos.length} clientes
                  </p>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Filtrar por nome do cliente"
                    className="pl-9"
                  />
                </div>

                <div className="space-y-2">
                  {filtrados.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum cliente para importar.
                    </p>
                  ) : (
                    filtrados.map((g) => (
                      <div
                        key={g.nome || "__sem_nome__"}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {g.nome || "(sem nome no Legalmail)"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {g.processos.length} processo(s) ·{" "}
                            {g.processos[0]?.assunto ?? "sem assunto"} ·{" "}
                            {g.processos[0]?.tribunal ?? "—"}
                          </div>
                          <div className="mt-1">
                            <BadgeMatch m={g.match} />
                          </div>
                        </div>
                        <Button size="sm" onClick={() => abrirConfirmacao(g)}>
                          Importar
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{alvo.nome || "(sem nome)"}</DialogTitle>
              <DialogDescription>
                Confira antes de importar. Nada é gravado até você confirmar.
              </DialogDescription>
            </DialogHeader>

            {(alvo.match === "cliente_existe" || alvo.match === "ambiguo") && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                  <div className="text-sm">
                    {alvo.match === "ambiguo" ? (
                      <>
                        <strong>
                          Há {alvo.clientes_possiveis?.length ?? 2} clientes com esse mesmo nome.
                        </strong>{" "}
                        O Legalmail não informa o CPF, então não dá para saber qual é. Cadastre pela
                        tela do caso, escolhendo o cliente à mão.
                      </>
                    ) : (
                      <>
                        Já existe um cliente com esse nome. Como o Legalmail não informa o CPF,
                        <strong> confirme que é a mesma pessoa</strong> — confira o número do
                        processo abaixo na fonte se tiver dúvida.
                      </>
                    )}
                  </div>
                </div>
                {alvo.match === "cliente_existe" && (
                  <div className="flex gap-2 pl-6">
                    <Button
                      size="sm"
                      variant={vincularAoExistente ? "default" : "outline"}
                      onClick={() => setVincularAoExistente(true)}
                    >
                      É a mesma pessoa
                    </Button>
                    <Button
                      size="sm"
                      variant={!vincularAoExistente ? "default" : "outline"}
                      onClick={() => setVincularAoExistente(false)}
                    >
                      É outra pessoa (criar novo)
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Processos que vêm junto ({alvo.processos.length})
              </Label>
              {alvo.processos.map((p) => (
                <div key={p.legalmail_id} className="rounded border border-border p-2 text-xs">
                  <div className="font-mono">{p.numero_processo ?? "—"}</div>
                  <div className="text-muted-foreground">
                    {p.assunto ?? "—"} · {p.tribunal ?? "—"} · {p.orgao_julgador ?? "—"}
                  </div>
                  <div className="text-muted-foreground">vs {p.polo_passivo ?? "—"}</div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Tipo de benefício</Label>
              <Select value={tipoBeneficio} onValueChange={setTipoBeneficio}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sugerido pelo assunto do processo — confira.
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setAlvo(null)} disabled={importando}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
              <Button
                onClick={importar}
                disabled={importando || alvo.match === "ambiguo" || !tipoBeneficio}
              >
                {importando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Importar este cliente
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
