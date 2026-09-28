// Configuracoes -> Seguranca: verificacao em duas etapas da propria conta.
// Ativar = cadastrar o autenticador; desativar pede o codigo se a sessao
// ainda esta em AAL1 (o Supabase exige AAL2 para remover o fator).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { dataHoraBR } from "@/lib/fuso";
import { fatoresTotp, precisaCodigo, removerFator, type FatorTotp } from "@/lib/mfa";
import { VerificacaoDuasEtapas } from "@/components/verificacao-duas-etapas";

export function DuasEtapasCard() {
  const [fator, setFator] = useState<FatorTotp | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<"nada" | "cadastrar" | "confirmar_para_remover">("nada");
  const [removendo, setRemovendo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const lista = await fatoresTotp();
      setFator(lista.find((f) => f.status === "verified") ?? null);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
      setFator(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function remover() {
    if (!fator) return;
    setRemovendo(true);
    try {
      const { precisa } = await precisaCodigo();
      if (precisa) {
        setEtapa("confirmar_para_remover");
        return;
      }
      await removerFator(fator.id);
      toast.success("Verificação em duas etapas desativada.");
      setEtapa("nada");
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <Card data-card-duas-etapas>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Verificação em duas etapas
          {fator !== undefined && (
            <Badge variant={fator ? "default" : "secondary"} className="ml-1" data-mfa-status={fator ? "ativa" : "inativa"}>
              {fator ? "ativa" : "não ativa"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Além da senha, um código do aplicativo autenticador a cada entrada. Obrigatória para a equipe do QG;
          recomendada para administradores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {erro && <p className="text-sm text-red-700">Não consegui ler o estado: {erro}</p>}
        {fator === undefined && !erro && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}
        {fator && etapa === "nada" && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              Ativa{fator.created_at ? ` desde ${dataHoraBR(fator.created_at)}` : ""}.
            </span>
            <Button variant="outline" onClick={remover} disabled={removendo}>
              {removendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldOff className="mr-2 h-4 w-4" />}
              Desativar
            </Button>
          </div>
        )}
        {fator === null && etapa === "nada" && (
          <Button onClick={() => setEtapa("cadastrar")}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Ativar verificação em duas etapas
          </Button>
        )}
        {etapa === "cadastrar" && (
          <VerificacaoDuasEtapas
            modo="cadastrar"
            onPronto={() => {
              toast.success("Verificação em duas etapas ativada.");
              setEtapa("nada");
              void carregar();
            }}
            onCancelar={() => setEtapa("nada")}
          />
        )}
        {etapa === "confirmar_para_remover" && fator && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Para desativar, confirme o código atual do aplicativo.</p>
            <VerificacaoDuasEtapas
              modo="confirmar"
              fatorId={fator.id}
              rotuloConfirmar="Confirmar e desativar"
              onPronto={async () => {
                try {
                  await removerFator(fator.id);
                  toast.success("Verificação em duas etapas desativada.");
                } catch (e) {
                  toast.error((e as Error).message);
                }
                setEtapa("nada");
                void carregar();
              }}
              onCancelar={() => setEtapa("nada")}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
