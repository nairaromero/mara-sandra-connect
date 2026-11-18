import { Scale } from "lucide-react";
import { IntegracaoCredencialCard, type CampoCredencial } from "@/components/integracoes/integracao-credencial-card";

const CAMPOS: ReadonlyArray<CampoCredencial> = [{ chave: "usuario", rotulo: "Conta (e-mail)", placeholder: "escritorio@exemplo.com.br" }];

export function IntegracaoLegalmailCard() {
  return (
    <IntegracaoCredencialCard
      tipo="legalmail"
      titulo="Legalmail"
      icone={Scale}
      descricao="A conta do Legalmail deste escritório: busca de processos pelo nome do cliente e importação de movimentações. A chave fica cifrada no servidor."
      campos={CAMPOS}
      rotuloSegredo="Chave da API (api_key)"
      ajudaSegredo="Em app.legalmail.com.br → Integrações → API."
    />
  );
}
