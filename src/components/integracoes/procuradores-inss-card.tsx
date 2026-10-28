// Quem é o procurador nos e-mails do INSS (#503).
//
// O e-mail do MEU INSS traz o nome de quem fez o requerimento. Quando é alguém
// do escritório (o procurador), o e-mail não é de um cliente e segue um fluxo
// à parte. Conta como procurador: o marcador "(procurador)" que o INSS
// escreve, o nome completo de quem é da equipe interna ativa (automático) e
// os nomes cadastrados aqui — para quem aparece no INSS com um nome diferente
// do cadastro. A regra mora em supabase/functions/_shared/inss-procurador.ts
// (a mesma que a tela usa para dizer o que vale).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, UserCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { lerUm } from "@/lib/leitura";
import { useAuth } from "@/hooks/use-auth";
import { listarInternosAtivos } from "@/lib/tarefas/queries";
import { lerProcuradoresCadastrados, nomeValeComoProcurador } from "@shared/inss-procurador";

export function ProcuradoresInssCard() {
  const { escritorio, podeChamar } = useAuth();
  const escritorioId = escritorio?.escritorio_id ?? null;
  const [salvos, setSalvos] = useState<string[] | null>(null);
  const [texto, setTexto] = useState("");
  const [equipe, setEquipe] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!escritorioId) return;
    let vivo = true;
    Promise.all([
      lerUm<{ extras: unknown }>(
        supabase.from("escritorio_config").select("extras").eq("escritorio_id", escritorioId).maybeSingle(),
        "procuradores do INSS",
      ),
      listarInternosAtivos(),
    ])
      .then(([cfg, internos]) => {
        if (!vivo) return;
        const lista = lerProcuradoresCadastrados(cfg?.extras);
        setSalvos(lista);
        setTexto(lista.join("\n"));
        setEquipe(internos.map((i) => i.nome ?? "").filter(nomeValeComoProcurador));
        setErro(null);
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [escritorioId]);

  if (!escritorio || !podeChamar("escritorio_definir_inss_procuradores")) return null;

  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const invalidos = linhas.filter((l) => !nomeValeComoProcurador(l));
  const mudou = !!salvos && linhas.join("\n") !== salvos.join("\n");

  async function salvar() {
    setSalvando(true);
    try {
      const { data, error } = await supabase.rpc("escritorio_definir_inss_procuradores", { p_nomes: linhas });
      if (error) throw error;
      const lista = lerProcuradoresCadastrados({ inss_procuradores: data });
      setSalvos(lista);
      setTexto(lista.join("\n"));
      toast.success("Procuradores do INSS salvos");
    } catch (e) {
      toast.error(`Não salvou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card data-card-procuradores-inss>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserCheck className="h-4 w-4" />
          Procurador nos e-mails do INSS
        </CardTitle>
        <CardDescription>
          Quando o nome no e-mail do INSS é de alguém do escritório, o e-mail não é de um cliente e
          segue o fluxo de procurador. Já contam o marcador “(procurador)” e o nome completo de
          quem é da equipe; acrescente aqui quem aparece no INSS com outro nome.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {erro && <p className="text-sm text-destructive">Não consegui ler: {erro}</p>}
        {!salvos && !erro && (
          <div className="flex h-12 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {salvos && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Equipe (automático)</p>
              <div className="flex flex-wrap gap-1.5" data-procuradores-equipe>
                {equipe.length === 0 && <span className="text-xs text-muted-foreground">ninguém com nome completo</span>}
                {equipe.map((n) => (
                  <Badge key={n} variant="secondary" className="font-normal">
                    {n}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="inss-procuradores" className="text-xs">
                Como o INSS escreve (um nome por linha, com sobrenome)
              </Label>
              <Textarea
                id="inss-procuradores"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={3}
                placeholder="Ex.: Nome Sobrenome"
                data-procuradores-cadastrados
              />
              {invalidos.length > 0 && (
                <p className="text-xs text-destructive">
                  Use nome e sobrenome — um nome só casaria com cliente: {invalidos.join(", ")}
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => void salvar()}
              disabled={!mudou || invalidos.length > 0 || salvando}
              data-procuradores-salvar
            >
              {salvando ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Save className="h-3 w-3 mr-2" />}
              Salvar
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
