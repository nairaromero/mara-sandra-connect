// Parceiro cumpre o pedido de troca da senha do Meu INSS (card #305).
// Usado no kanban do parceiro, no hub /documentos e na tela do caso — as três
// portas por onde ele cumpre solicitações.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cumprirTrocaSenhaMeuInss, mensagemErroSenha } from "@/lib/documentos/senha-meu-inss";
import { formatarBR } from "@/lib/fuso";

export interface PedidoSenhaParaCumprir {
  id: string;
  clienteNome: string | null;
  descricao: string | null;
  prazoAt: string | null;
  solicitanteNome: string | null;
}

export function CumprirTrocaSenhaDialog(props: {
  pedido: PedidoSenhaParaCumprir | null;
  onClose: () => void;
  onCumprido: () => void;
}) {
  const { pedido, onClose, onCumprido } = props;
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Nada da senha sobrevive entre aberturas.
  useEffect(() => {
    setSenha("");
    setConfirmacao("");
    setVer(false);
    setSalvando(false);
  }, [pedido?.id]);

  // Espaço nas pontas (senha colada) não conta — igual ao "Alterar" antigo.
  const senhaLimpa = senha.trim();
  const confere = senhaLimpa.length > 0 && senhaLimpa === confirmacao.trim();
  const diverge = confirmacao.length > 0 && senhaLimpa !== confirmacao.trim();

  async function salvar() {
    if (!pedido || !confere || salvando) return;
    if (!senhaLimpa) {
      toast.error("Informe a nova senha.");
      return;
    }
    setSalvando(true);
    try {
      await cumprirTrocaSenhaMeuInss(pedido.id, senhaLimpa);
      toast.success("Senha do Meu INSS alterada — a equipe foi avisada.");
      setSenha("");
      setConfirmacao("");
      onCumprido();
    } catch (err) {
      toast.error(
        mensagemErroSenha(err, "Não foi possível salvar a nova senha agora. Tente de novo em instantes."),
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={pedido !== null} onOpenChange={(o) => !o && !salvando && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Informar nova senha do Meu INSS
          </DialogTitle>
          <DialogDescription>
            {pedido?.clienteNome ? (
              <>
                Pedido da equipe para o cliente <strong>{pedido.clienteNome}</strong>
                {pedido.solicitanteNome ? <> (pedido de {pedido.solicitanteNome})</> : null}.
              </>
            ) : (
              "Pedido da equipe para trocar a senha do Meu INSS do cliente."
            )}
          </DialogDescription>
        </DialogHeader>

        {pedido && (pedido.descricao || pedido.prazoAt) && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            {pedido.descricao && (
              <p className="whitespace-pre-wrap">
                <span className="text-xs text-muted-foreground">Motivo: </span>
                {pedido.descricao}
              </p>
            )}
            {pedido.prazoAt && (
              <p>
                <span className="text-xs text-muted-foreground">Prazo: </span>
                {formatarBR(pedido.prazoAt, { day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="troca-senha-nova" className="text-xs">
              Nova senha do Meu INSS
            </Label>
            <div className="flex gap-1">
              <Input
                id="troca-senha-nova"
                type={ver ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setVer((v) => !v)}
                title={ver ? "Ocultar senha" : "Mostrar senha"}
              >
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="troca-senha-confirmacao" className="text-xs">
              Repita a nova senha
            </Label>
            <Input
              id="troca-senha-confirmacao"
              type={ver ? "text" : "password"}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
            />
            {diverge && <p className="text-xs text-destructive">As senhas não conferem.</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            A senha é gravada criptografada e substitui a atual. Nunca envie a senha por e-mail ou
            WhatsApp — informe só por aqui.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!confere || salvando}>
            {salvando && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Salvar nova senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
