// Glossario do sistema: o que cada termo e cada papel significa AQUI. Todo
// mundo logado ve (equipe e parceiros); os termos tecnicos so aparecem para a
// equipe. A busca vai na URL (?q=) para dar para mandar link de um termo.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Glossario } from "@/components/glossario/glossario";
import type { Publico } from "@/lib/glossario/termos";

export const Route = createFileRoute("/_authenticated/glossario")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: GlossarioPage,
});

function GlossarioPage() {
  const { usuario, escritorio } = useAuth();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const publico = new Set<Publico>(["todos"]);
  if (usuario?.tipo === "interno") publico.add("interno");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-[var(--gold)]" />
          Glossário
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O que cada termo e cada papel significa neste sistema. As permissões dos papéis vêm do banco, do jeito que
          valem agora.
        </p>
      </div>
      <Glossario
        contexto="produto"
        publico={publico}
        papelAtual={escritorio?.papel ?? null}
        q={q ?? ""}
        // resetScroll: sem isso o router volta ao topo a cada tecla e desfaz o rolar do "veja tambem"
        onQ={(v) => navigate({ search: { q: v || undefined }, replace: true, resetScroll: false })}
      />
    </div>
  );
}
