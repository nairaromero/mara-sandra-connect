// Botao flutuante que abre o painel do assistente de IA.
// So aparece se o usuario tem o assistente ATIVO (ia_integracoes.ativo=true).
// O hook fica AQUI (nao dentro do painel) para a conversa PERSISTIR ao fechar e
// reabrir o painel. Tambem detecta o caso aberto (/casos/$id) e passa como
// contexto para o assistente saber do que "este caso"/"aqui" se trata.
// Envolto em ClientOnly por causa do SSR do TanStack Start.

import { useEffect, useState } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { ClientOnly } from "@/components/client-only";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { iaConfig } from "@/lib/ia/client";
import { useIaAssistant } from "@/hooks/use-ia-assistant";
import { IaAssistantPanel } from "./ia-assistant-panel";

function LauncherInner() {
  const [ativo, setAtivo] = useState(false);
  const [open, setOpen] = useState(false);

  // Contexto da tela: se o usuario esta vendo um caso, o assistente fica ciente.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false }) as { id?: string };
  const casoId = pathname.startsWith("/casos/") && params.id ? params.id : undefined;

  const ia = useIaAssistant(casoId ? { caso_id: casoId } : undefined);

  useEffect(() => {
    let vivo = true;
    iaConfig.status().then(({ data }) => {
      if (vivo && data) setAtivo(data.ativo);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!ativo) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full p-0 shadow-lg"
          aria-label="Abrir assistente de IA"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="sr-only">
          <SheetTitle>Assistente de IA</SheetTitle>
        </SheetHeader>
        <IaAssistantPanel ia={ia} noCaso={!!casoId} />
      </SheetContent>
    </Sheet>
  );
}

export function IaLauncher() {
  return (
    <ClientOnly fallback={null}>
      <LauncherInner />
    </ClientOnly>
  );
}
