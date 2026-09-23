import { Table2 } from "lucide-react";
import { IntegracaoCredencialCard } from "@/components/integracoes/integracao-credencial-card";

export function IntegracaoTiCard() {
  return (
    <IntegracaoCredencialCard
      tipo="ti"
      titulo="Tramitação Inteligente (TI)"
      icone={Table2}
      descricao="A conta do Tramitação Inteligente deste escritório: busca de clientes pelo nome e importação de notas para o caso. O token fica cifrado no servidor."
      campos={[
        { chave: "base_url", rotulo: "Endereço da API", placeholder: "https://planilha.tramitacaointeligente.com.br/api/v1" },
        { chave: "usuario", rotulo: "Conta (e-mail)", placeholder: "escritorio@exemplo.com.br" },
      ]}
      rotuloSegredo="Token de acesso"
    />
  );
}
