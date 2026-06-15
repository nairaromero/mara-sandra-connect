import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { renderPolitica } from "@/lib/legal/termos";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Mara Sandra Vian Advocacia" },
      {
        name: "description",
        content:
          "Política de Privacidade da plataforma Mara Sandra Connect, conforme a LGPD.",
      },
    ],
  }),
  component: PrivacidadePage,
});

function PrivacidadePage() {
  const texto = renderPolitica();
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[var(--gold)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao início
        </Link>
        <div className="mt-6 rounded-xl border bg-card p-6 sm:p-8 shadow-sm">
          <Markdown>{texto}</Markdown>
        </div>
      </div>
    </div>
  );
}
