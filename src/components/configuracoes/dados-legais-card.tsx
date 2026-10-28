// Dados legais do escritório — o que os termos do parceiro citam (#496).
//
// O Acordo de Tratamento de Dados, o Termo de Uso e a Política de Privacidade
// que o parceiro assina no primeiro acesso citam a razão social, o CNPJ, o
// endereço, o foro e o canal de privacidade DO ESCRITÓRIO. Antes eram fixos no
// código, com os dados de um escritório só. Agora ficam em
// `escritorio_config.dados_legais`, gravados pela RPC
// `escritorio_definir_dados_legais` (quem configura o escritório; auditado).
// Sem razão social, CNPJ, endereço e foro, o parceiro não consegue assinar.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, ScrollText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { lerUm } from "@/lib/leitura";
import { useAuth } from "@/hooks/use-auth";
import { dadosLegaisDe, faltamDadosLegais, type DadosLegais } from "@/lib/legal/termos";

const CAMPOS: Array<{ chave: keyof DadosLegais; rotulo: string; placeholder: string; largo?: boolean }> = [
  { chave: "razao_social", rotulo: "Razão social", placeholder: "Nome jurídico do escritório", largo: true },
  { chave: "cnpj", rotulo: "CNPJ", placeholder: "00.000.000/0000-00" },
  { chave: "foro", rotulo: "Foro (comarca)", placeholder: "Cidade/UF" },
  { chave: "endereco", rotulo: "Endereço da sede", placeholder: "Rua, nº, bairro – cidade/UF – CEP", largo: true },
  { chave: "privacidade_contato", rotulo: "Contato de privacidade (LGPD)", placeholder: "Nome de quem responde" },
  { chave: "privacidade_email", rotulo: "E-mail de privacidade", placeholder: "privacidade@escritorio.com.br" },
  { chave: "privacidade_tel", rotulo: "Telefone de privacidade (opcional)", placeholder: "(00) 00000-0000" },
];

export function DadosLegaisCard() {
  const { escritorio, podeChamar } = useAuth();
  const escritorioId = escritorio?.escritorio_id ?? null;
  const [salvo, setSalvo] = useState<DadosLegais | null>(null);
  const [rascunho, setRascunho] = useState<DadosLegais | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!escritorioId) return;
    let vivo = true;
    lerUm<{ dados_legais: unknown }>(
      supabase.from("escritorio_config").select("dados_legais").eq("escritorio_id", escritorioId).maybeSingle(),
      "dados legais do escritório",
    )
      .then((linha) => {
        if (!vivo) return;
        const d = dadosLegaisDe(linha?.dados_legais);
        setSalvo(d);
        setRascunho(d);
        setErro(null);
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [escritorioId]);

  if (!escritorio || !podeChamar("escritorio_definir_dados_legais")) return null;

  const mudou = !!salvo && !!rascunho && CAMPOS.some((c) => salvo[c.chave] !== rascunho[c.chave]);
  const faltam = rascunho ? faltamDadosLegais(rascunho) : [];

  async function salvar() {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const { data, error } = await supabase.rpc("escritorio_definir_dados_legais", { p_dados: rascunho });
      if (error) throw error;
      const d = dadosLegaisDe(data);
      setSalvo(d);
      setRascunho(d);
      toast.success("Dados legais salvos");
    } catch (e) {
      toast.error(`Não salvou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card data-card-dados-legais>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ScrollText className="h-4 w-4" />
          Dados legais (termos dos parceiros)
        </CardTitle>
        <CardDescription>
          O que o Acordo de Tratamento de Dados, o Termo de Uso e a Política de Privacidade citam
          quando o parceiro assina no primeiro acesso. Sem razão social, CNPJ, endereço e foro, o
          parceiro não consegue assinar. Mudar estes dados vale para as próximas assinaturas; o
          comprovante de quem já assinou guarda o texto assinado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {erro && <p className="text-sm text-destructive">Não consegui ler os dados legais: {erro}</p>}
        {!rascunho && !erro && (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {rascunho && (
          <>
            {faltam.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300" data-dados-legais-faltam>
                Falta preencher para os parceiros poderem assinar.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS.map((c) => (
                <div key={c.chave} className={"space-y-1 " + (c.largo ? "sm:col-span-2" : "")}>
                  <Label htmlFor={`dl-${c.chave}`} className="text-xs">
                    {c.rotulo}
                  </Label>
                  <Input
                    semGerenciadorDeSenha
                    id={`dl-${c.chave}`}
                    value={rascunho[c.chave]}
                    onChange={(e) => setRascunho((r) => (r ? { ...r, [c.chave]: e.target.value } : r))}
                    placeholder={c.placeholder}
                    maxLength={300}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void salvar()} disabled={!mudou || salvando} data-dados-legais-salvar>
                {salvando ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Save className="h-3 w-3 mr-2" />}
                Salvar dados legais
              </Button>
              {mudou && <span className="text-xs text-muted-foreground">Alterações não salvas.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
