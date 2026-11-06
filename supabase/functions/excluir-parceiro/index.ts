// supabase/functions/excluir-parceiro/index.ts
//
// Apaga um parceiro SEM histórico — o convite que nunca virou trabalho
// ("Cancelar convite" na aba Convites de /parceiros).
//
// Parceiro com caso ou qualquer histórico (andamento, documento, comentário,
// pedido de documento) é RECUSADO com 409 `parceiro_com_historico`: o caminho
// é Desligar (RPC desligar_parceiro), que bloqueia o acesso e preserva tudo no
// nome dele (#202). Antes, a exclusão desvinculava os casos sem perguntar,
// apagava os comentários dele e fazia isso em passos soltos — se um falhava,
// os anteriores ficavam feitos.
//
// Chamada do frontend:
//   await supabase.functions.invoke("excluir-parceiro", {
//     body: { usuario_id: "<uuid>", confirmar: true }
//   });
//
// Secrets:
//   - SUPABASE_URL (automatico)
//   - SUPABASE_SERVICE_ROLE_KEY (automatico)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { escopado, exigirUsuario } from "../_shared/auth.ts";
import { auditar } from "../_shared/auditoria.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-escritorio-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  // ---------------------------------------------------------------------------
  // 1) Valida JWT do caller e que eh interno
  // ---------------------------------------------------------------------------
  // Interno ATIVO do escritório ativo, com permissão de excluir parceiro. (O
  // preâmbulo antigo lia `usuarios.tipo` sem conferir `ativo`.)
  const quem = await exigirUsuario(req, { tipo: "interno", permissao: "parceiros:excluir" });
  if (quem instanceof Response) return quem;
  const escritorioId = quem.perfil.escritorio_id;
  // Service role ignora RLS: o client sai PRESO ao escritório de quem pediu —
  // o histórico é conferido e o vínculo removido só AQUI, nunca no outro
  // escritório em que ele também possa atuar.
  const supabase = escopado(createClient(SUPABASE_URL, SERVICE_ROLE), escritorioId);

  // ---------------------------------------------------------------------------
  // 2) Parse body
  // ---------------------------------------------------------------------------
  let body: { usuario_id?: string; confirmar?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  const usuarioId = String(body.usuario_id || "").trim();
  if (!usuarioId) {
    return jsonResponse({ error: "usuario_id obrigatorio" }, 400);
  }
  if (body.confirmar !== true) {
    return jsonResponse({ error: "confirmar=true obrigatorio" }, 400);
  }

  // Verifica que alvo eh parceiro
  const { data: alvo, error: alvoErr } = await supabase
    .from("usuarios")
    .select("id, nome, tipo")
    .eq("id", usuarioId)
    .maybeSingle();
  if (alvoErr) return jsonResponse({ error: "falha ao ler o parceiro" }, 503);
  if (!alvo) {
    return jsonResponse({ error: "parceiro nao encontrado" }, 404);
  }
  // Com RBAC quem decide é o VÍNCULO: tem que ser parceiro DESTE escritório.
  let outrosVinculos = 0;
  if (escritorioId) {
    const { data: vinc, error: vincErr } = await supabase
      .from("membros")
      .select("id, papel:papeis!inner(tipo_acesso)")
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    if (vincErr) return jsonResponse({ error: "falha ao verificar o vínculo" }, 503);
    if (!vinc) return jsonResponse({ error: "parceiro nao encontrado" }, 404);
    if ((vinc.papel as { tipo_acesso?: string } | null)?.tipo_acesso !== "parceiro") {
      return jsonResponse({ error: "este endpoint so exclui parceiros" }, 400);
    }
    const { count } = await createClient(SUPABASE_URL, SERVICE_ROLE)
      .from("membros").select("id", { count: "exact", head: true })
      .eq("usuario_id", usuarioId).neq("escritorio_id", escritorioId);
    outrosVinculos = count ?? 0;
  } else if ((alvo as { tipo: string }).tipo !== "parceiro") {
    return jsonResponse(
      { error: "este endpoint so exclui parceiros" },
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // 3) Só sem histórico NESTE escritório (#202). Erro de contagem estoura:
  //    "não consegui contar" não pode virar "não tem nada".
  // ---------------------------------------------------------------------------
  const contar = async (tabela: string, coluna: string): Promise<number | Response> => {
    const { count, error } = await supabase.from(tabela).select("id", { count: "exact", head: true }).eq(coluna, usuarioId);
    if (error) {
      console.error(`excluir-parceiro: contar ${tabela}.${coluna}:`, error.message);
      return jsonResponse({ error: `falha ao conferir o histórico (${tabela})` }, 503);
    }
    return count ?? 0;
  };
  const historico: Record<string, number> = {};
  for (const [nome, tabela, coluna] of [
    ["casos", "casos", "parceiro_id"],
    ["andamentos", "andamentos", "criado_por"],
    ["documentos", "documentos", "uploaded_by"],
    ["comentarios", "comentarios", "autor_id"],
    ["solicitacoes", "solicitacoes_documento", "solicitado_por"],
    ["solicitacoes_atribuidas", "solicitacoes_documento", "responsavel_id"],
  ] as const) {
    const n = await contar(tabela, coluna);
    if (n instanceof Response) return n;
    historico[nome] = n;
  }
  if (Object.values(historico).some((n) => n > 0)) {
    return jsonResponse({
      error: historico.casos > 0
        ? `Este parceiro tem ${historico.casos} caso(s). Excluir apagaria o vínculo com eles — use Desligar: bloqueia o acesso e mantém o histórico.`
        : "Este parceiro já tem histórico no escritório (andamentos, documentos, comentários ou pedidos). Use Desligar: bloqueia o acesso e mantém o histórico.",
      codigo: "parceiro_com_historico",
      historico,
    }, 409);
  }

  // Mensagens do chat antigo (tabela legada): sem caso, não há o que preservar.
  const delMsg = await supabase.from("mensagens").delete().eq("remetente_id", usuarioId);
  if (delMsg.error && delMsg.error.code !== "42P01") {
    return jsonResponse({ error: "erro ao limpar mensagens antigas", detail: delMsg.error.message }, 500);
  }

  const registrarTrilha = () => auditar(quem, {
    acao: "parceiro.excluido",
    recurso: "usuarios",
    recurso_id: usuarioId,
    detalhes: { nome: (alvo as { nome?: string }).nome ?? null, outros_vinculos: outrosVinculos },
  });

  // A pessoa também atua em OUTRO escritório: sai só daqui. A conta, o login e
  // o histórico dela no outro escritório não são nossos para apagar.
  if (outrosVinculos > 0) {
    const delVinc = await supabase.from("membros").delete().eq("usuario_id", usuarioId);
    if (delVinc.error) {
      return jsonResponse({ error: "erro ao remover o vínculo", detail: delVinc.error.message }, 500);
    }
    await registrarTrilha();
    return jsonResponse({ ok: true, conta_preservada: true });
  }

  // ---------------------------------------------------------------------------
  // 4) Delete public.usuarios
  // ---------------------------------------------------------------------------
  const delUsr = await supabase.from("usuarios").delete().eq("id", usuarioId);
  if (delUsr.error) {
    return jsonResponse({ error: "erro ao deletar usuarios", detail: delUsr.error.message }, 500);
  }
  // Trilha só depois de apagar de fato (antes ela registrava exclusão que
  // podia nem acontecer). O nome veio da leitura do começo.
  await registrarTrilha();

  // ---------------------------------------------------------------------------
  // 5) Delete auth.users via admin
  // ---------------------------------------------------------------------------
  const delAuth = await supabase.auth.admin.deleteUser(usuarioId);
  if (delAuth.error) {
    // public.usuarios ja foi - retorna warning mas nao erro
    return jsonResponse({
      excluido: true,
      auth_excluido: false,
      warning: "Parceiro excluido do app mas auth.users falhou: " +
        delAuth.error.message,
    });
  }

  return jsonResponse({
    excluido: true,
    auth_excluido: true,
    nome: (alvo as { nome: string | null }).nome,
  });
});
