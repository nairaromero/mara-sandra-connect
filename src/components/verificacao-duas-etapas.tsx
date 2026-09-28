// Cadastro e confirmacao do segundo fator (TOTP).
//   modo="cadastrar": gera o fator (QR + segredo para digitar no app
//     autenticador) e confirma o primeiro codigo -> onPronto.
//   modo="confirmar": pede o codigo do fator ja cadastrado (login, QG,
//     desativar) -> sessao vira AAL2 -> onPronto.

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { confirmarCodigo, limparFatoresPendentes } from "@/lib/mfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Cadastro {
  fatorId: string;
  qr: string;
  segredo: string;
}

export function VerificacaoDuasEtapas(props: {
  modo: "cadastrar" | "confirmar";
  fatorId?: string | null;
  onPronto: () => void;
  onCancelar?: () => void;
  rotuloConfirmar?: string;
}) {
  const { modo, fatorId, onPronto, onCancelar, rotuloConfirmar } = props;
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Um enroll so, mesmo com o StrictMode rodando o efeito duas vezes (o
  // segundo enroll batia em "friendly name ja existe"); o nome leva um
  // sufixo unico, e o fator pendente que sobrar e limpo no proximo cadastro.
  // (o StrictMode simula desmontar/montar: o cleanup roda, mas o componente
  // continua o mesmo — por isso o resultado e aplicado sem checar "vivo";
  // setState depois de desmontar de verdade e inofensivo no React 18)
  const enrolando = useRef(false);
  useEffect(() => {
    if (modo !== "cadastrar" || enrolando.current) return;
    enrolando.current = true;
    (async () => {
      try {
        await limparFatoresPendentes();
        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `Autenticador ${new Date().toISOString().slice(0, 16)}`,
        });
        if (error) throw error;
        setCadastro({ fatorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
      } catch (e) {
        setErro((e as Error).message);
      }
    })();
  }, [modo]);

  async function confirmar() {
    const c = codigo.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(c)) {
      setErro("Digite os 6 dígitos do aplicativo.");
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      if (modo === "cadastrar") {
        if (!cadastro) throw new Error("cadastro ainda não carregou");
        const ch = await supabase.auth.mfa.challenge({ factorId: cadastro.fatorId });
        if (ch.error) throw ch.error;
        const ok = await supabase.auth.mfa.verify({ factorId: cadastro.fatorId, challengeId: ch.data.id, code: c });
        if (ok.error) throw ok.error;
      } else {
        if (!fatorId) throw new Error("fator não encontrado");
        await confirmarCodigo(fatorId, c);
      }
      onPronto();
    } catch (e) {
      setErro(/invalid|inválid|expired/i.test((e as Error).message) ? "Código inválido ou expirado. Confira a hora do aparelho e tente de novo." : (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4" data-duas-etapas={modo}>
      {modo === "cadastrar" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Abra o aplicativo autenticador (Google Authenticator, Authy, 1Password, Microsoft Authenticator…), leia o
            QR ou digite a chave, e informe o código de 6 dígitos que ele mostrar.
          </p>
          {cadastro ? (
            <div className="flex flex-wrap items-start gap-4">
              <img src={cadastro.qr} alt="QR do autenticador" className="h-40 w-40 rounded border bg-white p-1" />
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chave (se não der para ler o QR)</div>
                <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs" data-mfa-secret>
                  {cadastro.segredo}
                </code>
              </div>
            </div>
          ) : erro ? null : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Gerando o QR…
            </div>
          )}
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmar();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="mfa-codigo">Código de 6 dígitos</Label>
          <Input
            id="mfa-codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="max-w-[12rem] text-center font-mono text-lg tracking-[0.3em]"
            autoFocus
          />
        </div>
        {erro && (
          <p className="text-sm text-red-700" role="alert">
            {erro}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={ocupado || (modo === "cadastrar" && !cadastro)}>
            {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {rotuloConfirmar ?? (modo === "cadastrar" ? "Ativar verificação" : "Confirmar")}
          </Button>
          {onCancelar && (
            <Button type="button" variant="ghost" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
