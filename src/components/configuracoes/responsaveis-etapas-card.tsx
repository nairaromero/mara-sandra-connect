// Configurações › Escritório: quem faz cada etapa do caso novo (card #434).
//
// A corrente do caso de parceiro é: Organizar documentos → Analisar o caso.
// Quem recebe cada tarefa já era configuração do escritório
// (`escritorio_config.responsaveis`, lida por `responsavel_etapa`), mas não
// havia tela: trocar exigia SQL. Grava pela RPC `escritorio_definir_responsaveis`
// (só gente interna ativa, auditada). Sem escolha, a etapa segue a escada de
// sempre (dono do caso → padrão do escritório → admin).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Users } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { lerUm } from "@/lib/leitura";
import { useAuth } from "@/hooks/use-auth";
import { listarInternosAtivos } from "@/lib/tarefas/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Selecao } from "@/components/ui/selecao";

interface Responsaveis {
  organiza_documentos?: string;
  organiza_documentos_substituto?: string;
  analise?: string;
}

// Valor do "ninguém escolhido" no seletor (o Selecao trabalha com string).
const NINGUEM = "__ninguem__";

const ETAPAS: Array<{ chave: keyof Responsaveis; rotulo: string; ajuda: string }> = [
  {
    chave: "organiza_documentos",
    rotulo: "Organizar documentos",
    ajuda: "Recebe a conferência de documentos de todo caso novo de parceiro.",
  },
  {
    chave: "organiza_documentos_substituto",
    rotulo: "Organizar documentos — substituto",
    ajuda: "Recebe quando quem organiza não está mais ativa na equipe.",
  },
  {
    chave: "analise",
    rotulo: "Analisar o caso",
    ajuda:
      "Recebe a análise depois da conferência — e também as tarefas que nascem sem dono no escritório.",
  },
];

export function ResponsaveisEtapasCard() {
  const { escritorio, podeChamar } = useAuth();
  const escritorioId = escritorio?.escritorio_id ?? null;
  const [salvo, setSalvo] = useState<Responsaveis | null>(null);
  const [rascunho, setRascunho] = useState<Responsaveis>({});
  const [equipe, setEquipe] = useState<Array<{ id: string; nome: string | null; email: string | null }>>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pode = podeChamar("escritorio_definir_responsaveis");

  useEffect(() => {
    if (!escritorioId) return;
    let vivo = true;
    Promise.all([
      lerUm<{ responsaveis: Responsaveis }>(
        supabase.from("escritorio_config").select("responsaveis").eq("escritorio_id", escritorioId).maybeSingle(),
        "responsáveis do escritório",
      ),
      listarInternosAtivos(),
    ])
      .then(([linha, internos]) => {
        if (!vivo) return;
        const r = linha?.responsaveis ?? {};
        setSalvo(r);
        setRascunho(r);
        setEquipe(internos);
        setErro(null);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        console.error(e);
        setErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [escritorioId]);

  const opcoes = useMemo(
    () => [
      { value: NINGUEM, label: "Ninguém escolhido (escada de sempre)" },
      ...equipe.map((p) => ({ value: p.id, label: p.nome || p.email || p.id })),
    ],
    [equipe],
  );

  if (!pode) return null;

  const mudou = JSON.stringify(rascunho) !== JSON.stringify(salvo);

  async function salvar() {
    setSalvando(true);
    try {
      const { data, error } = await supabase.rpc("escritorio_definir_responsaveis", {
        p_organiza: rascunho.organiza_documentos ?? null,
        p_organiza_substituto: rascunho.organiza_documentos_substituto ?? null,
        p_analise: rascunho.analise ?? null,
      });
      if (error) throw error;
      const r = (data ?? {}) as Responsaveis;
      setSalvo(r);
      setRascunho(r);
      toast.success("Responsáveis salvos — valem para as próximas tarefas.");
    } catch (e) {
      console.error(e);
      toast.error((e as { message?: string })?.message || "Não consegui salvar os responsáveis.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Quem faz cada etapa
        </CardTitle>
        <CardDescription>
          No caso novo de parceiro, a conferência dos documentos vem antes da análise. Escolha
          quem recebe cada tarefa. Pessoa desligada deixa de receber sozinha.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {erro ? (
          <p className="text-xs text-destructive">Não consegui ler a configuração: {erro}</p>
        ) : salvo === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </p>
        ) : (
          <>
            {ETAPAS.map((etapa) => (
              <div key={etapa.chave} className="space-y-1" data-etapa={etapa.chave}>
                <Label className="text-sm">{etapa.rotulo}</Label>
                <Selecao
                  opcoes={opcoes}
                  value={rascunho[etapa.chave] ?? NINGUEM}
                  onChange={(v) =>
                    setRascunho((r) => {
                      const novo = { ...r };
                      if (v === NINGUEM) delete novo[etapa.chave];
                      else novo[etapa.chave] = v;
                      return novo;
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground">{etapa.ajuda}</p>
              </div>
            ))}
            <Button size="sm" onClick={salvar} disabled={!mudou || salvando}>
              {salvando ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Salvar
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
