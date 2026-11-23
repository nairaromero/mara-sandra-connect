import { Copy, FileSignature, RefreshCw } from "lucide-react";
import { SUPABASE_URL } from "@/lib/supabase";
import { copiarTexto } from "@/lib/copiar";
import { Button } from "@/components/ui/button";
import { IntegracaoCredencialCard, type CampoCredencial } from "@/components/integracoes/integracao-credencial-card";

/** Endereço que o ZapSign chama quando um documento é aberto, assinado ou recusado. */
const ENDERECO_DO_AVISO = `${SUPABASE_URL}/functions/v1/zapsign-webhook`;
/** Nome do cabeçalho em que o ZapSign manda o segredo (o cadastro do webhook lá aceita cabeçalhos). */
const CABECALHO_DO_AVISO = "x-inbound-token";

function LinhaCopiavel({ rotulo, valor, marca }: { rotulo: string; valor: string; marca: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{rotulo}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs" data-zapsign-copiavel={marca}>{valor}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copiarTexto(valor, `${rotulo} copiado.`)}
      >
        <Copy className="mr-2 h-3.5 w-3.5" /> Copiar
      </Button>
    </div>
  );
}

const CAMPOS: ReadonlyArray<CampoCredencial> = [
  {
    chave: "ambiente",
    rotulo: "Ambiente",
    padrao: "producao",
    opcoes: [
      { value: "producao", label: "Produção (documentos com validade jurídica)" },
      { value: "sandbox", label: "Sandbox (só para teste, sem validade)" },
    ],
  },
];

export function IntegracaoZapsignCard() {
  return (
    <IntegracaoCredencialCard
      tipo="zapsign"
      titulo="ZapSign"
      icone={FileSignature}
      descricao="Assinatura eletrônica: envie o contrato e a procuração do caso para o cliente assinar, e o PDF assinado volta sozinho para os documentos do caso. O token fica cifrado no servidor."
      campos={CAMPOS}
      rotuloSegredo="Token da API"
      ajudaSegredo="No ZapSign: Configurações → Integrações → API ZapSign. Cada ambiente tem o seu token."
      rodape={(config, configurada, acoes) => {
        const token = config.inbound_token;
        if (!configurada || !token) return null;
        return (
          <div className="space-y-1.5 rounded-md border border-dashed px-3 py-2 text-sm" data-zapsign-aviso>
            <p className="font-medium">Aviso do ZapSign (webhook)</p>
            <p className="text-muted-foreground">
              No ZapSign, em Configurações → Integrações → API ZapSign → Webhooks, cadastre o endereço abaixo para todos
              os eventos e acrescente o cabeçalho com o segredo. É por esse aviso que o sistema fica sabendo que o
              documento foi assinado. Trate o segredo como senha: quem o tem consegue pedir uma atualização de status.
            </p>
            <LinhaCopiavel rotulo="Endereço" valor={ENDERECO_DO_AVISO} marca="endereco" />
            <LinhaCopiavel rotulo="Cabeçalho" valor={CABECALHO_DO_AVISO} marca="cabecalho" />
            <LinhaCopiavel rotulo="Segredo" valor={token} marca="segredo" />
            <p className="text-xs text-muted-foreground">
              O endereço antigo, com <code>?token=</code> no fim, continua funcionando. O cabeçalho é o jeito que o
              ZapSign recomenda, porque o segredo não fica gravado no histórico de avisos do painel deles.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={acoes.ocupado}
                data-zapsign-novo-endereco
                onClick={() => {
                  if (window.confirm("Gerar um segredo novo? O atual para de funcionar na hora: será preciso trocar o segredo no ZapSign.")) void acoes.gerarToken();
                }}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Gerar segredo novo
              </Button>
              <span className="text-xs text-muted-foreground">Use se o segredo tiver vazado.</span>
            </div>
          </div>
        );
      }}
    />
  );
}
