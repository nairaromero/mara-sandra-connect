// Aviso no lugar de uma lista que não carregou (ver useCargaDoPainel): diz o
// que falhou e oferece tentar de novo, em vez de deixar o seletor vazio.
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AvisoDeCarga({
  erro,
  carregando,
  onTentar,
}: {
  erro: string | null;
  carregando?: boolean;
  onTentar: () => void;
}) {
  if (!erro) return null;
  return (
    <div
      role="alert"
      className="mt-1 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
      data-aviso-carga
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{erro}</span>
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onTentar} disabled={carregando}>
        {carregando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
        Tentar de novo
      </Button>
    </div>
  );
}
