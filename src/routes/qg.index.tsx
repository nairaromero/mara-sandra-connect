// QG · Escritórios: a lista, os alertas e a criação de escritório.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Building2, Loader2, Plus, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { dataBR, dataHoraBR } from "@/lib/fuso";
import { urlDoProduto } from "@/lib/qg/host";
import { ROTULO_STATUS, type QgAlerta, type QgEscritorio } from "@/lib/qg/tipos";
import { useListaPaginada, useValorAtrasado } from "@/hooks/use-lista-paginada";
import { CarregarMais } from "@/components/carregar-mais";
import { useQg } from "@/lib/qg/contexto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const POR_PAGINA = 10;

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
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("");
  const [criando, setCriando] = useState(false);
  const [alertas, setAlertas] = useState<Array<QgAlerta>>([]);
  const [erroAlertas, setErroAlertas] = useState<string | null>(null);
  const buscaAtrasada = useValorAtrasado(busca.trim(), 250);

  // Uma pagina por vez: as contagens por escritorio so rodam para as linhas
  // devolvidas. Busca/status mudam a chave -> recomeca do zero.
  const lista = useListaPaginada<QgEscritorio>(
    (offset, limite) =>
      supabase.rpc("qg_escritorios", {
        p_busca: buscaAtrasada || null,
        p_status: status || null,
        p_limite: limite,
        p_offset: offset,
      }),
    `${buscaAtrasada}|${status}`,
    POR_PAGINA,
    (e) => e.id,
  );

  const carregarAlertas = useCallback(async () => {
    const { data, error } = await supabase.rpc("qg_alertas");
    if (error) {
      setErroAlertas(error.message);
      return;
    }
    setErroAlertas(null);
    setAlertas((data ?? []) as Array<QgAlerta>);
  }, []);

  useEffect(() => {
    void carregarAlertas();
  }, [carregarAlertas]);

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

      {(lista.erro || erroAlertas) && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-red-800">
            <ShieldAlert className="h-4 w-4" />
            Não consegui carregar os escritórios: {lista.erro ?? erroAlertas}
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
                  <Link to="/qg/escritorios/$id" params={{ id: a.escritorio_id }} className="font-medium underline-offset-2 hover:underline">
                    {a.nome}
                  </Link>
                  {" — "}
                  {a.alerta}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, slug ou CNPJ…"
            aria-label="Buscar escritório"
            className="bg-white pl-9"
          />
        </div>
        <Select value={status || "todos"} onValueChange={(v) => setStatus(v === "todos" ? "" : v)}>
          <SelectTrigger className="w-44 bg-white" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {(Object.keys(ROTULO_STATUS) as Array<QgEscritorio["status"]>).map((s) => (
              <SelectItem key={s} value={s}>
                {ROTULO_STATUS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {lista.carregando ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : lista.itens.length === 0 && !lista.erro ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {buscaAtrasada || status ? "Nenhum escritório com esse filtro." : "Nenhum escritório ainda."}
            </p>
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
                {lista.itens.map((e) => (
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
          <CarregarMais
            mostrando={lista.itens.length}
            total={lista.total}
            temMais={lista.temMais}
            carregando={lista.carregandoMais}
            onMais={lista.mais}
            passo={POR_PAGINA}
            nome="escritórios"
            className="border-t"
          />
        </CardContent>
      </Card>

      <NovoEscritorioDialog
        aberto={criando}
        onFechar={() => setCriando(false)}
        onCriado={() => {
          setCriando(false);
          lista.recarregar();
          void carregarAlertas();
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
