// Pedido de troca da senha do Meu INSS ao parceiro (card #305).
//
// É uma solicitação como as de documento (e-mail, kanban do parceiro,
// lembretes de prazo), com tipo 'senha_meu_inss'. A diferença é o
// cumprimento: em vez de anexo, o parceiro informa a nova senha, que vai
// criptografada por cumprir_troca_senha_meu_inss → set_senha_meu_inss. Ver
// planning/sql-migrations/migration_senha_meu_inss_pedido_parceiro.sql.

import { supabase } from "@/lib/supabase";
import { fatalPorDiasUteis } from "@/lib/agenda/helpers";
import { fimDoDiaBR, hojeChaveBR, inputDateBRParaIso } from "@/lib/fuso";

export const TIPO_PEDIDO_SENHA = "senha_meu_inss";
export const ROTULO_PEDIDO_SENHA = "Troca da senha do Meu INSS";
export const DIAS_UTEIS_PRAZO_SENHA = 3;

/**
 * Mensagem pra tela. Recusa do próprio banco (raise exception → código P0001)
 * já vem em português e diz o porquê ("Este caso não tem parceiro…"): mostra.
 * O resto (função ausente, rede, erro técnico em inglês) vira texto genérico e
 * o detalhe fica só no console.
 */
export function mensagemErroSenha(err: unknown, generica: string): string {
  const e = err as { code?: string; message?: string } | null;
  console.error("pedido de troca de senha:", err);
  if (e?.code === "P0001" && e.message) return e.message;
  return generica;
}

export function ehPedidoSenhaMeuInss(tipo: string | null | undefined): boolean {
  return tipo === TIPO_PEDIDO_SENHA;
}

/** Prazo sugerido ("aaaa-mm-dd" pro input date): hoje + 3 dias úteis, em Brasília. */
export function prazoSugeridoSenha(): string {
  return fatalPorDiasUteis(hojeChaveBR(), DIAS_UTEIS_PRAZO_SENHA) ?? hojeChaveBR();
}

export interface PedidoSenhaAberto {
  id: string;
  caso_id: string;
  data_solicitacao: string;
  prazo_at: string | null;
  descricao: string | null;
  solicitante: { id: string; nome: string | null } | null;
}

/**
 * Pedido de troca aberto pra QUALQUER caso do cliente (a senha é do cliente).
 * Lança em erro de consulta — "não consegui ver" não pode virar "não há pedido"
 * e liberar um segundo pedido.
 */
export async function buscarPedidoSenhaAberto(clienteId: string): Promise<PedidoSenhaAberto | null> {
  const { data, error } = await supabase
    .from("solicitacoes_documento")
    .select(
      "id, caso_id, data_solicitacao, prazo_at, descricao, solicitante:usuarios!solicitacoes_documento_solicitado_por_fkey(id, nome), casos!inner(cliente_id)",
    )
    .eq("tipo", TIPO_PEDIDO_SENHA)
    .eq("status", "pendente")
    .eq("casos.cliente_id", clienteId)
    .order("data_solicitacao", { ascending: true })
    .limit(1);
  if (error) throw error;
  const linha = (data ?? [])[0] as unknown as PedidoSenhaAberto | undefined;
  return linha ?? null;
}

/**
 * Equipe pede a troca. `prazo` é o valor do input date ("aaaa-mm-dd") e vira
 * o fim do dia em Brasília, como nas solicitações de documento. Se já havia
 * pedido aberto pro cliente, devolve ele (ja_existia) e não manda e-mail.
 */
export async function pedirTrocaSenhaMeuInss(input: {
  casoId: string;
  prazo: string;
  motivo: string;
}): Promise<{ id: string; jaExistia: boolean }> {
  const prazoIso = input.prazo ? inputDateBRParaIso(input.prazo) : null;
  const { data, error } = await supabase.rpc("pedir_troca_senha_meu_inss", {
    p_caso_id: input.casoId,
    p_prazo_at: prazoIso ? fimDoDiaBR(prazoIso).toISOString() : null,
    p_motivo: input.motivo.trim() || null,
  });
  if (error) throw error;
  const r = data as { id: string; ja_existia: boolean };
  if (!r.ja_existia) {
    window.dispatchEvent(new Event("msc:solicitacoes-mudou"));
    // E-mail ao parceiro: mesma edge das solicitações (fire-and-forget).
    supabase.functions
      .invoke("notify-solicitacao-doc", { body: { solicitacao_id: r.id } })
      .catch((err) => console.error("notify-solicitacao-doc falhou", err));
  }
  return { id: r.id, jaExistia: r.ja_existia };
}

/** Parceiro informa a nova senha: grava criptografada e cumpre o pedido. */
export async function cumprirTrocaSenhaMeuInss(solicitacaoId: string, senha: string): Promise<void> {
  const { error } = await supabase.rpc("cumprir_troca_senha_meu_inss", {
    p_solicitacao_id: solicitacaoId,
    p_senha: senha,
  });
  if (error) throw error;
  window.dispatchEvent(new Event("msc:solicitacoes-mudou"));
}
