// QG · Equipe da plataforma: quem está no QG e com que papel. Lista nominal,
// fora dos vínculos de escritório — ninguém entra aqui por ser admin de um.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { dataHoraBR } from "@/lib/fuso";
import { urlDoQG } from "@/lib/qg/host";
import { ROTULO_PAPEL_STAFF, type QgStaff } from "@/lib/qg/tipos";
import { useQg } from "@/lib/qg/contexto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/qg/equipe")({
  component: QgEquipe,
});

const PAPEIS = ["dono", "operacao", "suporte", "leitura"] as const;
const O_QUE_FAZ: Record<(typeof PAPEIS)[number], string> = {
  dono: "Tudo, inclusive encerrar escritórios e gerenciar o QG",
  operacao: "Cria, edita, suspende escritórios e opera membros",
  suporte: "Vê os painéis e pede acesso de suporte",
  leitura: "Só os painéis",
};

function QgEquipe() {
  const qg = useQg();
  const [lista, setLista] = useState<Array<QgStaff> | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<(typeof PAPEIS)[number]>("suporte");
  const [enviando, setEnviando] = useState(false);
  const podeGerenciar = qg.pode("staff_gerenciar");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("qg_staff");
    if (error) return toast.error("Não consegui carregar a equipe do QG.", { description: error.message });
    setLista((data ?? []) as Array<QgStaff>);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function convidar() {
    setEnviando(true);
    const resp = await supabase.functions.invoke("qg-escritorios", {
      body: { action: "convidar_staff", nome: nome.trim(), email: email.trim().toLowerCase(), papel, redirect_to: urlDoQG() },
    });
    setEnviando(false);
    const r = (resp.data ?? {}) as { ok?: boolean; error?: string; conta_nova?: boolean };
    if (resp.error || r.error) {
      let msg = r.error ?? resp.error?.message ?? "Falha ao convidar";
      const ctx = (resp.error as { context?: Response } | null)?.context;
      if (ctx && typeof ctx.json === "function") {
        const corpo = (await ctx.json().catch(() => null)) as { error?: string } | null;
        if (corpo?.error) msg = corpo.error;
      }
      return toast.error(msg);
    }
    toast.success(r.conta_nova ? "Convite enviado." : "A pessoa já tinha conta: entrou para o QG.");
    setNome("");
    setEmail("");
    void carregar();
  }

  async function definir(s: QgStaff, patch: Partial<Pick<QgStaff, "papel" | "ativo" | "break_glass">>) {
    const { error } = await supabase.rpc("qg_definir_staff", {
      p_email: s.email,
      p_papel: patch.papel ?? s.papel,
      p_ativo: patch.ativo ?? s.ativo,
      p_break_glass: patch.break_glass ?? s.break_glass,
    });
    if (error) return toast.error(error.message);
    toast.success("Atualizado.");
    void carregar();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipe do QG</h1>
        <p className="text-sm text-slate-600">
          Lista nominal de quem opera a plataforma. Não dá acesso a dado de cliente: para isso existe o suporte aprovado
          pelo escritório.
        </p>
      </div>

      {podeGerenciar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Adicionar pessoa</CardTitle>
            <CardDescription>Conta nova recebe convite por e-mail. Quem já tem conta só ganha o papel no QG.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end">
              <div>
                <Label htmlFor="s-nome">Nome</Label>
                <Input id="s-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="s-email">E-mail</Label>
                <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Papel</Label>
                <Select value={papel} onValueChange={(v) => setPapel(v as (typeof PAPEIS)[number])}>
                  <SelectTrigger aria-label="Papel no QG">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPEIS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {ROTULO_PAPEL_STAFF[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={convidar} disabled={enviando || nome.trim().length < 3 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}>
                {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Adicionar
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">{O_QUE_FAZ[papel]}.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {lista === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Break-glass</TableHead>
                  <TableHead>2 etapas</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead>Ativa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((s) => (
                  <TableRow key={s.usuario_id} className={s.ativo ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="font-medium">{s.nome ?? "(sem nome)"}</div>
                      <div className="text-xs text-slate-500">{s.email}</div>
                    </TableCell>
                    <TableCell>
                      {podeGerenciar ? (
                        <Select value={s.papel} onValueChange={(v) => definir(s, { papel: v as QgStaff["papel"] })}>
                          <SelectTrigger className="h-8 w-36" aria-label={`Papel de ${s.nome ?? s.email}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAPEIS.map((p) => (
                              <SelectItem key={p} value={p}>
                                {ROTULO_PAPEL_STAFF[p]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{ROTULO_PAPEL_STAFF[s.papel]}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch checked={s.break_glass} disabled={!podeGerenciar} onCheckedChange={(v) => definir(s, { break_glass: v })} aria-label="Break-glass" />
                    </TableCell>
                    <TableCell>{s.mfa ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <span className="text-xs text-slate-400">não</span>}</TableCell>
                    <TableCell className="text-sm text-slate-600">{s.ultimo_acesso ? dataHoraBR(s.ultimo_acesso) : "nunca"}</TableCell>
                    <TableCell>
                      <Switch checked={s.ativo} disabled={!podeGerenciar} onCheckedChange={(v) => definir(s, { ativo: v })} aria-label="Ativa no QG" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
