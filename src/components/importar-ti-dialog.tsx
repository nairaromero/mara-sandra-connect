import { useState } from "react";
import { Download, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TiCliente {
  ti_customer_id: number;
  nome: string;
  cpf: string;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  tags: unknown;
}

function formatCPF(cpf: string): string {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function ImportarTiDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [lista, setLista] = useState<Array<TiCliente>>([]);
  const [resumo, setResumo] = useState<
    { total_ti: number; ja_cadastrados: number } | null
  >(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [importando, setImportando] = useState(false);

  async function carregar() {
    setCarregando(true);
    setLista([]);
    setSel(new Set());
    try {
      const resp = await supabase.functions.invoke("listar-clientes-ti", {
        body: {},
      });
      if (resp.error) throw resp.error;
      const r = resp.data as {
        clientes?: Array<TiCliente>;
        total_ti?: number;
        ja_cadastrados?: number;
        error?: string;
      };
      if (r.error) {
        toast.error("Erro do TI: " + r.error);
        return;
      }
      setLista(r.clientes || []);
      setResumo({
        total_ti: r.total_ti || 0,
        ja_cadastrados: r.ja_cadastrados || 0,
      });
      setCarregou(true);
    } catch (err) {
      console.error(err);
      toast.error((err as { message?: string }).message || "Erro ao listar do TI");
    } finally {
      setCarregando(false);
    }
  }

  function abrir(o: boolean) {
    setOpen(o);
    if (o && !carregou) carregar();
  }

  function toggle(cpf: string) {
    setSel((p) => {
      const n = new Set(p);
      if (n.has(cpf)) n.delete(cpf);
      else n.add(cpf);
      return n;
    });
  }

  const q = busca.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const filtrados = lista.filter((c) => {
    if (!q) return true;
    if (c.nome.toLowerCase().includes(q)) return true;
    if (qDigits && c.cpf.includes(qDigits)) return true;
    return false;
  });
  const todosMarcados = filtrados.length > 0 &&
    filtrados.every((c) => sel.has(c.cpf));

  function toggleTodos() {
    setSel((p) => {
      const n = new Set(p);
      if (todosMarcados) filtrados.forEach((c) => n.delete(c.cpf));
      else filtrados.forEach((c) => n.add(c.cpf));
      return n;
    });
  }

  async function importar() {
    const escolhidos = lista.filter((c) => sel.has(c.cpf));
    if (escolhidos.length === 0) {
      toast.error("Selecione ao menos um cliente");
      return;
    }
    setImportando(true);
    let ok = 0;
    const cpfsOk = new Set<string>();
    const erros: Array<string> = [];
    try {
      for (const c of escolhidos) {
        const ins = await supabase
          .from("clientes")
          .insert({
            nome: c.nome || "(sem nome)",
            cpf: c.cpf,
            data_nascimento: c.data_nascimento,
            telefone: c.telefone,
            email: c.email,
            tags: (c.tags as unknown) ?? [],
            ti_customer_id: c.ti_customer_id,
          })
          .select("id")
          .single();
        if (ins.error || !ins.data) {
          erros.push(`${c.nome}: ${ins.error?.message || "erro"}`);
          continue;
        }
        const casoIns = await supabase.from("casos").insert({
          cliente_id: ins.data.id,
          tipo_beneficio: "Outro",
        });
        if (casoIns.error) {
          erros.push(`${c.nome} (caso): ${casoIns.error.message}`);
          continue;
        }
        ok++;
        cpfsOk.add(c.cpf);
      }
      if (ok > 0) {
        toast.success(
          `${ok} cliente${ok === 1 ? "" : "s"} importado${ok === 1 ? "" : "s"}` +
            " do TI (com caso 'Outro').",
        );
        onImported();
      }
      if (erros.length > 0) {
        console.warn("erros import TI:", erros);
        toast.warning(
          `${erros.length} cliente(s) falharam na importação. Ver console.`,
        );
      }
      // Remove os importados com sucesso da lista e da selecao.
      setLista((prev) => prev.filter((c) => !cpfsOk.has(c.cpf)));
      setSel((prev) => {
        const n = new Set(prev);
        cpfsOk.forEach((cpf) => n.delete(cpf));
        return n;
      });
    } finally {
      setImportando(false);
    }
  }

  const selCount = sel.size;

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <Button size="sm" variant="outline" onClick={() => abrir(true)}>
        <Download className="h-4 w-4 mr-2" />
        Importar do TI
      </Button>
      <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar clientes do Tramitação Inteligente</DialogTitle>
          <DialogDescription>
            {resumo
              ? `${lista.length} cliente(s) no TI ainda não cadastrado(s)` +
                ` (de ${resumo.total_ti}; ${resumo.ja_cadastrados} já existem).` +
                " Marque os que quer importar."
              : "Buscando clientes no TI..."}
          </DialogDescription>
        </DialogHeader>

        {carregando
          ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Carregando do TI (pode demorar alguns segundos)...
              </span>
            </div>
          )
          : lista.length === 0
          ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum cliente novo no TI para importar.
            </p>
          )
          : (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Filtrar por nome ou CPF"
                    className="pl-9"
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={toggleTodos}
                  disabled={filtrados.length === 0}
                >
                  {todosMarcados ? "Desmarcar" : "Marcar"} todos
                </Button>
              </div>
              <div className="max-h-[55vh] overflow-y-auto border rounded-md">
                <ul className="divide-y">
                  {filtrados.map((c) => (
                    <li
                      key={c.cpf}
                      className="flex items-center gap-3 p-3 hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={sel.has(c.cpf)}
                        onChange={() => toggle(c.cpf)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {c.nome || "(sem nome)"}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {formatCPF(c.cpf)}
                          {c.telefone ? " · " + c.telefone : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            size="sm"
            variant="ghost"
            onClick={carregar}
            disabled={carregando || importando}
            title="Recarregar lista do TI"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={importando}
            >
              Fechar
            </Button>
            <Button
              onClick={importar}
              disabled={importando || carregando || selCount === 0}
            >
              {importando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Importar selecionados ({selCount})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
