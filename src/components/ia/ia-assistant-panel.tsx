// Conteudo do painel de chat do assistente (vai dentro do SheetContent).
// Fase 0: somente leitura. O texto do modelo e renderizado como TEXTO
// (React escapa por padrao) — sem dangerouslySetInnerHTML (gap de seguranca #11).

import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal, Sparkles, Trash2, AlertTriangle, Check, X } from "lucide-react";

import type { UseIaAssistant } from "@/hooks/use-ia-assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SUGESTOES = [
  "Liste meus 5 casos mais recentes",
  "Quais casos estao na fase judicial?",
  "Mostre as solicitacoes de documento pendentes",
];

const SUGESTOES_CASO = [
  "Resuma este caso",
  "Liste os andamentos deste caso",
  "Quais solicitacoes de documento estao pendentes neste caso?",
];

export function IaAssistantPanel({ ia, noCaso }: { ia: UseIaAssistant; noCaso?: boolean }) {
  const { messages, pendentes, loading, confirmando, erro, enviar, confirmar, cancelar, limpar } =
    ia;
  const [texto, setTexto] = useState("");
  const fimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function submeter() {
    const t = texto;
    setTexto("");
    enviar(t);
  }

  const vazio = messages.length === 0;
  const sugestoes = noCaso ? SUGESTOES_CASO : SUGESTOES;

  return (
    <div className="flex h-full flex-col">
      {/* Cabecalho */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--gold)]" />
          <span className="text-sm font-semibold">Assistente de IA</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            beta
          </span>
          {noCaso && (
            <span className="rounded bg-[var(--gold-soft)]/50 px-1.5 py-0.5 text-[10px] text-foreground">
              neste caso
            </span>
          )}
        </div>
        {!vazio && (
          <Button variant="ghost" size="sm" onClick={limpar} aria-label="Limpar conversa">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Mensagens */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {vazio && (
          <div className="space-y-3 pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Pergunte sobre seus casos, clientes e andamentos. Eu consulto os dados reais e posso
              criar ou atualizar registros (respeitando suas permissoes) - sempre pedindo sua
              confirmacao antes de gravar. Nunca apago nada.
            </p>
            <div className="flex flex-col gap-2">
              {sugestoes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
              }
            >
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
            </div>
          </div>
        ))}

        {pendentes.map((p) => (
          <div
            key={p.sig}
            className="rounded-xl border border-[var(--gold)]/50 bg-[var(--gold-soft)]/20 p-3"
          >
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-[var(--gold)]">
              <AlertTriangle className="h-3.5 w-3.5" /> Confirmar acao
            </p>
            <p className="mb-2 break-words text-sm">{p.preview}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={confirmando} onClick={() => confirmar(p)}>
                <Check className="mr-1 h-3.5 w-3.5" /> Confirmar
              </Button>
              <Button size="sm" variant="ghost" disabled={confirmando} onClick={() => cancelar(p)}>
                <X className="mr-1 h-3.5 w-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Consultando...
            </div>
          </div>
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div ref={fimRef} />
      </div>

      {/* Entrada */}
      <div className="border-t p-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submeter();
          }}
        >
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Pergunte sobre seus casos..."
            disabled={loading}
            autoComplete="off"
          />
          <Button type="submit" size="icon" disabled={loading || !texto.trim()}>
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </form>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Respostas geradas por IA podem conter erros. Confira dados sensiveis.
        </p>
      </div>
    </div>
  );
}
