// Card "Integração Gmail" em Configurações.
// Conecta a caixa de entrada do INSS (Naira) via OAuth Google. O fluxo é:
//   1. Botão "Conectar Gmail" -> chama edge function gmail-oauth-start,
//      recebe auth_url e redireciona o navegador.
//   2. Google consent -> redirect para gmail-oauth-callback (server-side),
//      que troca code por tokens, cifra refresh_token e salva no banco.
//   3. Callback redireciona de volta para /configuracoes?gmail=ok|error.
//
// O card lê o vínculo direto da tabela usuario_gmail_oauth (RLS permite
// self-select). Nunca recebe o token em claro — só email_conectado e datas.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Plug, Unplug, CheckCircle2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

interface VinculoGmail {
  email_conectado: string;
  connected_at: string;
  last_used_at: string | null;
  scope: string;
}

export function IntegracaoGmailCard() {
  const { usuario } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [vinculo, setVinculo] = useState<VinculoGmail | null>(null);
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  const carregar = useCallback(async () => {
    if (!usuario?.id) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data } = await supabase
      .from("usuario_gmail_oauth")
      .select("email_conectado, connected_at, last_used_at, scope")
      .eq("usuario_id", usuario.id)
      .maybeSingle();
    setVinculo(data as VinculoGmail | null);
    setCarregando(false);
  }, [usuario?.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Lê o resultado do callback no querystring na primeira renderização.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const r = p.get("gmail");
    if (!r) return;
    if (r === "ok") {
      toast.success("Gmail conectado com sucesso.");
    } else if (r === "error") {
      toast.error(`Falha ao conectar Gmail: ${p.get("motivo") ?? "desconhecido"}`);
    }
    // Limpa querystring pra não repetir o toast em refresh.
    p.delete("gmail");
    p.delete("motivo");
    const novo = p.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${novo ? "?" + novo : ""}`,
    );
    // Recarrega vínculo (pode ter mudado).
    carregar();
  }, [carregar]);

  async function conectar() {
    setConectando(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
        body: {},
      });
      if (error || !data?.auth_url) {
        toast.error("Não consegui gerar a URL de consent.");
        setConectando(false);
        return;
      }
      window.location.href = data.auth_url as string;
    } catch (_e) {
      toast.error("Falha inesperada ao iniciar OAuth.");
      setConectando(false);
    }
  }

  async function desconectar() {
    if (!usuario?.id) return;
    setDesconectando(true);
    const { error } = await supabase
      .from("usuario_gmail_oauth")
      .delete()
      .eq("usuario_id", usuario.id);
    setDesconectando(false);
    if (error) {
      toast.error("Falha ao desconectar.");
      return;
    }
    toast.success("Gmail desconectado.");
    setVinculo(null);
  }

  if (usuario && usuario.tipo !== "interno") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Integração Gmail (INSS)
        </CardTitle>
        <CardDescription>
          Conecta a caixa de entrada que recebe os e-mails do INSS. A função{" "}
          <code>inss-email-processor</code> usa esse vínculo para criar
          andamentos e tarefas automaticamente. Permissão pedida:{" "}
          <strong>leitura</strong> (gmail.readonly).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : vinculo ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />
              <div>
                <div>
                  Conectado como{" "}
                  <strong className="font-medium">{vinculo.email_conectado}</strong>
                </div>
                <div className="text-xs text-muted-foreground">
                  Desde {new Date(vinculo.connected_at).toLocaleString("pt-BR")}
                  {vinculo.last_used_at && (
                    <>
                      {" · "}último uso{" "}
                      {new Date(vinculo.last_used_at).toLocaleString("pt-BR")}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={desconectar}
                disabled={desconectando}
              >
                {desconectando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="h-4 w-4" />
                )}
                Desconectar
              </Button>
              <Button variant="outline" size="sm" onClick={conectar} disabled={conectando}>
                {conectando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                Reconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Nenhum Gmail conectado ainda. Clique para autorizar o acesso à
              caixa que recebe os e-mails do INSS.
            </p>
            <Button onClick={conectar} disabled={conectando}>
              {conectando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              Conectar Gmail
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
