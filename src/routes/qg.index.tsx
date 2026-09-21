// QG · Escritórios: a lista, os alertas e a criação de escritório.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Building2, Loader2, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { dataBR, dataHoraBR } from "@/lib/fuso";
import { urlDoProduto } from "@/lib/qg/host";
import { ROTULO_STATUS, type QgEscritorio } from "@/lib/qg/tipos";
import { useQg } from "@/lib/qg/contexto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/qg/")({
  component: QgEscritorios,
});

const COR_STATUS: Record<QgEscritorio["status"], string> = {
  ativo: "bg-emerald-100 text-emerald-800 border-emerald-200",
  provisionando: "bg-sky-100 text-sky-800 border-sky-200",
  suspenso: "bg-amber-100 text-amber-900 border-amber-200",
  encerrado: "bg-slate-200 text-slate-700 border-slate-300",
};

function slugDe(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function QgEscritorios() {
  const qg = useQg();
  const [lista, setLista] = useState<Array<QgEscritorio> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("qg_escritorios");
    if (error) {
      setErro(error.message);
      return;
    }
    setErro(null);
    setLista((data ?? []) as Array<QgEscritorio>);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alertas = (lista ?? []).flatMap((e) => {
    const a: Array<{ esc: QgEscritorio; texto: string }> = [];
    if (e.status === "ativo" && e.admins === 0) a.push({ esc: e, texto: "sem administrador ativo" });
    if (e.status === "ativo" && e.admins_sem_mfa > 0) a.push({ esc: e, texto: `${e.admins_sem_mfa} admin(s) sem verificação em duas etapas` });
    if (e.status === "provisionando") a.push({ esc: e, texto: "criado, mas o primeiro admin ainda não entrou" });
    if (e.suporte_aberto > 0) a.push({ esc: e, texto: `${e.suporte_aberto} acesso(s) de suporte em aberto` });
    return a;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Escritórios</h1>
          <p className="text-sm text-slate-600">
            Todos os escritórios da plataforma — estado, equipe e uso. Nenhum dado de cliente aparece aqui.
          </p>
        </div>
        {qg.pode("escritorios_gerenciar") && (
          <Button onClick={() => setCriando(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo escritório
          </Button>
        )}
      </div>

      {erro && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-red-800">
            <ShieldAlert className="h-4 w-4" />
            Não consegui carregar os escritórios: {erro}
          </CardContent>
        </Card>
      )}

      {alertas.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              Pede atenção
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-amber-900">
              {alertas.map((a, i) => (
                <li key={i}>
                  <Link to="/qg/escritorios/$id" params={{ id: a.esc.id }} className="font-medium underline-offset-2 hover:underline">
                    {a.esc.nome}
                  </Link>
                  {" — "}
                  {a.texto}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {lista === null && !erro ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Escritório</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Equipe</TableHead>
                  <TableHead className="text-right">Casos</TableHead>
                  <TableHead className="text-right">Documentos</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead>Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lista ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link to="/qg/escritorios/$id" params={{ id: e.id }} className="flex items-center gap-2 font-medium hover:underline">
                        <Building2 className="h-4 w-4 text-slate-400" />
                        {e.nome}
                      </Link>
                      <div className="pl-6 text-xs text-slate-500">
                        {e.slug}
                        {e.padrao_sistema ? " · escritório padrão do sistema" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={COR_STATUS[e.status]}>
                        {ROTULO_STATUS[e.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.membros_ativos}
                      <span className="text-xs text-slate-500"> · {e.admins} admin</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.casos}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.documentos}</TableCell>
                    <TableCell className="text-sm text-slate-600">{e.ultimo_acesso ? dataHoraBR(e.ultimo_acesso) : "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600">{dataBR(e.criado_em)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NovoEscritorioDialog
        aberto={criando}
        onFechar={() => setCriando(false)}
        onCriado={() => {
          setCriando(false);
          void carregar();
        }}
      />
    </div>
  );
}

function NovoEscritorioDialog(props: { aberto: boolean; onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditado, setSlugEditado] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!slugEditado) setSlug(slugDe(nome));
  }, [nome, slugEditado]);

  async function criar() {
    setSalvando(true);
    try {
      const resp = await supabase.functions.invoke("qg-escritorios", {
        body: {
          action: "criar_escritorio",
          nome: nome.trim(),
          slug: slug.trim(),
          cnpj: cnpj.trim() || null,
          admin_nome: adminNome.trim(),
          admin_email: adminEmail.trim().toLowerCase(),
          // o convite leva para o PRODUTO, não para o QG
          redirect_to: `${urlDoProduto()}login`,
        },
      });
      const r = (resp.data ?? {}) as { ok?: boolean; error?: string; conta_nova?: boolean };
      if (resp.error || r.error) {
        // FunctionsHttpError esconde o corpo: tenta ler a mensagem da function.
        let msg = r.error ?? resp.error?.message ?? "Falha ao criar o escritório";
        const ctx = (resp.error as { context?: Response } | null)?.context;
        if (ctx && typeof ctx.json === "function") {
          const corpo = (await ctx.json().catch(() => null)) as { error?: string } | null;
          if (corpo?.error) msg = corpo.error;
        }
        toast.error(msg);
        return;
      }
      toast.success(
        r.conta_nova
          ? `Escritório criado. Convite enviado para ${adminEmail.trim().toLowerCase()}.`
          : "Escritório criado. A pessoa já tinha conta e foi vinculada como admin.",
      );
      setNome("");
      setSlug("");
      setSlugEditado(false);
      setCnpj("");
      setAdminNome("");
      setAdminEmail("");
      props.onCriado();
    } finally {
      setSalvando(false);
    }
  }

  const valido =
    nome.trim().length >= 3 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) &&
    adminNome.trim().length >= 3 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail.trim());

  return (
    <Dialog open={props.aberto} onOpenChange={(o) => !o && !salvando && props.onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo escritório</DialogTitle>
          <DialogDescription>
            Nasce com os tipos de benefício e os templates padrão — sem nenhum dado, nome ou responsável de outro
            escritório. O primeiro admin recebe o convite por e-mail e cria a própria senha.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="qg-nome">Nome do escritório</Label>
            <Input id="qg-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Silva & Costa Advogados" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qg-slug">Identificador (slug)</Label>
              <Input
                id="qg-slug"
                value={slug}
                onChange={(e) => {
                  setSlugEditado(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                placeholder="silva-costa"
              />
            </div>
            <div>
              <Label htmlFor="qg-cnpj">CNPJ (opcional)</Label>
              <Input id="qg-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0001-00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qg-admin-nome">Primeiro admin — nome</Label>
              <Input id="qg-admin-nome" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="qg-admin-email">Primeiro admin — e-mail</Label>
              <Input id="qg-admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={criar} disabled={!valido || salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar escritório
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
