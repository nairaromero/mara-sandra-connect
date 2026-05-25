import { createClient } from "@supabase/supabase-js";

// Cliente Supabase do escritório Mara Sandra Advocacia
// Projeto externo: llugytkdsfsrciavhrfw
const SUPABASE_URL = "https://llugytkdsfsrciavhrfw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_R2hBmLNlLdBN-EEAUSjpPw_P6Lb72N1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type UsuarioTipo = "interno" | "parceiro";

export interface UsuarioRow {
  id: string;
  nome: string | null;
  email: string | null;
  tipo: UsuarioTipo;
  avatar_url?: string | null;
}
