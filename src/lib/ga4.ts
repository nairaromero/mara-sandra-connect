// Google Analytics 4 do SITE PÚBLICO (página inicial). Mesma propriedade e mesmo
// ID da landing `public/aposentadoria.html` (fluxo "Site marasandraconnect"),
// para a Mara ver anúncio e site num relatório só e marcar `clique_whatsapp`
// como conversão uma única vez.
//
// Só nas páginas públicas: as telas autenticadas do Legal Connect NÃO carregam
// o GA4 (dados de clientes; sem previsão na política de privacidade para isso).
export const GA4_ID = "G-Q9WHH6PW7X";

/** Scripts para o `head()` da rota pública (TanStack Router → `<HeadContent>`). */
export function ga4HeadScripts() {
  return [
    { src: `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`, async: true },
    {
      children:
        "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}" +
        `gtag('js',new Date());gtag('config','${GA4_ID}');`,
    },
  ];
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Mesmo evento e mesmos parâmetros que a landing dispara: `origem` diz qual
 * botão, `pagina` qual página, `utm` a campanha (ou "(direto)" sem UTM).
 */
export function registrarCliqueWhatsapp(origem: string, pagina = "home") {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const params = new URLSearchParams(window.location.search);
  const utm = ["utm_source", "utm_medium", "utm_campaign", "utm_content"]
    .map((k) => params.get(k))
    .filter(Boolean)
    .join(" / ");
  window.gtag("event", "clique_whatsapp", { origem, pagina, utm: utm || "(direto)" });
}
