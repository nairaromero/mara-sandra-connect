// Seletor de escritório (RBAC multi-tenant). Só aparece para quem pode abrir
// mais de um — a maioria das pessoas tem um vínculo só e nem sabe que existe.
// Trocar grava a preferência e recarrega a página inteira: nenhum estado, cache
// ou canal de Realtime do escritório anterior sobrevive.

import { useState } from "react";
import { Building2, Check, ChevronsUpDown, LifeBuoy, Loader2, PauseCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SeletorEscritorio() {
  const { vinculos, escritorio, trocarEscritorio } = useAuth();
  const [trocando, setTrocando] = useState<string | null>(null);

  if (!escritorio) return null;
  // Um escritório só: mostra o nome, sem menu.
  if (vinculos.length < 2) {
    return (
      <span
        className="hidden lg:flex items-center gap-1.5 text-sm text-muted-foreground"
        title="Escritório"
      >
        <Building2 className="h-4 w-4" />
        {escritorio.escritorio_nome}
      </span>
    );
  }

  async function trocar(id: string) {
    setTrocando(id);
    try {
      await trocarEscritorio(id);
    } catch (e) {
      setTrocando(null);
      toast.error("Não consegui trocar de escritório.", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 max-w-[16rem]" aria-label="Trocar de escritório">
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{escritorio.escritorio_nome}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Seus escritórios</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {vinculos.map((v) => {
          const atual = v.escritorio_id === escritorio.escritorio_id;
          const suspenso = v.escritorio_status !== "ativo";
          return (
            <DropdownMenuItem
              key={v.escritorio_id}
              disabled={atual || suspenso || trocando !== null}
              onSelect={(ev) => {
                ev.preventDefault();
                void trocar(v.escritorio_id);
              }}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 h-4 w-4 shrink-0">
                {trocando === v.escritorio_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : atual ? (
                  <Check className="h-4 w-4" />
                ) : v.suporte ? (
                  <LifeBuoy className="h-4 w-4 text-amber-600" />
                ) : suspenso ? (
                  <PauseCircle className="h-4 w-4 text-muted-foreground" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{v.escritorio_nome}</span>
                <span className="block text-xs text-muted-foreground">
                  {suspenso ? "Escritório suspenso" : v.papel_nome}
                  {v.suporte ? " · somente leitura" : ""}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
