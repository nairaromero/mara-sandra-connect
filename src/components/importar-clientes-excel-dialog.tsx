// =============================================================================
// Dialog de importacao de clientes via Excel.
//
// Fluxo:
//   1) Usuario escolhe arquivo .xlsx
//   2) Parse + valida (Nome, CPF obrigatorios; CPF com 11 digitos)
//   3) Mostra preview (N linhas, com badges de status: novo / duplicado / erro)
//   4) Confirma -> processa: pula CPFs ja cadastrados, importa novos com
//      cliente + caso + processos + andamento + etiquetas
//   5) Relatorio final
//
// 1 linha do Excel = 1 caso. Mesmo CPF em varias linhas = mesmo cliente,
// varios casos. Conflitos so no nivel de CPF (cliente).
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Upload,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import {
  lerExcel,
  parseDataBr,
  faseValueDe,
  statusValueDe,
  type LinhaImport,
} from "@/lib/clientes-excel";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ImportarClientesExcelDialogProps {
  aberto: boolean;
  onFechar: () => void;
  onImported: () => void;
}

interface LinhaProcessada {
  index: number; // numero da linha no Excel (1-based, descontando cabecalho)
  raw: LinhaImport;
  cpfDigits: string;
  status: "novo" | "duplicado" | "erro";
  erro: string | null;
}

interface Resultado {
  clientesCriados: number;
  clientesPulados: number;
  casosCriados: number;
  errosLinha: Array<{ linha: number; cpf: string; msg: string }>;
}

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

export function ImportarClientesExcelDialog(
  props: ImportarClientesExcelDialogProps,
) {
  const { aberto, onFechar, onImported } = props;

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [linhas, setLinhas] = useState<Array<LinhaProcessada>>([]);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Reseta quando fecha
  useEffect(() => {
    if (!aberto) {
      setArquivo(null);
      setLinhas([]);
      setResultado(null);
      setParsing(false);
      setImportando(false);
    }
  }, [aberto]);

  async function handleArquivo(file: File) {
    setArquivo(file);
    setLinhas([]);
    setResultado(null);
    setParsing(true);
    try {
      const lidas = await lerExcel(file);
      if (lidas.length === 0) {
        toast.error("Planilha sem linhas");
        setParsing(false);
        return;
      }

      // Valida cada linha localmente
      const validadas: Array<LinhaProcessada> = lidas.map((raw, i) => {
        const nome = (raw["Nome"] || "").trim();
        const cpfDigits = onlyDigits(raw["CPF"]);
        if (!nome) {
          return {
            index: i + 2,
            raw,
            cpfDigits,
            status: "erro",
            erro: "Nome vazio",
          };
        }
        if (cpfDigits.length !== 11) {
          return {
            index: i + 2,
            raw,
            cpfDigits,
            status: "erro",
            erro: "CPF invalido (precisa 11 digitos)",
          };
        }
        return {
          index: i + 2,
          raw,
          cpfDigits,
          status: "novo",
          erro: null,
        };
      });

      // Checa CPFs ja existentes no banco
      const cpfsParaVerificar = Array.from(
        new Set(
          validadas
            .filter((l) => l.status === "novo")
            .map((l) => l.cpfDigits),
        ),
      );
      if (cpfsParaVerificar.length > 0) {
        const existResp = await supabase
          .from("clientes")
          .select("cpf")
          .in("cpf", cpfsParaVerificar);
        if (existResp.error) throw existResp.error;
        const existentes = new Set(
          (existResp.data || []).map((r: { cpf: string }) => r.cpf),
        );
        for (const l of validadas) {
          if (l.status === "novo" && existentes.has(l.cpfDigits)) {
            l.status = "duplicado";
          }
        }
      }

      setLinhas(validadas);
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro ao ler planilha");
    } finally {
      setParsing(false);
    }
  }

  // Lookup de parceiros por nome (pra atribuir parceiro_id no caso)
  async function buscarParceirosPorNome(nomes: Array<string>): Promise<Map<string, string>> {
    const set = new Set(nomes.filter((n) => n.trim().length > 0));
    const map = new Map<string, string>();
    if (set.size === 0) return map;
    const resp = await supabase
      .from("usuarios")
      .select("id, nome")
      .eq("tipo", "parceiro")
      .in("nome", Array.from(set));
    if (resp.error) {
      console.warn("falha ao buscar parceiros:", resp.error);
      return map;
    }
    for (const u of (resp.data || []) as Array<{ id: string; nome: string }>) {
      map.set(u.nome, u.id);
    }
    return map;
  }

  // Upsert de etiquetas por nome (ja tem UNIQUE em etiquetas.nome).
  async function obterIdsEtiquetas(nomes: Array<string>): Promise<Map<string, string>> {
    const set = Array.from(new Set(nomes.map((n) => n.trim()).filter((n) => n.length > 0)));
    const out = new Map<string, string>();
    if (set.length === 0) return out;
    // Busca existentes
    const existResp = await supabase
      .from("etiquetas")
      .select("id, nome")
      .in("nome", set);
    if (existResp.error) throw existResp.error;
    const existentes = (existResp.data || []) as Array<{ id: string; nome: string }>;
    for (const e of existentes) out.set(e.nome, e.id);
    // Cria as que faltam
    const faltantes = set.filter((n) => !out.has(n));
    if (faltantes.length > 0) {
      const insResp = await supabase
        .from("etiquetas")
        .insert(faltantes.map((nome) => ({ nome })))
        .select("id, nome");
      if (insResp.error) throw insResp.error;
      for (const e of (insResp.data || []) as Array<{ id: string; nome: string }>) {
        out.set(e.nome, e.id);
      }
    }
    return out;
  }

  async function processarImport() {
    const aImportar = linhas.filter((l) => l.status === "novo");
    if (aImportar.length === 0) {
      toast.error("Nenhuma linha nova pra importar");
      return;
    }
    setImportando(true);
    const res: Resultado = {
      clientesCriados: 0,
      clientesPulados: linhas.filter((l) => l.status === "duplicado").length,
      casosCriados: 0,
      errosLinha: [],
    };

    try {
      // 1) Resolve parceiros referenciados (lookup por nome)
      const nomesParceiros = aImportar
        .map((l) => (l.raw["Parceiro"] || "").trim())
        .filter((n) => n.length > 0);
      const parceiroIdPorNome = await buscarParceirosPorNome(nomesParceiros);

      // 2) Agrupa linhas por CPF (1 cliente, varios casos)
      const porCpf = new Map<string, Array<LinhaProcessada>>();
      for (const l of aImportar) {
        if (!porCpf.has(l.cpfDigits)) porCpf.set(l.cpfDigits, []);
        porCpf.get(l.cpfDigits)!.push(l);
      }

      // 3) Para cada CPF: cria cliente + casos
      for (const [cpfDigits, linhasDoCpf] of porCpf.entries()) {
        const primeira = linhasDoCpf[0].raw;
        try {
          // 3a) Cria cliente com dados da primeira linha
          const cliResp = await supabase
            .from("clientes")
            .insert({
              nome: (primeira["Nome"] || "").trim(),
              cpf: cpfDigits,
              data_nascimento: parseDataBr(primeira["Nascimento"]),
              telefone: primeira["Telefone"]?.trim() || null,
              email: primeira["Email"]?.trim() || null,
              endereco: primeira["Endereco"]?.trim() || null,
            })
            .select("id")
            .single();
          if (cliResp.error) throw cliResp.error;
          const clienteId = (cliResp.data as { id: string }).id;
          res.clientesCriados++;

          // 3b) Etiquetas (junta de todas as linhas do CPF, dedupe)
          const etiquetasNomes = Array.from(
            new Set(
              linhasDoCpf
                .flatMap((l) =>
                  (l.raw["Etiquetas"] || "")
                    .split(/[;,]/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                ),
            ),
          );
          if (etiquetasNomes.length > 0) {
            try {
              const ids = await obterIdsEtiquetas(etiquetasNomes);
              const linksCe = Array.from(ids.values()).map((etiqueta_id) => ({
                cliente_id: clienteId,
                etiqueta_id,
              }));
              if (linksCe.length > 0) {
                const linkResp = await supabase
                  .from("clientes_etiquetas")
                  .insert(linksCe);
                if (linkResp.error) {
                  console.warn("falha ao vincular etiquetas:", linkResp.error);
                }
              }
            } catch (errEt) {
              console.warn("falha ao processar etiquetas:", errEt);
            }
          }

          // 3c) Para cada linha: cria caso + processos + andamento
          for (const l of linhasDoCpf) {
            try {
              const parceiroNome = (l.raw["Parceiro"] || "").trim();
              const parceiroId = parceiroNome
                ? parceiroIdPorNome.get(parceiroNome) || null
                : null;
              const casoResp = await supabase
                .from("casos")
                .insert({
                  cliente_id: clienteId,
                  parceiro_id: parceiroId,
                  tipo_beneficio: (l.raw["Tipo Beneficio"] || "").trim() || "Outro",
                  fase: faseValueDe(l.raw["Fase"]),
                  status: statusValueDe(l.raw["Status"]),
                })
                .select("id")
                .single();
              if (casoResp.error) throw casoResp.error;
              const casoId = (casoResp.data as { id: string }).id;
              res.casosCriados++;

              // Processos admin
              const procsAdmin = (l.raw["Processos Admin"] || "")
                .split(";")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              if (procsAdmin.length > 0) {
                const insAdmResp = await supabase.from("processos_admin").insert(
                  procsAdmin.map((numero) => ({
                    caso_id: casoId,
                    numero_requerimento: numero,
                  })),
                );
                if (insAdmResp.error) {
                  console.warn("falha processo admin:", insAdmResp.error);
                }
              }

              // Processos judiciais
              const procsJud = (l.raw["Processos Judiciais"] || "")
                .split(";")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              if (procsJud.length > 0) {
                const insJudResp = await supabase.from("processos_judiciais").insert(
                  procsJud.map((numero) => ({
                    caso_id: casoId,
                    numero_processo: numero,
                  })),
                );
                if (insJudResp.error) {
                  console.warn("falha processo judicial:", insJudResp.error);
                }
              }

              // Ultimo andamento
              const andTit = (l.raw["Ultimo Andamento Titulo"] || "").trim();
              const andDesc = (l.raw["Ultimo Andamento Descricao"] || "").trim();
              const andData = parseDataBr(l.raw["Ultimo Andamento Data"]);
              if (andTit || andDesc) {
                const andResp = await supabase.from("andamentos").insert({
                  caso_id: casoId,
                  titulo: andTit || "Andamento importado",
                  descricao: andDesc || null,
                  data_evento: andData
                    ? andData + "T00:00:00Z"
                    : new Date().toISOString(),
                  origem: "interno",
                  visivel_parceiro: false,
                });
                if (andResp.error) {
                  console.warn("falha andamento:", andResp.error);
                }
              }
            } catch (errCaso) {
              const m =
                (errCaso as { message?: string })?.message || "erro no caso";
              res.errosLinha.push({
                linha: l.index,
                cpf: cpfDigits,
                msg: "caso: " + m,
              });
            }
          }
        } catch (errCli) {
          const m = (errCli as { message?: string })?.message || "erro";
          res.errosLinha.push({
            linha: linhasDoCpf[0].index,
            cpf: cpfDigits,
            msg: "cliente: " + m,
          });
        }
      }

      setResultado(res);
      if (res.clientesCriados > 0) onImported();
      if (res.errosLinha.length === 0) {
        toast.success(
          res.clientesCriados +
            " cliente(s) e " +
            res.casosCriados +
            " caso(s) importados",
        );
      } else {
        toast.warning(
          res.clientesCriados + " importados, " + res.errosLinha.length + " erros",
        );
      }
    } catch (err) {
      console.error(err);
      const errObj = err as { message?: string };
      toast.error(errObj.message || "Erro fatal durante o import");
    } finally {
      setImportando(false);
    }
  }

  const totalNovos = useMemo(
    () => linhas.filter((l) => l.status === "novo").length,
    [linhas],
  );
  const totalDuplicados = useMemo(
    () => linhas.filter((l) => l.status === "duplicado").length,
    [linhas],
  );
  const totalErros = useMemo(
    () => linhas.filter((l) => l.status === "erro").length,
    [linhas],
  );

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        if (importando) return;
        if (!o) onFechar();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        onPointerDownOutside={(e) => {
          if (importando) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (importando) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (importando) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Importar clientes do Excel</DialogTitle>
          <DialogDescription>
            Aceita o mesmo formato do export. CPFs já cadastrados são pulados.
            Cada linha vira um caso (mesmo CPF = mesmo cliente, vários casos).
          </DialogDescription>
        </DialogHeader>

        {!resultado && (
          <div className="space-y-4">
            <div>
              <label className="flex items-center justify-center gap-2 border-2 border-dashed border-input rounded-lg p-6 cursor-pointer hover:bg-muted/40">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">
                  {arquivo ? arquivo.name : "Clique pra escolher um arquivo .xlsx"}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={parsing || importando}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleArquivo(f);
                  }}
                />
              </label>
            </div>

            {parsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo planilha…
              </div>
            )}

            {!parsing && linhas.length > 0 && (
              <>
                <div className="flex gap-2 flex-wrap text-sm">
                  <Badge variant="default" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {totalNovos} a importar
                  </Badge>
                  {totalDuplicados > 0 && (
                    <Badge variant="secondary" className="gap-1">
                      <FileSpreadsheet className="h-3 w-3" />
                      {totalDuplicados} já cadastrados (vão ser pulados)
                    </Badge>
                  )}
                  {totalErros > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {totalErros} com erro
                    </Badge>
                  )}
                </div>

                <div className="border rounded max-h-[300px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Linha</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Nome</th>
                        <th className="text-left p-2">CPF</th>
                        <th className="text-left p-2">Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.slice(0, 200).map((l) => (
                        <tr key={l.index} className="border-t">
                          <td className="p-2 tabular-nums">{l.index}</td>
                          <td className="p-2">
                            {l.status === "novo" && (
                              <Badge variant="default" className="text-[10px]">
                                novo
                              </Badge>
                            )}
                            {l.status === "duplicado" && (
                              <Badge variant="secondary" className="text-[10px]">
                                duplicado
                              </Badge>
                            )}
                            {l.status === "erro" && (
                              <Badge variant="destructive" className="text-[10px]">
                                erro
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 truncate max-w-[200px]">
                            {l.raw["Nome"] || "-"}
                          </td>
                          <td className="p-2 tabular-nums">{l.cpfDigits || "-"}</td>
                          <td className="p-2 text-muted-foreground">
                            {l.erro || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {linhas.length > 200 && (
                    <p className="text-xs text-muted-foreground p-2 text-center">
                      Mostrando 200 de {linhas.length} linhas.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {resultado.clientesCriados} cliente(s) criados
              </Badge>
              <Badge variant="secondary" className="gap-1">
                {resultado.casosCriados} caso(s) criados
              </Badge>
              <Badge variant="secondary" className="gap-1">
                {resultado.clientesPulados} pulado(s)
              </Badge>
              {resultado.errosLinha.length > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  {resultado.errosLinha.length} erro(s)
                </Badge>
              )}
            </div>
            {resultado.errosLinha.length > 0 && (
              <div className="border rounded max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Linha</th>
                      <th className="text-left p-2">CPF</th>
                      <th className="text-left p-2">Mensagem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.errosLinha.map((e, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 tabular-nums">{e.linha}</td>
                        <td className="p-2 tabular-nums">{e.cpf}</td>
                        <td className="p-2 text-destructive">{e.msg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={importando}>
            {resultado ? "Fechar" : "Cancelar"}
          </Button>
          {!resultado && (
            <Button
              onClick={processarImport}
              disabled={importando || totalNovos === 0 || parsing}
            >
              {importando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Importar {totalNovos} cliente(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
