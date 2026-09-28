// Verificacao em duas etapas (TOTP) com o MFA do Supabase Auth.
//
// Como funciona: a pessoa cadastra um autenticador (QR/segredo) e confirma um
// codigo; a partir dai, depois da senha, a sessao nasce em AAL1 e so vira AAL2
// quando ela digita o codigo (challengeAndVerify). O produto pede o codigo no
// login de quem tem fator; o QG exige AAL2 no banco (qg_exigir_aal2) — sem
// codigo, as funcoes qg_* recusam.

import { supabase } from "@/lib/supabase";

export interface FatorTotp {
  id: string;
  friendly_name?: string | null;
  status: "verified" | "unverified";
  created_at?: string;
}

export async function fatoresTotp(): Promise<Array<FatorTotp>> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return ((data?.totp ?? []) as Array<FatorTotp>).slice();
}

export async function fatorVerificado(): Promise<FatorTotp | null> {
  return (await fatoresTotp()).find((f) => f.status === "verified") ?? null;
}

/** A sessao esta em AAL1 mas a pessoa tem fator: falta o codigo. */
export async function precisaCodigo(): Promise<{ precisa: boolean; fatorId: string | null; aal: string }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  const aal = data?.currentLevel ?? "aal1";
  if (data?.currentLevel === "aal1" && data?.nextLevel === "aal2") {
    const f = await fatorVerificado();
    return { precisa: !!f, fatorId: f?.id ?? null, aal };
  }
  return { precisa: false, fatorId: null, aal };
}

export async function confirmarCodigo(fatorId: string, codigo: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.replace(/\s+/g, "") });
  if (error) throw error;
}

/** Cadastro abandonado no meio deixa fator "unverified": limpa antes de outro. */
export async function limparFatoresPendentes(): Promise<void> {
  for (const f of await fatoresTotp()) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
}

export async function removerFator(fatorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId: fatorId });
  if (error) throw error;
}
