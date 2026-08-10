// Lê RG/CNH e comprovante de endereço e devolve os campos do cadastro
// preenchidos, para a equipe conferir antes de salvar.
//
// A leitura NUNCA salva nada sozinha: o componente só entrega os campos pro
// formulário, sempre destacados como "vindo do documento". Erro de OCR em CPF
// cria cliente duplicado e quebra a busca no INSS, então conferência humana é
// parte do fluxo, não uma etapa opcional.
//
// Só aparece para usuário interno (o gate fica em quem renderiza).

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileScan, Loader2, ScanLine, X } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_MB = 8;
const ACEITA = "application/pdf,image/jpeg,image/png,image/webp";
// A edge function aceita 4 arquivos por chamada; um slot fica pro comprovante.
const MAX_IDENTIDADES = 3;

export interface CamposLidos {
  nome: string | null;
  cpf: string | null;
  data_nascimento: string | null;
  endereco: string | null;
}

/** Arquivo lido, devolvido pro pai arquivar junto com o caso. */
export interface ArquivoLido {
  file: File;
  tipo: "rg_cpf" | "comprovante_residencia";
}

interface Props {
  onPreenchido: (campos: CamposLidos, arquivos: Array<ArquivoLido>) => void;
}

/** File -> base64 puro (sem o prefixo "data:...;base64,"). */
function paraBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("não foi possível ler o arquivo"));
    reader.onload = () => {
      const r = String(reader.result || "");
      const virgula = r.indexOf(",");
      resolve(virgula === -1 ? r : r.slice(virgula + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function PreencherComDocumentos({ onPreenchido }: Props) {
  // Vários documentos de identidade de propósito: é comum um estar ilegível
  // justo no campo que falta (RG gasto sem CPF legível + CPF avulso, RG frente
  // e verso). Mandando juntos, o que um perde o outro completa.
  const [identidades, setIdentidades] = useState<Array<File>>([]);
  const [comprovante, setComprovante] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [avisos, setAvisos] = useState<Array<string>>([]);
  // Campos que o sistema completou em vez de ler inteiros (hoje só o CPF, quando
  // os dígitos verificadores saem ilegíveis). Merecem destaque próprio: são os
  // que mais precisam de conferência.
  const [calculados, setCalculados] = useState<Array<string>>([]);

  const temArquivo = identidades.length > 0 || !!comprovante;

  async function ler() {
    if (!temArquivo || lendo) return;
    setLendo(true);
    setAvisos([]);
    setCalculados([]);
    try {
      const selecionados: Array<ArquivoLido> = identidades.map((file) => ({
        file,
        tipo: "rg_cpf" as const,
      }));
      if (comprovante) selecionados.push({ file: comprovante, tipo: "comprovante_residencia" });

      for (const a of selecionados) {
        if (a.file.size > MAX_MB * 1024 * 1024) {
          toast.error(`${a.file.name} passa de ${MAX_MB} MB`, {
            description: "Fotografe com menos resolução ou envie só a página do documento.",
          });
          return;
        }
      }

      const arquivos = await Promise.all(
        selecionados.map(async (a) => ({
          nome: a.file.name,
          mime: a.file.type,
          tipo: a.tipo,
          base64: await paraBase64(a.file),
        })),
      );

      const { data, error } = await supabase.functions.invoke("extrair-dados-cliente", {
        body: { arquivos },
      });

      if (error) {
        // A edge function devolve o motivo no corpo mesmo em erro; o invoke não
        // expõe direto, então mostramos o que dá e mantemos os arquivos na tela
        // pra pessoa tentar de novo sem reanexar.
        const detalhe = (data as { error?: string } | null)?.error;
        toast.error("Não foi possível ler o documento", {
          description: detalhe || "Confira se o assistente de IA está configurado em Configurações.",
        });
        return;
      }

      const resp = data as
        | { campos?: CamposLidos; avisos?: Array<string>; calculados?: Array<string> }
        | null;
      const campos = resp?.campos;
      if (!campos) {
        toast.error("A leitura não devolveu campos.");
        return;
      }

      setAvisos(resp?.avisos ?? []);
      setCalculados(resp?.calculados ?? []);
      onPreenchido(campos, selecionados);

      const lidos = [
        campos.nome && "nome",
        campos.cpf && "CPF",
        campos.data_nascimento && "nascimento",
        campos.endereco && "endereço",
      ].filter(Boolean);

      if (lidos.length === 0) {
        toast.warning("Nenhum campo pôde ser lido — preencha à mão.");
      } else {
        toast.success(`Preenchido: ${lidos.join(", ")}.`, {
          description: "Confira cada campo antes de salvar.",
        });
      }
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || "Falha ao ler o documento.");
    } finally {
      setLendo(false);
    }
  }

  return (
    <Card className="border-[var(--gold)]/40 bg-gold-soft/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanLine className="h-4 w-4 text-[var(--gold)]" />
          Preencher com os documentos
        </CardTitle>
        <CardDescription>
          Anexe os documentos: o sistema lê e preenche nome, CPF, nascimento e endereço.
          Pode mandar <strong>mais de um documento de identidade</strong> — frente e verso,
          ou RG e CPF avulso —, que o que faltar em um é completado pelo outro.{" "}
          <strong>Confira sempre</strong> antes de salvar; os arquivos ficam arquivados
          no caso.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Identidade — RG, CNH, CPF ou certidão (pode anexar vários)
            </Label>
            <ListaArquivos
              arquivos={identidades}
              onArquivos={setIdentidades}
              max={MAX_IDENTIDADES}
              disabled={lendo}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Comprovante de endereço</Label>
            <ArquivoCampo arquivo={comprovante} onArquivo={setComprovante} disabled={lendo} />
          </div>
        </div>

        <Button type="button" size="sm" onClick={ler} disabled={!temArquivo || lendo}>
          {lendo ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileScan className="mr-2 h-4 w-4" />
          )}
          {lendo ? "Lendo documento..." : "Ler e preencher"}
        </Button>

        {calculados.includes("cpf") && (
          <p className="flex items-start gap-1.5 rounded-md border border-red-500/50 bg-red-50 p-2.5 text-xs font-medium text-red-900 dark:bg-red-950 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Os 2 últimos dígitos do CPF não estavam legíveis e foram calculados a
              partir dos 9 primeiros. Confira o número inteiro no documento antes de
              salvar — se um dos 9 tiver sido lido errado, o CPF fica errado sem
              parecer errado.
            </span>
          </p>
        )}

        {avisos.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {avisos.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Vários arquivos num campo só. Cada arquivo escolhido vira uma linha; o input
 * some quando o limite é atingido, pra não oferecer o que não vai caber.
 */
function ListaArquivos({
  arquivos,
  onArquivos,
  max,
  disabled,
}: {
  arquivos: Array<File>;
  onArquivos: (f: Array<File>) => void;
  max: number;
  disabled: boolean;
}) {
  // Reseta o input após cada escolha: sem isso, escolher o MESMO arquivo de novo
  // (depois de remover) não dispara onChange e a pessoa acha que travou.
  const [chaveInput, setChaveInput] = useState(0);

  function adicionar(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const novos = Array.from(lista);
    const jaTem = (f: File) =>
      arquivos.some((a) => a.name === f.name && a.size === f.size);
    const aceitos = novos.filter((f) => !jaTem(f));
    const espaco = max - arquivos.length;
    if (aceitos.length > espaco) {
      toast.warning(`Cabem no máximo ${max} documentos de identidade.`);
    }
    onArquivos([...arquivos, ...aceitos.slice(0, espaco)]);
    setChaveInput((k) => k + 1);
  }

  return (
    <div className="space-y-1.5">
      {arquivos.map((a, i) => (
        <div
          key={`${a.name}-${a.size}-${i}`}
          className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {(a.size / 1024).toFixed(0)} KB
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            disabled={disabled}
            onClick={() => onArquivos(arquivos.filter((_, j) => j !== i))}
            aria-label={`Remover ${a.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {arquivos.length < max && (
        <Input
          key={chaveInput}
          type="file"
          accept={ACEITA}
          multiple
          disabled={disabled}
          onChange={(e) => adicionar(e.target.files)}
        />
      )}
    </div>
  );
}

function ArquivoCampo({
  arquivo,
  onArquivo,
  disabled,
}: {
  arquivo: File | null;
  onArquivo: (f: File | null) => void;
  disabled: boolean;
}) {
  if (arquivo) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {(arquivo.size / 1024).toFixed(0)} KB
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          disabled={disabled}
          onClick={() => onArquivo(null)}
          aria-label={`Remover ${arquivo.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <Input
      type="file"
      accept={ACEITA}
      disabled={disabled}
      onChange={(e) => {
        const f = e.target.files;
        onArquivo(f && f.length > 0 ? f[0] : null);
      }}
    />
  );
}
