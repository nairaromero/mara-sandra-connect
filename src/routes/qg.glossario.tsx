// QG - Glossario: o mesmo glossario do produto, com os termos da plataforma
// primeiro e os que so fazem sentido para o staff (break-glass, eliminacao,
// papeis do QG).

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQg } from "@/lib/qg/contexto";
import { Glossario } from "@/components/glossario/glossario";
import type { Publico } from "@/lib/glossario/termos";

export const Route = createFileRoute("/qg/glossario")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: QgGlossario,
});

const PUBLICO_QG: ReadonlySet<Publico> = new Set<Publico>(["todos", "interno", "qg"]);

function QgGlossario() {
  const qg = useQg();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Glossário</h1>
        <p className="text-sm text-slate-600">
          O vocabulário da plataforma e dos escritórios, com o que cada papel pode — do QG e de dentro de um
          escritório.
        </p>
      </div>
      <Glossario
        contexto="qg"
        publico={PUBLICO_QG}
        papelStaffAtual={qg.papel}
        q={q ?? ""}
        // resetScroll: sem isso o router volta ao topo a cada tecla e desfaz o rolar do "veja tambem"
        onQ={(v) => navigate({ search: { q: v || undefined }, replace: true, resetScroll: false })}
      />
    </div>
  );
}
