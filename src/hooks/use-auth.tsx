import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type UsuarioRow } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  usuario: UsuarioRow | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<UsuarioRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        // defer DB call para evitar deadlock
        setTimeout(() => loadUsuario(sess.user.id), 0);
      } else {
        setUsuario(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadUsuario(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadUsuario(userId: string) {
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nome, email, tipo, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("Erro ao carregar usuário:", error);
      setUsuario(null);
    } else {
      setUsuario(data as UsuarioRow | null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUsuario(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, usuario, loading, signOut }}
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
