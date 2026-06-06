// Estado da conversa com o assistente de IA (Superficie A, in-app).
// Fase 1: leitura + escrita COM CONFIRMACAO. Escritas propostas pelo modelo
// chegam como "pendentes" (assinadas no servidor) e so sao aplicadas quando o
// usuario clica em confirmar.

import { useCallback, useRef, useState } from "react";
import { iaAssistant, type IaChatMessage, type IaContexto, type IaPendente } from "@/lib/ia/client";

export function useIaAssistant(contexto?: IaContexto) {
  const [messages, setMessages] = useState<IaChatMessage[]>([]);
  const [pendentes, setPendentes] = useState<IaPendente[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sempre envia o contexto da tela ATUAL (caso aberto) no momento do envio.
  const contextoRef = useRef<IaContexto | undefined>(contexto);
  contextoRef.current = contexto;

  const enviar = useCallback(
    async (texto: string) => {
      const t = texto.trim();
      if (!t || loading) return;
      setErro(null);
      const base: IaChatMessage[] = [...messages, { role: "user", content: t }];
      setMessages(base);
      setLoading(true);
      const { data, error } = await iaAssistant.chat(base, contextoRef.current);
      if (error) {
        if (error.code === "nao_configurado") {
          setErro("Configure o assistente em Configuracoes antes de usar.");
        } else if (error.code === "desativado") {
          setErro("O assistente esta desativado. Ative em Configuracoes.");
        } else {
          setErro(error.message);
        }
      } else if (data) {
        setMessages([...base, { role: "assistant", content: data.text || "(sem resposta)" }]);
        setPendentes(data.pendentes ?? []);
      }
      setLoading(false);
    },
    [messages, loading],
  );

  const confirmar = useCallback(async (p: IaPendente) => {
    setConfirmando(true);
    setErro(null);
    const { data, error } = await iaAssistant.confirmar(p);
    if (data?.ok) {
      setMessages((m) => [...m, { role: "assistant", content: "Feito: " + p.preview }]);
      setPendentes((ps) => ps.filter((x) => x.sig !== p.sig));
    } else {
      setErro(error?.message || data?.error || "Falha ao confirmar");
    }
    setConfirmando(false);
  }, []);

  const cancelar = useCallback((p: IaPendente) => {
    setPendentes((ps) => ps.filter((x) => x.sig !== p.sig));
    setMessages((m) => [...m, { role: "assistant", content: "Cancelado: " + p.preview }]);
  }, []);

  const limpar = useCallback(() => {
    setMessages([]);
    setPendentes([]);
    setErro(null);
  }, []);

  return { messages, pendentes, loading, confirmando, erro, enviar, confirmar, cancelar, limpar };
}

export type UseIaAssistant = ReturnType<typeof useIaAssistant>;
