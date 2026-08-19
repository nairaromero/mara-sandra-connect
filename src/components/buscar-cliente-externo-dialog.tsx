// Seletores de cliente das fontes externas, na tela de Novo caso.
//
// A ideia (pedido da Naira): na hora de abrir o caso, em vez de digitar tudo,
// você abre a caixa, procura a pessoa PELO NOME e o formulário se preenche.
// Um cliente por vez — é assim que ela quer migrar, aos poucos.
//
// Antes existia um "Buscar no TI" que exigia digitar o CPF antes. Não servia:
// quem está cadastrando geralmente tem o nome, não o CPF decorado. E existia
// uma importação em LOTE na tela de Clientes, que é o oposto de migrar aos
// poucos. As duas saíram; ficou só isto.
//
// Duas fontes, com forças opostas:
//   TI        — devolve CPF, nascimento, telefone e e-mail. Casa por CPF, então
//               preenche o cadastro quase inteiro e não tem risco de trocar
//               pessoa.
//   Legalmail — devolve só o nome do polo ativo (a API não expõe CPF em lugar
//               nenhum aproveitável), mas traz os processos judiciais e as
//               movimentações. Por isso o nome vem com um aviso quando já
//               existe alguém com aquele nome no sistema.

import { useMemo, useState } from "react";
import { Loader2, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { formatarTelefone } from "@/lib/telefone";
import { mensagemDeErroEdge } from "@/lib/edge-function-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// TI
// ---------------------------------------------------------------------------

export interface ClienteTi {
  ti_customer_id: number;
  nome: string;
  cpf: string;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
}

export function BuscarNoTiDialog({ onEscolher }: { onEscolher: (c: ClienteTi) => void }) {
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [lista, setLista] = useState<Array<ClienteTi>>([]);
  const [resumo, setResumo] = useState<{ total_ti: number; ja_cadastrados: number } | null>(null);
  const [busca, setBusca] = useState("");

  async function carregar() {
    setCarregando(true);
    try {
      const resp = await supabase.functions.invoke("listar-clientes-ti", { body: {} });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        clientes?: Array<ClienteTi>;
        total_ti?: number;
        ja_cadastrados?: number;
        error?: string;
      };
      if (r.error) {
        toast.error("Erro do TI: " + r.error);
        return;
      }
      setLista(r.clientes ?? []);
      setResumo({ total_ti: r.total_ti ?? 0, ja_cadastrados: r.ja_cadastrados ?? 0 });
      setCarregou(true);
    } catch (err) {
      console.error(err);
      toast.error(await mensagemDeErroEdge(err, "Falha ao listar clientes do TI"));
    } finally {
      setCarregando(false);
    }
  }

  function abrir(o: boolean) {
    setOpen(o);
    if (o && !carregou && !carregando) carregar();
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    if (!q) return lista;
    return lista.filter(
      (c) => c.nome.toLowerCase().includes(q) || (qd.length > 0 && (c.cpf || "").includes(qd)),
    );
  }, [lista, busca]);

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <Button type="button" variant="outline" size="sm" onClick={() => abrir(true)}>
        <Search className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">Buscar no TI</span>
      </Button>

      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Buscar cliente no Tramitação Inteligente</DialogTitle>
          <DialogDescription>
            {resumo
              ? `${lista.length} cliente(s) no TI ainda não cadastrados aqui ` +
                `(de ${resumo.total_ti}; ${resumo.ja_cadastrados} já existem). ` +
                "Clique num nome pra preencher o formulário."
              : "Procure pelo nome e clique pra preencher o formulário."}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Carregando do TI…</span>
          </div>
        ) : lista.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente novo no TI.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Digite o nome do cliente"
                className="pl-9"
              />
            </div>
            <div className="overflow-y-auto rounded-md border border-border">
              <ul className="divide-y">
                {filtrados.map((c) => (
                  <li key={c.cpf || c.ti_customer_id}>
                    <button
                      type="button"
                      className="w-full text-left p-3 hover:bg-muted/50"
                      onClick={() => {
                        onEscolher(c);
                        setOpen(false);
                      }}
                    >
                      <div className="text-sm font-medium">{c.nome || "(sem nome)"}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {c.cpf || "sem CPF"}
                        {c.telefone ? " · " + formatarTelefone(c.telefone) : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Legalmail
// ---------------------------------------------------------------------------

type Match = "cliente_existe" | "cliente_novo" | "ambiguo" | "sem_nome";

interface ProcessoLM {
  legalmail_id: string;
  numero_processo: string | null;
  polo_ativo: string | null;
  polo_passivo: string | null;
  tribunal: string | null;
  orgao_julgador: string | null;
  assunto: string | null;
  match: Match;
}

export interface GrupoLegalmail {
  nome: string;
  match: Match;
  processos: Array<ProcessoLM>;
}

export function BuscarNoLegalmailDialog({
  onEscolher,
}: {
  onEscolher: (g: GrupoLegalmail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [grupos, setGrupos] = useState<Array<GrupoLegalmail>>([]);
  const [busca, setBusca] = useState("");

  async function carregar() {
    setCarregando(true);
    try {
      const resp = await supabase.functions.invoke("listar-processos-legalmail", {
        body: { limite_novos: 2000 },
      });
      if (resp.error) throw resp.error;
      const data = resp.data as { processos?: Array<ProcessoLM> };
      const mapa = new Map<string, GrupoLegalmail>();
      for (const p of data.processos ?? []) {
        const chave = (p.polo_ativo ?? "").trim();
        if (!chave) continue; // sem nome não dá pra escolher por nome
        const g = mapa.get(chave);
        if (g) g.processos.push(p);
        else mapa.set(chave, { nome: chave, match: p.match, processos: [p] });
      }
      setGrupos([...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
      setCarregou(true);
    } catch (err) {
      console.error(err);
      toast.error(await mensagemDeErroEdge(err, "Falha ao consultar o Legalmail"));
    } finally {
      setCarregando(false);
    }
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return grupos;
    return grupos.filter((g) => g.nome.toLowerCase().includes(q));
  }, [grupos, busca]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">Buscar no Legalmail</span>
      </Button>

      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Buscar cliente no Legalmail</DialogTitle>
          <DialogDescription>
            Clique num nome pra preencher o cadastro. Os processos e as movimentações daquela pessoa
            entram junto quando você salvar o caso.
          </DialogDescription>
        </DialogHeader>

        {!carregou ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              A consulta lê o acervo inteiro do Legalmail e leva cerca de um minuto.
            </p>
            <Button type="button" onClick={carregar} disabled={carregando}>
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Consultando…
                </>
              ) : (
                "Buscar no Legalmail"
              )}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {grupos.length} cliente(s) com processo no Legalmail e sem cadastro aqui.
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Digite o nome do cliente"
                className="pl-9"
              />
            </div>
            <div className="overflow-y-auto rounded-md border border-border">
              <ul className="divide-y">
                {filtrados.map((g) => (
                  <li key={g.nome}>
                    <button
                      type="button"
                      className="w-full text-left p-3 hover:bg-muted/50"
                      onClick={() => {
                        onEscolher(g);
                        setOpen(false);
                      }}
                    >
                      <div className="text-sm font-medium flex items-center gap-2">
                        {g.nome}
                        {g.match !== "cliente_novo" && (
                          <Badge variant="outline" className="border-amber-500 text-amber-700">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            já existe cliente com esse nome
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {g.processos.length} processo(s) ·{" "}
                        {g.processos[0]?.assunto ?? "sem assunto"} ·{" "}
                        {g.processos[0]?.tribunal ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {g.processos[0]?.numero_processo ?? "—"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
