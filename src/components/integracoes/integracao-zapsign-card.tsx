import { Copy, FileSignature, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SUPABASE_URL } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { IntegracaoCredencialCard, type CampoCredencial } from "@/components/integracoes/integracao-credencial-card";

/** Endereço que o ZapSign chama quando um documento é aberto, assinado ou recusado. */
function enderecoDoAviso(token: string): string {
  return `${SUPABASE_URL}/functions/v1/zapsign-webhook?token=${token}`;
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
        const endereco = enderecoDoAviso(token);
        return (
          <div className="space-y-1 rounded-md border border-dashed px-3 py-2 text-sm" data-zapsign-aviso>
            <p className="font-medium">Endereço do aviso (webhook)</p>
            <p className="text-muted-foreground">
              No ZapSign, em Configurações → Integrações → API ZapSign → Webhooks, cadastre este endereço para todos os
              eventos. É por ele que o sistema fica sabendo que o documento foi assinado. Trate como senha: quem tem o
              endereço consegue pedir uma atualização de status.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{endereco}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(endereco).then(
                    () => toast.success("Endereço copiado."),
                    () => toast.error("Não consegui copiar. Selecione o endereço e copie à mão."),
                  );
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={acoes.ocupado}
                data-zapsign-novo-endereco
                onClick={() => {
                  if (window.confirm("Gerar um endereço novo? O atual para de funcionar na hora: será preciso trocar o endereço no ZapSign.")) void acoes.gerarToken();
                }}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Gerar endereço novo
              </Button>
              <span className="text-xs text-muted-foreground">Use se o endereço tiver vazado.</span>
            </div>
          </div>
        );
      }}
    />
  );
}
