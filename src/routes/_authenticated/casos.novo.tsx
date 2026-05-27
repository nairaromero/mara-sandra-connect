import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/casos/novo")({
  component: NovoCasoStub,
});

function NovoCasoStub() {
  return <div className="p-6">stub temporário — diagnóstico de build</div>;
}
