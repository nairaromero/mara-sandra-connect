import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type UsuarioRow } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  usuario: UsuarioRow | null;
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        // defer DB call para evitar deadlock
        setTimeout(() => {
          loadUsuario(sess.user.id);
          loadPrecisaSenha();
        }, 0);
      } else {
        setUsuario(null);
        setPrecisaSenha(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        Promise.all([
          loadUsuario(data.session.user.id),
          loadPrecisaSenha(),
        ]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Le auth.users.encrypted_password via RPC SECURITY DEFINER — o client nao
  // enxerga o schema auth. Se o RPC nao existir (ambiente sem a migration),
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

  async function loadUsuario(userId: string) {
    // Tenta primeiro o select completo (com colunas de onboarding).
    // Se falhar (ex.: migration de onboarding ainda nao rodou no ambiente),
    // cai pra select basico - assim o app nao trava em spinner infinito.
    const fullResp = await supabase
      .from("usuarios")
      .select("id, nome, email, tipo, avatar_url, onboarded_em, aceitou_termos_em, termos_versao")
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
    await supabase.auth.signOut();
    setUsuario(null);
    setSession(null);
    setPrecisaSenha(null);
  }

  // Permite a tela de /boas-vindas atualizar o usuario apos marcar
  // onboarded_em sem precisar de full page reload.
  async function refreshUsuario() {
    if (session?.user?.id) {
      await loadUsuario(session.user.id);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        usuario,
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
