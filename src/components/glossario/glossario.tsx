// Glossario com busca. O texto curado vem de src/lib/glossario/termos.ts; as
// permissoes de cada papel do escritorio sao lidas AO VIVO do banco (papeis x
// papel_permissoes x permissoes), para nunca ficarem diferentes do que vale.
//
// A busca olha nome, sinonimos, definicao e — nos papeis — as permissoes:
// procurar "auditoria" acha o termo Auditoria e o papel que pode ve-la.
// Compartilhado pelo produto (/glossario) e pelo QG (/qg/glossario); quem
// chama decide o publico (quais termos aparecem) e o cabecalho.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, ShieldAlert, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CATEGORIAS, TERMOS, normalizar, type Categoria, type Publico, type Termo } from "@/lib/glossario/termos";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface GlossarioProps {
  contexto: "produto" | "qg";
  /** quem esta lendo: decide quais termos aparecem */
  publico: ReadonlySet<Publico>;
  /** chave do papel da pessoa no escritorio ativo (admin, advogado...) */
  papelAtual?: string | null;
  /** papel no QG (dono, operacao, suporte, leitura) */
  papelStaffAtual?: string | null;
  q: string;
  onQ: (q: string) => void;
}

interface PermissaoDoPapel {
  permissao: string;
  escopo: string;
  grupo: string;
  descricao: string;
}
interface PapelVivo {
  chave: string;
  nome: string;
  descricao: string | null;
  tipo_acesso: string;
  permissoes: Array<PermissaoDoPapel>;
}
// Linha crua do embed papeis -> papel_permissoes -> permissoes.
interface LinhaPapel {
  chave: string;
  nome: string;
  descricao: string | null;
  tipo_acesso: string;
  papel_permissoes: Array<{
    permissao: string;
    escopo: string;
    permissoes: { grupo: string; descricao: string } | null;
  }>;
}

const ROTULO_ESCOPO: Record<string, string> = {
  atribuidos: "só o que está atribuído a mim",
  indicados: "só os casos que indiquei",
  proprios: "só os meus",
};

// O que cada papel do QG pode (private.staff_pode). Nao ha tabela para ler;
// mudou la, muda aqui.
const PODE_STAFF: Record<string, Array<string>> = {
  dono: [
    "Ver todos os painéis (escritórios, saúde, uso, auditoria)",
    "Criar, editar e suspender escritórios",
    "Encerrar escritórios e aprovar eliminação de dados",
    "Desativar membros e trocar o titular de um escritório",
    "Pedir acesso de suporte a um escritório",
    "Gerenciar a equipe do QG",
  ],
  operacao: [
    "Ver todos os painéis (escritórios, saúde, uso, auditoria)",
    "Criar, editar e suspender escritórios",
    "Desativar membros e trocar o titular de um escritório",
    "Pedir acesso de suporte a um escritório",
  ],
  suporte: ["Ver todos os painéis (escritórios, saúde, uso, auditoria)", "Pedir acesso de suporte a um escritório"],
  leitura: ["Ver todos os painéis (escritórios, saúde, uso, auditoria)"],
};

function pontuar(t: Termo, nq: string, papel: PapelVivo | undefined): number {
  if (!nq) return 1;
  if (normalizar(t.termo).includes(nq)) return 4;
  if ((t.sinonimos ?? []).some((s) => normalizar(s).includes(nq))) return 3;
  if (papel && papel.permissoes.some((p) => normalizar(p.descricao).includes(nq) || p.permissao.includes(nq))) return 2;
  if (normalizar(t.definicao).includes(nq)) return 1;
  if (t.papelStaff && (PODE_STAFF[t.papelStaff] ?? []).some((s) => normalizar(s).includes(nq))) return 1;
  return 0;
}

/** Destaca o trecho procurado. So funciona porque normalizar() preserva o tamanho do texto. */
function Marcado(props: { texto: string; nq: string }) {
  const { texto, nq } = props;
  const n = normalizar(texto);
  if (!nq || n.length !== texto.length) return <span>{texto}</span>;
  const partes: Array<{ t: string; hit: boolean }> = [];
  let i = 0;
  while (i < texto.length) {
    const j = n.indexOf(nq, i);
    if (j < 0) {
      partes.push({ t: texto.slice(i), hit: false });
      break;
    }
    if (j > i) partes.push({ t: texto.slice(i, j), hit: false });
    partes.push({ t: texto.slice(j, j + nq.length), hit: true });
    i = j + nq.length;
  }
  return (
    <span>
      {partes.map((p, k) =>
        p.hit ? (
          <mark key={k} className="rounded bg-amber-200/70 px-0.5 text-inherit">
            {p.t}
          </mark>
        ) : (
          <span key={k}>{p.t}</span>
        ),
      )}
    </span>
  );
}

export function Glossario(props: GlossarioProps) {
  const { contexto, publico, papelAtual, papelStaffAtual, q, onQ } = props;
  const [categoria, setCategoria] = useState<Categoria | "todos">("todos");
  const [papeis, setPapeis] = useState<Record<string, PapelVivo> | null>(null);
  const [erroPapeis, setErroPapeis] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  // Papeis do sistema, com as permissoes. Erro NAO vira "sem papeis": aparece.
  useEffect(() => {
    let vivo = true;
    supabase
      .from("papeis")
      .select("chave, nome, descricao, tipo_acesso, ordem, papel_permissoes(permissao, escopo, permissoes(grupo, descricao))")
      .is("escritorio_id", null)
      .order("ordem")
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          setErroPapeis(error.message);
          setPapeis({});
          return;
        }
        const linhas = (data ?? []) as unknown as Array<LinhaPapel>;
        const mapa: Record<string, PapelVivo> = {};
        for (const l of linhas) {
          mapa[l.chave] = {
            chave: l.chave,
            nome: l.nome,
            descricao: l.descricao,
            tipo_acesso: l.tipo_acesso,
            permissoes: l.papel_permissoes
              .map((pp) => ({
                permissao: pp.permissao,
                escopo: pp.escopo,
                grupo: pp.permissoes?.grupo ?? "Outros",
                descricao: pp.permissoes?.descricao ?? pp.permissao,
              }))
              .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.permissao.localeCompare(b.permissao)),
          };
        }
        setPapeis(mapa);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Ancora na URL (#termo) ao abrir.
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, "");
    if (h) setAlvo(h);
  }, []);

  // "Veja tambem": limpa filtro e busca, espera renderizar, rola ate o termo.
  useEffect(() => {
    if (!alvo) return;
    const el = document.getElementById(alvo);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
    setAlvo(null);
  }, [alvo, q, categoria]);

  const nq = normalizar(q.trim());
  const visiveis = useMemo(() => TERMOS.filter((t) => publico.has(t.publico ?? "todos")), [publico]);
  const idsVisiveis = useMemo(() => new Set(visiveis.map((t) => t.id)), [visiveis]);
  const nomeDe = (id: string) => visiveis.find((t) => t.id === id)?.termo ?? id;

  const ordemCategorias: Array<Categoria> =
    contexto === "qg"
      ? ["plataforma", "papeis", "casos", "parceria", "automacoes", "tecnico"]
      : CATEGORIAS.map((c) => c.id);

  const pontuados = useMemo(
    () =>
      visiveis
        .map((t) => ({ t, pontos: pontuar(t, nq, t.papel && papeis ? papeis[t.papel] : undefined) }))
        .filter((x) => x.pontos > 0),
    [visiveis, nq, papeis],
  );
  const porCategoria = (c: Categoria) =>
    pontuados
      .filter((x) => x.t.categoria === c)
      .sort((a, b) => b.pontos - a.pontos || a.t.termo.localeCompare(b.t.termo))
      .map((x) => x.t);
  const totalPorCategoria = new Map(ordemCategorias.map((c) => [c, porCategoria(c).length]));
  const categoriasComTermos = ordemCategorias.filter((c) => visiveis.some((t) => t.categoria === c));
  const exibidas = (categoria === "todos" ? ordemCategorias : [categoria]).filter((c) => (totalPorCategoria.get(c) ?? 0) > 0);

  function irPara(id: string) {
    setCategoria("todos");
    onQ("");
    setAlvo(id);
  }

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Buscar termo, papel ou permissão…"
          aria-label="Buscar no glossário"
          className="h-11 pl-9 text-base"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Categorias">
        <Button
          size="sm"
          variant={categoria === "todos" ? "default" : "outline"}
          onClick={() => setCategoria("todos")}
          role="tab"
          aria-selected={categoria === "todos"}
        >
          Todos
          <span className="ml-1.5 text-xs opacity-70">{pontuados.length}</span>
        </Button>
        {categoriasComTermos.map((c) => {
          const meta = CATEGORIAS.find((x) => x.id === c);
          if (!meta) return null;
          return (
            <Button
              key={c}
              size="sm"
              variant={categoria === c ? "default" : "outline"}
              onClick={() => setCategoria(c)}
              role="tab"
              aria-selected={categoria === c}
            >
              {meta.nome}
              <span className="ml-1.5 text-xs opacity-70">{totalPorCategoria.get(c) ?? 0}</span>
            </Button>
          );
        })}
      </div>

      {exibidas.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>
            Nenhum termo com <strong>“{q.trim()}”</strong>.
          </p>
          <p className="mt-1">A busca olha nome, sinônimos, definição e as permissões de cada papel. Tente outra palavra.</p>
        </div>
      )}

      {exibidas.map((c) => {
        const meta = CATEGORIAS.find((x) => x.id === c);
        if (!meta) return null;
        return (
          <section key={c} className="space-y-3" aria-labelledby={`cat-${c}`}>
            <div>
              <h2 id={`cat-${c}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {meta.nome}
              </h2>
              {!nq && <p className="text-sm text-muted-foreground">{meta.descricao}</p>}
            </div>
            <div className="grid gap-3">
              {porCategoria(c).map((t) => (
                <CartaoTermo
                  key={t.id}
                  t={t}
                  nq={nq}
                  papel={t.papel && papeis ? papeis[t.papel] : undefined}
                  papeisCarregados={papeis !== null}
                  erroPapeis={erroPapeis}
                  ehMeu={(!!t.papel && t.papel === papelAtual) || (!!t.papelStaff && t.papelStaff === papelStaffAtual)}
                  veja={(t.veja ?? []).filter((id) => idsVisiveis.has(id))}
                  nomeDe={nomeDe}
                  irPara={irPara}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CartaoTermo(props: {
  t: Termo;
  nq: string;
  papel: PapelVivo | undefined;
  papeisCarregados: boolean;
  erroPapeis: string | null;
  ehMeu: boolean;
  veja: Array<string>;
  nomeDe: (id: string) => string;
  irPara: (id: string) => void;
}) {
  const { t, nq, papel, papeisCarregados, erroPapeis, ehMeu, veja, nomeDe, irPara } = props;
  return (
    <article
      id={t.id}
      tabIndex={-1}
      data-termo={t.id}
      className="scroll-mt-24 rounded-lg border bg-card p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold">
          <Marcado texto={t.termo} nq={nq} />
        </h3>
        {t.sinonimos && t.sinonimos.length > 0 && (
          <span className="text-xs text-muted-foreground">
            também: <Marcado texto={t.sinonimos.join(", ")} nq={nq} />
          </span>
        )}
        {ehMeu && (
          <Badge className="ml-auto gap-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
            <UserCheck className="h-3 w-3" />
            seu papel
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed">
        <Marcado texto={t.definicao} nq={nq} />
      </p>

      {t.papel && (
        <PermissoesDoPapel chave={t.papel} papel={papel} carregado={papeisCarregados} erro={erroPapeis} nq={nq} />
      )}

      {t.papelStaff && (
        <div className="mt-3 rounded-md bg-muted/50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">O que pode no QG</div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">
            {(PODE_STAFF[t.papelStaff] ?? []).map((s) => (
              <li key={s}>
                <Marcado texto={s} nq={nq} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {veja.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Veja também:</span>
          {veja.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => irPara(id)}
              className="rounded border px-1.5 py-0.5 text-foreground hover:bg-muted"
            >
              {nomeDe(id)}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function PermissoesDoPapel(props: {
  chave: string;
  papel: PapelVivo | undefined;
  carregado: boolean;
  erro: string | null;
  nq: string;
}) {
  const { chave, papel, carregado, erro, nq } = props;
  if (!carregado) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        carregando as permissões…
      </div>
    );
  }
  if (erro) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Não consegui carregar as permissões deste papel: {erro}</span>
      </div>
    );
  }
  if (!papel) {
    return <p className="mt-3 text-xs text-muted-foreground">O papel “{chave}” não existe neste banco.</p>;
  }
  const grupos: Array<string> = [];
  for (const p of papel.permissoes) if (!grupos.includes(p.grupo)) grupos.push(p.grupo);
  return (
    <div className="mt-3 rounded-md bg-muted/50 p-3" data-permissoes-de={chave}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">O que pode no escritório</span>
        <Badge variant="outline" className="text-[11px]">
          acesso {papel.tipo_acesso}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{papel.permissoes.length} permissões · lido do banco agora</span>
      </div>
      {papel.permissoes.length === 0 && <p className="mt-1.5 text-sm text-muted-foreground">Nenhuma permissão.</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {grupos.map((g) => (
          <div key={g}>
            <div className="text-xs font-medium text-muted-foreground">{g}</div>
            <ul className="mt-0.5 space-y-0.5 text-sm">
              {papel.permissoes
                .filter((p) => p.grupo === g)
                .map((p) => (
                  <li key={p.permissao} className="flex flex-wrap items-baseline gap-x-1.5" title={p.permissao}>
                    <Marcado texto={p.descricao} nq={nq} />
                    {p.escopo !== "todos" && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {ROTULO_ESCOPO[p.escopo] ?? p.escopo}
                      </Badge>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
