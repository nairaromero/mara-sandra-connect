import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  supabase,
  getEscritorioAtivoId,
  setEscritorioAtivoId,
  type UsuarioRow,
} from "@/lib/supabase";
import { garantirInicioSessao, limparMarcadores } from "@/lib/auth/session-policy";
import { exigenciaDeEscrita, FUNCTION as EXIGE_FUNCTION, RPC as EXIGE_RPC, type Operacao } from "@/lib/rbac/exigencias";

/** Um escritório que a pessoa pode abrir: vínculo, ou acesso de suporte aprovado. */
export interface Vinculo {
  escritorio_id: string;
  escritorio_nome: string;
  escritorio_slug: string | null;
  escritorio_status: "provisionando" | "ativo" | "suspenso" | "encerrado";
  membro_status: "convidado" | "ativo" | "desativado";
  /** chave do papel: admin, advogado, assistente, financeiro, parceiro — ou "suporte". */
  papel: string;
  papel_nome: string;
  tipo_acesso: "interno" | "parceiro";
  /** Sessão de suporte da plataforma: somente leitura, com prazo. */
  suporte?: boolean;
  suporte_fim?: string | null;
  /** Marca do escritório (escritorio_config.marca): nome de exibição, logo, cor. */
  marca?: MarcaEscritorioJson | null;
}

export interface MarcaEscritorioJson {
  nome_exibicao?: string;
  logo_url?: string;
  cor?: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /**
   * A pessoa, com `tipo` e `eh_admin` vindos do VÍNCULO no escritório ativo
   * (RBAC multi-tenant) — não mais das colunas antigas de `usuarios`. Assim as
   * checagens `usuario.tipo === "interno"` espalhadas pelo app já valem por
   * escritório.
   */
  usuario: UsuarioRow | null;
  /** Admin do escritório ATIVO. false enquanto carrega ou pra parceiro. */
  isAdmin: boolean;
  /** Escritórios que a pessoa pode abrir (o seletor só aparece com 2+). */
  vinculos: Array<Vinculo>;
  /** O escritório desta aba; null = nenhum disponível (ver `semEscritorio`). */
  escritorio: Vinculo | null;
  /** Por que não há escritório: nunca teve vínculo, ou o dela está suspenso. */
  semEscritorio: "nenhum" | "suspenso" | null;
  /** true durante uma sessão de suporte da plataforma (somente leitura). */
  emSuporte: boolean;
  /**
   * Permissão no escritório ativo (`recurso:acao`). false enquanto carrega.
   * `escopoExigido` é para quando a policy do banco cobra um escopo: passe-o e
   * quem tem a permissão com escopo menor recebe false, como o banco faria.
   * Na dúvida prefira `podeEscrever`/`podeChamar`: eles leem a exigência do
   * espelho em `src/lib/rbac/exigencias.ts` e não deixam errar a permissão.
   */
  pode: (permissao: string, escopoExigido?: string) => boolean;
  /**
   * Pode escrever nesta TABELA em ALGUMA linha? Use para o que cria (o botão
   * "Nova tarefa") e para abas inteiras. Quem tem a permissão só no escopo
   * `atribuidos` recebe true: ele escreve nas linhas dele.
   * Tabela sem policy de permissão devolve true: lá o banco só isola por
   * escritório e quem decide é o tipo/tela.
   */
  podeEscrever: (tabela: string, operacao?: Operacao) => boolean;
  /**
   * Pode escrever NESTA LINHA? Use sempre que a linha existir (editar, concluir,
   * excluir): com escopo `atribuidos`, o banco só aceita se a pessoa for a
   * responsável — é a diferença entre "o assistente mexe na tarefa dele" e
   * "mexe na de qualquer um".
   */
  podeEscreverLinha: (
    tabela: string,
    linha: Record<string, unknown> | null | undefined,
    operacao?: Operacao,
  ) => boolean;
  /** Pode chamar esta RPC ou edge function (pelo nome)? */
  podeChamar: (nome: string) => boolean;
  /** Grava a preferência e recarrega a página no outro escritório. */
  trocarEscritorio: (escritorioId: string) => Promise<void>;
  /** Relê vínculos e marca (depois de mudar a marca do escritório, por exemplo). */
  recarregarVinculos: () => Promise<void>;
  loading: boolean;
  /**
   * true  = conta ainda sem senha (entrou por convite/magic link) e precisa
   *         passar por /definir-senha antes de usar o sistema;
   * false = ja tem senha;
   * null  = ainda nao consultado (nao decidir redirect nesse estado).
   */
  precisaSenha: boolean | null;
  signOut: () => Promise<void>;
  refreshUsuario: () => Promise<void>;
  refreshPrecisaSenha: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<UsuarioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [precisaSenha, setPrecisaSenha] = useState<boolean | null>(null);
  const [vinculos, setVinculos] = useState<Array<Vinculo>>([]);
  const [escritorio, setEscritorio] = useState<Vinculo | null>(null);
  const [semEscritorio, setSemEscritorio] = useState<"nenhum" | "suspenso" | null>(null);
  // permissão -> escopo (`todos`, `atribuidos`, `indicados`, `proprios`). O
  // escopo vem de `minhas_permissoes()` e é o que as policies de `tarefas` e
  // `agenda_eventos` cobram: descartá-lo fazia a tela oferecer ao assistente o
  // que o banco recusa (auditoria de 24/09, planning/RBAC_AUDITORIA_TELAS.md).
  const [permissoes, setPermissoes] = useState<Map<string, string>>(new Map());
  // Banco sem as migrations do RBAC (front publicado antes do banco): vale o
  // comportamento antigo — as checagens de tipo/admin decidem, `pode()` não barra.
  const [rbacIndisponivel, setRbacIndisponivel] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        // Relógio da sessão nasce aqui (e não no layout autenticado) pra também
        // valer em /definir-senha e demais telas fora dele. É idempotente: só
        // grava se ainda não houver marca, senão cada refresh de token zeraria
        // o teto de 12h e a sessão voltaria a ser eterna.
        garantirInicioSessao();
        // defer DB call para evitar deadlock
        setTimeout(() => {
          loadUsuario(sess.user.id);
          loadPrecisaSenha();
          loadEscritorio();
        }, 0);
      } else {
        // Sessão caiu (logout, token revogado): zera os relógios pra que o
        // próximo login não herde o teto de 12h da sessão anterior.
        limparMarcadores();
        setUsuario(null);
        setPrecisaSenha(null);
        setVinculos([]);
        setEscritorio(null);
        setSemEscritorio(null);
        setPermissoes(new Map());
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        garantirInicioSessao();
        Promise.all([
          loadUsuario(data.session.user.id),
          loadPrecisaSenha(),
          loadEscritorio(),
        ]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Pergunta ao banco (RPC SECURITY DEFINER) se a conta veio de convite e ainda
  // nao tem senha propria — quem responde e usuarios.senha_definida_em, nao o
  // auth.users.encrypted_password: o Supabase preenche esse campo sozinho no
  // aceite do convite (#362). Se o RPC nao existir (ambiente sem a migration),
  // assume false: melhor deixar entrar do que travar todo mundo na tela de
  // senha por causa de migration atrasada.
  async function loadPrecisaSenha() {
    const { data, error } = await supabase.rpc("precisa_definir_senha");
    if (error) {
      console.warn("precisa_definir_senha falhou, assumindo false:", error);
      setPrecisaSenha(false);
      return;
    }
    setPrecisaSenha(data === true);
  }

  // Escritório ativo (RBAC multi-tenant). Ordem de escolha: o que esta aba já
  // vinha usando (localStorage, se ainda for válido) → o que o servidor
  // considera ativo (preferência salva ou vínculo único) → o primeiro da lista.
  // Falha de consulta NÃO vira "sem escritório": mantém o que havia e loga —
  // senão um soluço da rede jogaria a pessoa na tela de "sem acesso".
  async function loadEscritorio() {
    const [vincResp, supResp] = await Promise.all([
      supabase.rpc("meus_vinculos"),
      supabase.rpc("meus_acessos_suporte"),
    ]);
    if (vincResp.error) {
      // Banco sem as migrations do RBAC (ambiente antigo): segue no modo de um
      // escritório só, como sempre foi.
      console.warn("meus_vinculos falhou; seguindo sem escritório ativo:", vincResp.error);
      setRbacIndisponivel(true);
      return;
    }
    setRbacIndisponivel(false);
    type LinhaVinculo = Omit<Vinculo, "suporte" | "suporte_fim"> & { ativo_agora: boolean };
    type LinhaSuporte = { escritorio_id: string; escritorio_nome: string; fim: string; marca?: MarcaEscritorioJson | null };
    const meus = (vincResp.data ?? []) as Array<LinhaVinculo>;
    const suporte = ((supResp.error ? [] : supResp.data) ?? []) as Array<LinhaSuporte>;

    const lista: Array<Vinculo> = [
      ...meus,
      ...suporte
        .filter((s) => !meus.some((m) => m.escritorio_id === s.escritorio_id && m.membro_status === "ativo"))
        .map<Vinculo>((s) => ({
          escritorio_id: s.escritorio_id,
          escritorio_nome: s.escritorio_nome,
          escritorio_slug: null,
          escritorio_status: "ativo",
          membro_status: "ativo",
          papel: "suporte",
          papel_nome: "Suporte da plataforma",
          tipo_acesso: "interno",
          suporte: true,
          suporte_fim: s.fim,
          marca: s.marca ?? null,
        })),
    ];
    const abriveis = lista.filter((v) => v.membro_status === "ativo" && v.escritorio_status === "ativo");
    const salvo = getEscritorioAtivoId();
    const escolhido =
      abriveis.find((v) => v.escritorio_id === salvo) ??
      abriveis.find((v) => meus.some((m) => m.escritorio_id === v.escritorio_id && m.ativo_agora)) ??
      abriveis[0] ??
      null;

    setVinculos(lista);
    setEscritorio(escolhido);
    setSemEscritorio(
      escolhido ? null : lista.some((v) => v.escritorio_status === "suspenso") ? "suspenso" : "nenhum",
    );

    if (!escolhido) {
      setEscritorioAtivoId(null);
      setPermissoes(new Map());
      return;
    }
    if (escolhido.escritorio_id !== salvo) {
      setEscritorioAtivoId(escolhido.escritorio_id);
      // Realtime e Storage não mandam o header: gravam a preferência no banco.
      const pref = await supabase.rpc("definir_escritorio_ativo", { p_escritorio_id: escolhido.escritorio_id });
      if (pref.error) console.warn("definir_escritorio_ativo falhou:", pref.error);
    }

    const permResp = await supabase.rpc("minhas_permissoes");
    if (permResp.error) {
      console.warn("minhas_permissoes falhou:", permResp.error);
      return;
    }
    setPermissoes(new Map(((permResp.data ?? []) as Array<{ permissao: string; escopo: string | null }>)
      .map((p) => [p.permissao, p.escopo ?? "todos"] as const)));
  }

  async function trocarEscritorio(escritorioId: string) {
    if (escritorioId === escritorio?.escritorio_id) return;
    const { error } = await supabase.rpc("definir_escritorio_ativo", { p_escritorio_id: escritorioId });
    if (error) throw new Error(error.message);
    setEscritorioAtivoId(escritorioId);
    // Reload completo: nenhum estado, cache ou canal de Realtime do escritório
    // anterior sobrevive. Para /casos — "/" é o site institucional.
    window.location.assign("/casos");
  }

  async function loadUsuario(userId: string) {
    // Tenta primeiro o select completo (com colunas de onboarding).
    // Se falhar (ex.: migration de onboarding ainda nao rodou no ambiente),
    // cai pra select basico - assim o app nao trava em spinner infinito.
    const fullResp = await supabase
      .from("usuarios")
      .select("id, nome, email, tipo, eh_admin, avatar_url, onboarded_em, aceitou_termos_em, termos_versao")
      .eq("id", userId)
      .maybeSingle();

    if (!fullResp.error) {
      setUsuario(fullResp.data as UsuarioRow | null);
      return;
    }

    console.warn(
      "loadUsuario: select completo falhou, tentando fallback basico:",
      fullResp.error,
    );

    const basicResp = await supabase
      .from("usuarios")
      .select("id, nome, email, tipo, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    if (basicResp.error) {
      console.error("loadUsuario: fallback basico tambem falhou:", basicResp.error);
      setUsuario(null);
      return;
    }

    // Sucesso no fallback - assume onboarded_em=null pra forcar fluxo de
    // boas-vindas em ambientes que ainda nao rodaram a migration. Interno
    // recebe valor truthy fake pra nao virar loop de redirect.
    const data = basicResp.data as UsuarioRow | null;
    if (data) {
      const isInterno = data.tipo === "interno";
      setUsuario({
        ...data,
        onboarded_em: isInterno ? new Date().toISOString() : null,
        aceitou_termos_em: null,
      });
    } else {
      setUsuario(null);
    }
  }

  async function signOut() {
    limparMarcadores();
    await supabase.auth.signOut();
    // O próximo login neste navegador pode ser de outra pessoa.
    setEscritorioAtivoId(null);
    setUsuario(null);
    setSession(null);
    setPrecisaSenha(null);
    setVinculos([]);
    setEscritorio(null);
    setSemEscritorio(null);
    setPermissoes(new Map());
  }

  // Permite a tela de /boas-vindas atualizar o usuario apos marcar
  // onboarded_em sem precisar de full page reload.
  async function refreshUsuario() {
    if (session?.user?.id) {
      await loadUsuario(session.user.id);
    }
  }

  // `tipo`/`eh_admin` do escritório ATIVO por cima das colunas antigas.
  const usuarioEfetivo: UsuarioRow | null =
    usuario && escritorio
      ? { ...usuario, tipo: escritorio.tipo_acesso, eh_admin: escritorio.papel === "admin" }
      : usuario;

  // Uma pessoa PODE quando tem a permissão e, se a policy cobrar escopo, quando
  // o escopo dela é o cobrado. `rbacIndisponivel` (banco sem as migrations do
  // RBAC) mantém o comportamento antigo: quem decide são as checagens de tipo.
  function podeCom(permissao: string, escopoExigido?: string): boolean {
    if (rbacIndisponivel) return true;
    const escopo = permissoes.get(permissao);
    if (escopo === undefined) return false;
    return escopoExigido === undefined || escopo === escopoExigido;
  }


  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        usuario: usuarioEfetivo,
        isAdmin: usuarioEfetivo?.tipo === "interno" && usuarioEfetivo?.eh_admin === true,
        vinculos,
        escritorio,
        semEscritorio,
        emSuporte: escritorio?.suporte === true,
        pode: podeCom,
        podeEscrever: (tabela: string, operacao: Operacao = "inserir") => {
          const exige = exigenciaDeEscrita(tabela, operacao);
          // sem policy de permissão: o banco só isola por escritório
          if (!exige) return true;
          // com escopo `atribuidos` a pessoa escreve nas linhas dela: para
          // "pode em alguma?" basta ter a permissão.
          return podeCom(exige.permissao);
        },
        podeEscreverLinha: (
          tabela: string,
          linha: Record<string, unknown> | null | undefined,
          operacao: Operacao = "atualizar",
        ) => {
          const exige = exigenciaDeEscrita(tabela, operacao);
          if (!exige) return true;
          if (rbacIndisponivel) return true;
          const escopo = permissoes.get(exige.permissao);
          if (escopo === undefined) return false;
          if (escopo === "todos") return true;
          // escopo restrito: o banco compara a coluna com quem está logado
          if (!exige.proprio || escopo !== exige.proprio.escopo) return false;
          if (!linha) return false;
          return linha[exige.proprio.coluna] === session?.user?.id;
        },
        podeChamar: (nome: string) => {
          const exige = EXIGE_RPC[nome] ?? EXIGE_FUNCTION[nome];
          return exige ? podeCom(exige.permissao) : true;
        },
        trocarEscritorio,
        recarregarVinculos: loadEscritorio,
        loading,
        precisaSenha,
        signOut,
        refreshUsuario,
        refreshPrecisaSenha: loadPrecisaSenha,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
