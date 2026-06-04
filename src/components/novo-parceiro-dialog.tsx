import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function maskTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

interface ParceiroCriado {
  id: string;
  nome: string | null;
  email: string | null;
}

export function NovoParceiroDialog(
  { onCriado }: { onCriado: (p: ParceiroCriado) => void },
) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [oab, setOab] = useState("");
  const [telefone, setTelefone] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  function reset() {
    setNome("");
    setEmail("");
    setOab("");
    setTelefone("");
    setObs("");
  }

  async function salvar() {
    const emailNorm = email.trim().toLowerCase();
    if (nome.trim().length < 3) {
      toast.error("Informe o nome completo do parceiro");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) {
      toast.error("E-mail invalido");
      return;
    }
    if (oab.trim().length < 3) {
      toast.error("Informe o numero da OAB");
      return;
    }
    if (telefone.replace(/\D/g, "").length < 10) {
      toast.error("Telefone incompleto");
      return;
    }
    setSalvando(true);
    try {
      const redirectTo = typeof window !== "undefined"
        ? `${window.location.origin}/login`
        : undefined;
      // Criacao via edge function (admin API). Nao mexe na sessao do interno
      // logado e nao sofre rate-limit de OTP do navegador.
      const resp = await supabase.functions.invoke("convidar-parceiro", {
        body: {
          nome: nome.trim(),
          email: emailNorm,
          oab: oab.trim(),
          telefone: telefone.trim(),
          observacoes: obs.trim() || null,
          redirect_to: redirectTo,
        },
      });
      if (resp.error) throw resp.error;
      const r = (resp.data || {}) as {
        ok?: boolean;
        id?: string;
        nome?: string;
        email?: string;
        ja_existia?: boolean;
        error?: string;
      };
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (r.id) {
        onCriado({
          id: r.id,
          nome: r.nome ?? nome.trim(),
          email: r.email ?? emailNorm,
        });
      }
      toast.success(
        r.ja_existia
          ? "Parceiro ja existia — selecionado no caso."
          : `Parceiro criado e link de acesso enviado para ${emailNorm}.` +
            (r.id ? " Ja selecionado no caso." : ""),
      );
      reset();
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(
        (err as { message?: string }).message || "Erro ao criar parceiro",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <UserPlus className="h-4 w-4 mr-1" />
        Parceiro
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo parceiro</DialogTitle>
          <DialogDescription>
            Cria o parceiro e envia um link de acesso por e-mail. Ele ja fica
            selecionado neste caso.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome completo *</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do parceiro"
            />
          </div>
          <div>
            <Label className="text-xs">E-mail *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">OAB *</Label>
              <Input
                value={oab}
                onChange={(e) => setOab(e.target.value)}
                placeholder="OAB/SP 000000"
              />
            </div>
            <div>
              <Label className="text-xs">Telefone *</Label>
              <Input
                value={telefone}
                inputMode="tel"
                onChange={(e) => setTelefone(maskTelefone(e.target.value))}
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observacoes</Label>
            <Textarea
              rows={2}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={salvando}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Criar e convidar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
