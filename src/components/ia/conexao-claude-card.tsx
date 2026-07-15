// Card "Conectar Claude / ChatGPT" (Superficie B).
// Gera/revoga Personal Access Tokens e mostra como ligar o servidor MCP no
// Claude do proprio usuario. O token em claro aparece UMA UNICA VEZ, na criacao.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Copy, Trash2, Plug, KeyRound, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { iaTokens, IA_MCP_URL, type IaToken } from "@/lib/ia/client";

function copiar(texto: string, msg = "Copiado") {
  navigator.clipboard.writeText(texto).then(
    () => toast.success(msg),
    () => toast.error("Nao foi possivel copiar"),
  );
}

export function ConexaoClaudeCard() {
  const [carregando, setCarregando] = useState(true);
  const [tokens, setTokens] = useState<IaToken[]>([]);

  const [nome, setNome] = useState("");
  const [escopo, setEscopo] = useState<"leitura" | "completo">("leitura");
  const [dias, setDias] = useState("90");
  const [criando, setCriando] = useState(false);
  const [novoToken, setNovoToken] = useState<string | null>(null);

  async function carregar() {
    const { data } = await iaTokens.listar();
    if (data) setTokens(data.tokens);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function criar() {
    setCriando(true);
    const { data, error } = await iaTokens.criar({
      nome: nome.trim() || "Meu Claude",
      escopo,
      dias: dias === "0" ? undefined : Number(dias),
    });
    setCriando(false);
    if (data?.ok) {
      setNovoToken(data.token);
      setNome("");
      await carregar();
    } else {
      toast.error(error?.message || "Falha ao gerar token");
    }
  }

  async function revogar(id: string) {
    const { data, error } = await iaTokens.revogar(id);
    if (data?.ok) {
      toast.success("Token revogado");
      await carregar();
    } else {
      toast.error(error?.message || "Falha ao revogar");
    }
  }

  const ativos = tokens.filter((t) => !t.revogado_em);
  const snippet =
    "claude mcp add --transport http mara-sandra " +
    IA_MCP_URL +
    ' --header "Authorization: Bearer SEU_TOKEN"';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Conectar Claude / ChatGPT
        </CardTitle>
        <CardDescription>
          Use o assistente dentro do seu proprio Claude (ou ChatGPT) via MCP, com o modelo da sua
          assinatura - sem precisar de chave de API. Gere um token e conecte. Por enquanto, so
          leitura.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Token recem-criado: mostrado uma unica vez */}
        {novoToken && (
          <div className="rounded-md border border-[var(--gold)]/50 bg-[var(--gold-soft)]/30 p-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Copie agora - este token nao sera mostrado de novo.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
                {novoToken}
              </code>
              <Button
                size="icon"
                variant="outline"
                onClick={() => copiar(novoToken, "Token copiado")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setNovoToken(null)}>
              Ja copiei
            </Button>
          </div>
        )}

        {/* Gerar novo token */}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <Label className="text-xs">Nome do token</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Meu Claude Desktop"
            />
          </div>
          <div>
            <Label className="text-xs">Acesso</Label>
            <Select value={escopo} onValueChange={(v) => setEscopo(v as "leitura" | "completo")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leitura">Somente leitura</SelectItem>
                <SelectItem value="completo">Leitura e escrita</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Validade</Label>
            <Select value={dias} onValueChange={setDias}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
                <SelectItem value="365">1 ano</SelectItem>
                <SelectItem value="0">Sem expiracao</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={criar} disabled={criando}>
            {criando ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Gerar token
          </Button>
        </div>

        {/* Tokens existentes */}
        <div>
          <Label className="text-xs">Tokens ativos</Label>
          {carregando ? (
            <div className="flex h-12 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : ativos.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum token ativo.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {ativos.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    {/* div (nao <p>): Badge renderiza <div> e div dentro de p
                        e HTML invalido — causava erro de hidratacao */}
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <KeyRound className="h-3.5 w-3.5 shrink-0" />
                      {t.nome}
                      <Badge variant="outline" className="text-[10px]">
                        {t.escopo}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.prefixo}... -{" "}
                      {t.expira_em
                        ? "expira " + new Date(t.expira_em).toLocaleDateString("pt-BR")
                        : "sem expiracao"}
                      {t.ultimo_uso
                        ? " - usado " + new Date(t.ultimo_uso).toLocaleDateString("pt-BR")
                        : " - nunca usado"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revogar(t.id)}
                    aria-label="Revogar token"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Como conectar */}
        <div className="rounded-md bg-muted/50 p-3">
          <p className="mb-2 text-xs font-medium">Como conectar</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>
              <span className="text-foreground">URL do servidor MCP:</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1">
                  {IA_MCP_URL}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => copiar(IA_MCP_URL, "URL copiada")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <span className="text-foreground">Claude Code (terminal):</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1">
                  {snippet}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => copiar(snippet, "Comando copiado")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p>
              No Claude Desktop, use o conector remoto (mcp-remote) apontando para a URL acima e
              passando o header Authorization com o seu token.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
