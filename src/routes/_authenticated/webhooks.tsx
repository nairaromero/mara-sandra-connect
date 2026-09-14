import { createFileRoute, redirect } from "@tanstack/react-router";

// A gestão de webhooks mudou pra aba "Webhooks" das Configurações (só admin) em
// 2026-09-14 — ver src/components/integracoes/webhooks-card.tsx. A rota fica só
// pra links e favoritos antigos não quebrarem. Quem não é admin cai na aba
// Perfil: a própria tela de Configurações ignora aba que a pessoa não pode ver.
export const Route = createFileRoute("/_authenticated/webhooks")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", search: { tab: "webhooks" }, replace: true });
  },
});
