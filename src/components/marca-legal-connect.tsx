// Marca do PRODUTO (Legal Connect), nao do escritorio: telas antes do login,
// favicon, QG e o "por Legal Connect" da sidebar. Dentro do escritorio o topo
// continua com a marca dele. Arquivos em public/marca (SVG vetorial; os PNG
// sao para manifest, apple-touch e e-mail).

const ARQUIVO = {
  horizontal: "/marca/legal-connect.svg",
  escuro: "/marca/legal-connect-escuro.svg",
  mono: "/marca/legal-connect-mono.svg",
  empilhado: "/marca/legal-connect-empilhado.svg",
  icone: "/marca/icone.svg",
  "icone-escuro": "/marca/icone-escuro.svg",
} as const;

export function MarcaLegalConnect(props: { variante?: keyof typeof ARQUIVO; className?: string }) {
  const { variante = "horizontal", className } = props;
  return <img src={ARQUIVO[variante]} alt="Legal Connect" className={className} draggable={false} />;
}
