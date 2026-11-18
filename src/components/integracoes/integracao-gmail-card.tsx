// Card "Integração Gmail" em Configurações.
// Conecta a caixa de entrada do INSS DO ESCRITÓRIO via OAuth Google. O fluxo é:
//   1. Botão "Conectar Gmail" -> chama edge function gmail-oauth-start,
//      recebe auth_url e redireciona o navegador (o escritório ativo vai no state).
//   2. Google consent -> redirect para gmail-oauth-callback (server-side),
//      que troca code por tokens, cifra refresh_token e salva no banco, ligado
//      ao escritório.
//   3. Callback redireciona de volta para /configuracoes?gmail=ok|error.
//
// As caixas são DO ESCRITÓRIO (RBAC 09) e podem ser várias: o card lista todas
// as caixas conectadas no escritório ativo (RPC gmail_inss_status — só quem
// gerencia integrações), quem conectou cada uma, e deixa conectar outra ou
// desconectar qualquer uma. A rotina lê TODAS. Nunca recebe o token em claro —
// só e-mail e datas.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Plug, Unplug, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { formatarBR } from "@/lib/fuso";
import { useAuth } from "@/hooks/use-auth";

interface VinculoGmail {
  id: string;
  email_conectado: string;
  connected_at: string;
  last_used_at: string | null;
  conectado_por: string | null;
  e_minha: boolean;
}

export function IntegracaoGmailCard() {
  const { usuario, pode } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [caixas, setCaixas] = useState<Array<VinculoGmail>>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  /** id da caixa que está sendo desconectada */
  const [desconectando, setDesconectando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!usuario?.id) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data, error } = await supabase.rpc("gmail_inss_status");
    if (error) {
      // erro NAO vira "nao conectado": o admin precisa saber que a leitura falhou
      setErro(error.message);
      setCaixas([]);
    } else {
      setErro(null);
      setCaixas((data ?? []) as Array<VinculoGmail>);
    }
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
    window.history.replaceState({}, "", `${window.location.pathname}${novo ? "?" + novo : ""}`);
    // Recarrega vínculo (pode ter mudado).
    carregar();
  }, [carregar]);

  async function conectar() {
    setConectando(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start", { body: {} });
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

  // Quem gerencia integrações desconecta qualquer caixa DO ESCRITÓRIO (a RLS
  // confere a permissão e o escritório). As outras caixas continuam sendo lidas.
  async function desconectar(caixa: VinculoGmail) {
    if (!window.confirm(`Desconectar ${caixa.email_conectado}? Os e-mails do INSS que chegarem nessa caixa deixam de ser lidos.`)) return;
    setDesconectando(caixa.id);
    const { error } = await supabase.from("usuario_gmail_oauth").delete().eq("id", caixa.id);
    setDesconectando(null);
    if (error) {
      toast.error("Falha ao desconectar.");
      return;
    }
    toast.success(`${caixa.email_conectado} desconectada.`);
    void carregar();
  }

  if (usuario && (usuario.tipo !== "interno" || !pode("integracoes:gerenciar"))) return null;

  return (
    <Card data-card-gmail>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Integração Gmail (INSS)
        </CardTitle>
        <CardDescription>
          As caixas de entrada que recebem os e-mails do INSS <strong>deste escritório</strong> — pode ser mais de
          uma. A rotina <code>inss-email-processor</code> lê todas e cria andamentos e tarefas nos casos daqui.
          Permissão pedida ao Google: <strong>leitura</strong> (gmail.readonly).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {erro && <p className="text-sm text-red-700">Não consegui ler o estado das caixas: {erro}</p>}
        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            {caixas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma caixa conectada neste escritório. Clique para autorizar o acesso à caixa que recebe os
                e-mails do INSS.
              </p>
            ) : (
              <ul className="divide-y rounded-md border" data-caixas-gmail>
                {caixas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-caixa-gmail={c.email_conectado}>
                    <div className="flex min-w-0 items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      <div className="min-w-0">
                        <div>
                          Conectado como <strong className="font-medium">{c.email_conectado}</strong>
                          {c.conectado_por && <span className="text-muted-foreground"> · por {c.e_minha ? "você" : c.conectado_por}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Desde {formatarBR(c.connected_at, { dateStyle: "short", timeStyle: "medium" })}
                          {c.last_used_at && <> · último uso {formatarBR(c.last_used_at, { dateStyle: "short", timeStyle: "medium" })}</>}
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => desconectar(c)} disabled={desconectando === c.id}>
                      {desconectando === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                      Desconectar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={caixas.length === 0 ? "default" : "outline"} size={caixas.length === 0 ? "default" : "sm"} onClick={conectar} disabled={conectando}>
                {conectando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                {caixas.length === 0 ? "Conectar Gmail" : "Conectar outra caixa"}
              </Button>
              {caixas.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  O Google pergunta qual conta usar. Conectar de novo uma caixa da lista só renova o acesso dela.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
