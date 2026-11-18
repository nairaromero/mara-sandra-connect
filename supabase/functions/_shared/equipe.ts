// Quem é a equipe INTERNA ativa de um escritório — uma leitura só.
//
// A fonte é o vínculo (`membros` + `papeis.tipo_acesso`), nunca `usuarios.tipo`:
// `usuarios` é global e espelha o vínculo principal da pessoa, então quem é
// parceiro num escritório e advogado em outro seria classificado errado.
// `sb` é o client de service role JÁ ESCOPADO ao escritório (`membros` tem
// escritorio_id). Quem usa: inss-email-processor (dono do e-mail do INSS) e
// _shared/zapsign.ts (quem é cliente e quem é da casa num contrato).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PessoaDaEquipe {
  usuario_id: string;
  email: string | null;
  nome: string | null;
  /** chave do papel no escritório: admin, advogado, assistente, financeiro… */
  papel: string | null;
}

/** Equipe interna ativa, do vínculo mais antigo para o mais novo. Erro de leitura estoura. */
export async function equipeInterna(sb: SupabaseClient): Promise<PessoaDaEquipe[]> {
  const { data, error } = await sb
    .from("membros")
    .select("usuario_id, created_at, usuarios!membros_usuario_id_fkey(email, nome, ativo), papeis!membros_papel_id_fkey(chave, tipo_acesso)")
    .eq("status", "ativo")
    .order("created_at");
  if (error) throw new Error(`lendo a equipe do escritório: ${error.message}`);
  const equipe: PessoaDaEquipe[] = [];
  for (const m of (data ?? []) as Array<Record<string, unknown>>) {
    const u = m.usuarios as { email?: string | null; nome?: string | null; ativo?: boolean | null } | null;
    const p = m.papeis as { chave?: string; tipo_acesso?: string } | null;
    if (!u || u.ativo === false || p?.tipo_acesso !== "interno") continue;
    equipe.push({
      usuario_id: m.usuario_id as string,
      email: u.email ? String(u.email).toLowerCase() : null,
      nome: u.nome ? String(u.nome) : null,
      papel: p?.chave ?? null,
    });
  }
  return equipe;
}
